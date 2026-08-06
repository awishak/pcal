import type { SurveyExport } from './csv'
import {
  SurveyError,
  type AnswerInput,
  type Survey,
  type SurveyDraft,
  type SurveyErrorCode,
  type SurveyResults,
  type SurveySummary,
  type TurnoutEntry,
  type VoterInput,
  type VoterStatus,
} from './types'

/**
 * Structural type instead of importing SupabaseClient, keeps this folder
 * copy-pasteable into a project on any @supabase/supabase-js version, and
 * into plain-JS projects that never installed the types.
 */
export interface SupabaseLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
  /** present on a real Supabase client; used for live tallies when
   *  realtime.sql is installed. Absent is fine, the hook surveys instead. */
  channel?(name: string, opts?: Record<string, unknown>): RealtimeChannelLike
  removeChannel?(channel: RealtimeChannelLike): unknown
  /** used only to tell whether a viewer is signed in, for auth-gated surveys */
  auth?: SupabaseAuthLike
}

export interface SupabaseAuthLike {
  getUser(): PromiseLike<{ data: { user: { id: string } | null } | null }>
  onAuthStateChange?(
    callback: (event: string, session: unknown) => void,
  ): { data: { subscription: { unsubscribe(): void } } }
}

export interface RealtimeChannelLike {
  on(
    type: string,
    filter: Record<string, unknown>,
    callback: (payload: unknown) => void,
  ): RealtimeChannelLike
  subscribe(callback?: (status: string) => void): RealtimeChannelLike
  unsubscribe(): unknown
}

const KNOWN_CODES: SurveyErrorCode[] = [
  'survey_not_found',
  'survey_closed',
  'already_responded',
  'results_hidden',
  'results_locked',
  'missing_required_answer',
  'selection_count_out_of_range',
  'rating_out_of_range',
  'unknown_option_for_question',
  'auth_required',
  'slug_required',
  'not_found_or_not_owner',
  'slug_taken',
  'rate_limited',
  'bad_pair',
  'too_many_pairs',
  'duplicate_rank',
  'bad_rank_weights',
  'not_an_eligible_voter',
  'bad_voter_list',
]

const FRIENDLY: Record<SurveyErrorCode, string> = {
  survey_not_found: 'That survey does not exist.',
  survey_closed: 'This survey is not accepting responses right now.',
  already_responded: 'You have already responded to this survey.',
  results_hidden: 'Results for this survey are not public.',
  results_locked: 'Results unlock once you have responded.',
  missing_required_answer: 'Please answer all required questions.',
  selection_count_out_of_range: 'You selected too few or too many options.',
  rating_out_of_range: 'That rating is outside the allowed range.',
  unknown_option_for_question: 'That option does not belong to this question.',
  auth_required: 'You need to be signed in to do that.',
  slug_required: 'Give the survey a URL slug.',
  not_found_or_not_owner: 'That survey does not exist, or it is not yours to edit.',
  slug_taken: 'A survey with that slug already exists.',
  rate_limited: 'Too many responses from here just now, try again shortly.',
  bad_pair: 'That head-to-head comparison was not valid.',
  too_many_pairs: 'Too many comparisons were submitted for that question.',
  duplicate_rank: 'Each pick can only take one place.',
  bad_rank_weights: 'Ranked points must be a list of whole numbers, none negative.',
  not_an_eligible_voter: 'This vote is limited to a set list of voters, and you are not on it.',
  bad_voter_list: 'Every voter needs an email address.',
  unknown: 'Something went wrong.',
}

/** Turn a Postgres `raise exception 'code:detail'` into a typed SurveyError. */
function toSurveyError(raw: { message: string } | null | undefined): SurveyError {
  const message = raw?.message ?? ''
  for (const code of KNOWN_CODES) {
    if (message.includes(code)) {
      const detail = message.split(`${code}:`)[1]
      const questionId = detail ? detail.trim().split(/[\s"']/)[0] : undefined
      return new SurveyError(code, FRIENDLY[code], questionId || undefined)
    }
  }
  return new SurveyError('unknown', message || FRIENDLY.unknown)
}

async function call<T>(
  client: SupabaseLike,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw toSurveyError(error)
  return data as T
}

/** Fetch a survey with its questions and options. Null if it does not exist
 *  (or is a draft you do not own). */
export async function fetchSurvey(client: SupabaseLike, slug: string): Promise<Survey | null> {
  const data = await call<Survey | null>(client, 'survey_get', { p_slug: slug })
  return data ?? null
}

export async function hasResponded(
  client: SupabaseLike,
  slug: string,
  respondentKey: string,
): Promise<boolean> {
  return call<boolean>(client, 'survey_has_responded', {
    p_slug: slug,
    p_respondent_key: respondentKey,
  })
}

/** Submit every answer at once. Server-side it is a single transaction:
 *  either the whole response lands or none of it does. */
export async function submitResponse(
  client: SupabaseLike,
  slug: string,
  respondentKey: string,
  answers: AnswerInput[],
): Promise<{ ok: boolean; response_id: string }> {
  return call(client, 'survey_submit', {
    p_slug: slug,
    p_respondent_key: respondentKey,
    p_answers: answers,
  })
}

/** Aggregated tallies. Pass the respondent key so `after_response` surveys
 *  can tell that you have earned the results. */
export async function fetchResults(
  client: SupabaseLike,
  slug: string,
  respondentKey?: string,
): Promise<SurveyResults> {
  return call<SurveyResults>(client, 'survey_results', {
    p_slug: slug,
    p_respondent_key: respondentKey ?? null,
  })
}

/** Create or update a survey. Requires an authenticated session. */
export async function saveSurvey(client: SupabaseLike, draft: SurveyDraft): Promise<Survey> {
  return call<Survey>(client, 'survey_save', { p_payload: draft })
}

export async function listMySurveys(client: SupabaseLike): Promise<SurveySummary[]> {
  const rows = await call<SurveySummary[]>(client, 'survey_list_mine', {})
  return rows ?? []
}

/** Copy a survey's structure under a new slug. The copy starts as an empty
 *  draft, responses are never carried over. */
export async function duplicateSurvey(
  client: SupabaseLike,
  slug: string,
  newSlug: string,
): Promise<Survey> {
  return call<Survey>(client, 'survey_duplicate', { p_slug: slug, p_new_slug: newSlug })
}

/** Owner-only dump of every response, ready for toCsv(). */
export async function exportSurvey(client: SupabaseLike, slug: string): Promise<SurveyExport> {
  return call<SurveyExport>(client, 'survey_export', { p_slug: slug })
}

/** Replace the roll of a restricted survey. Owner only.
 *
 *  Wholesale, not a merge: anyone absent from the list is removed. Addresses
 *  already on it keep their voted_at, so correcting a display name does not
 *  erase the fact that someone voted. */
export async function setVoters(
  client: SupabaseLike,
  slug: string,
  voters: VoterInput[],
): Promise<{ ok: boolean; voters: number }> {
  return call(client, 'survey_set_voters', { p_slug: slug, p_voters: voters })
}

/** Who is on the roll and whether they have voted. Display names and a
 *  boolean only, never an address and never an answer, so this is safe to
 *  render publicly. */
export async function fetchTurnout(
  client: SupabaseLike,
  slug: string,
): Promise<TurnoutEntry[]> {
  const rows = await call<TurnoutEntry[]>(client, 'survey_turnout', { p_slug: slug })
  return rows ?? []
}

/** What the signed-in caller may do, for choosing which screen to render.
 *  survey_submit enforces the same rule regardless of what this says. */
export async function fetchVoterStatus(
  client: SupabaseLike,
  slug: string,
): Promise<VoterStatus> {
  return call<VoterStatus>(client, 'survey_my_voter_status', { p_slug: slug })
}

export { SurveyError }
