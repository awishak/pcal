export type SurveyStatus = 'draft' | 'open' | 'closed'
export type ShowResults = 'always' | 'after_response' | 'never'
export type QuestionType = 'single' | 'multi' | 'text' | 'rating' | 'pairwise' | 'ranked'

export type ShowIfOp =
  | 'answered'
  | 'not_answered'
  | 'is'
  | 'is_not'
  | 'includes'
  | 'gte'
  | 'lte'

/** Visibility rule on a question. Evaluated in branching.ts on the client
 *  and survey_question_visible() on the server, both must agree. */
export interface ShowIf {
  /** an EARLIER question; forward references would allow cycles */
  question_id: string
  op: ShowIfOp
  /** option id for is/is_not/includes, number for gte/lte */
  value?: string | number
}

export interface SurveyOption {
  id: string
  position: number
  label: string | null
  image_url: string | null
  image_alt: string | null
}

export interface SurveyQuestion {
  id: string
  position: number
  type: QuestionType
  prompt: string
  help_text: string | null
  image_url: string | null
  required: boolean
  randomize_options: boolean
  min_selections: number | null
  max_selections: number | null
  rating_min: number
  rating_max: number
  rating_min_label: string | null
  rating_max_label: string | null
  /** pairwise only: how many head-to-head comparisons to ask for */
  pair_count: number
  /** ranked only: points awarded to 1st, 2nd, 3rd... e.g. [5, 3, 1].
   *  null falls back to Borda, where N places award N, N-1 ... 1. */
  rank_weights: number[] | null
  show_if: ShowIf | null
  options: SurveyOption[]
}

export interface Survey {
  id: string
  slug: string
  title: string
  description: string | null
  status: SurveyStatus
  anonymous: boolean
  randomize_questions: boolean
  one_response_per_device: boolean
  show_results: ShowResults
  show_text_answers: boolean
  rate_limit_per_hour: number
  require_auth: boolean
  /** only addresses on the roll may respond; implies require_auth */
  restrict_to_voters: boolean
  opens_at: string | null
  closes_at: string | null
  /** survey is open AND inside its opens_at/closes_at window */
  accepting: boolean
  is_owner: boolean
  questions: SurveyQuestion[]
}

/** One entry per answered question. Only the field matching the
 *  question's type is read server-side; the rest are ignored. */
export interface AnswerInput {
  question_id: string
  /** For 'ranked' this array is ORDERED: index 0 is 1st place, index 1 is
   *  2nd, and so on. Every other type treats it as an unordered set.
   *  Sharing the field is deliberate, branching reads answers through
   *  option_ids, so ranked questions work with the existing operators. */
  option_ids?: string[]
  text_value?: string
  rating_value?: number
  /** pairwise only: one entry per head-to-head comparison made */
  pairs?: { winner: string; loser: string }[]
}

export interface OptionResult {
  id: string
  position: number
  label: string | null
  image_url: string | null
  image_alt: string | null
  /** For 'ranked' this is ballots the option appeared on at any place. */
  votes: number
  pct: number
  /** pairwise only; zero for every other question type */
  wins: number
  losses: number
  win_rate: number
  /** ranked only; zero for every other question type */
  points: number
  first_place_votes: number
  /** place -> how many ballots gave the option that place, e.g. {"1": 4} */
  rank_counts: Record<string, number>
}

export interface QuestionResult {
  id: string
  position: number
  type: QuestionType
  prompt: string
  rating_min: number
  rating_max: number
  answered: number
  options: OptionResult[]
  rating_average: number | null
  rating_histogram: Record<string, number>
  /** empty unless the survey opts in via show_text_answers, or you own it */
  text_answers: string[]
}

export interface SurveyResults {
  survey_id: string
  slug: string
  title: string
  total_responses: number
  questions: QuestionResult[]
}

/** Shape accepted by saveSurvey(). Omit ids to create; keep them to edit
 *  in place without discarding the answers already collected. */
export interface SurveyDraft {
  id?: string | null
  slug: string
  title: string
  description?: string | null
  status?: SurveyStatus
  anonymous?: boolean
  randomize_questions?: boolean
  one_response_per_device?: boolean
  show_results?: ShowResults
  show_text_answers?: boolean
  rate_limit_per_hour?: number
  require_auth?: boolean
  restrict_to_voters?: boolean
  opens_at?: string | null
  closes_at?: string | null
  questions: QuestionDraft[]
}

export interface QuestionDraft {
  id?: string | null
  type: QuestionType
  prompt: string
  help_text?: string | null
  image_url?: string | null
  required?: boolean
  randomize_options?: boolean
  min_selections?: number | null
  max_selections?: number | null
  rating_min?: number
  rating_max?: number
  rating_min_label?: string | null
  rating_max_label?: string | null
  pair_count?: number
  rank_weights?: number[] | null
  show_if?: ShowIf | null
  options: OptionDraft[]
}

export interface OptionDraft {
  id?: string | null
  label?: string | null
  image_url?: string | null
  image_alt?: string | null
}

/** One person on a restricted survey's roll. Never carries an address. */
export interface TurnoutEntry {
  display_name: string | null
  voted: boolean
}

/** What the signed-in caller may do, for picking which screen to render.
 *  The server enforces the same rule regardless of what this returns. */
export interface VoterStatus {
  signed_in: boolean
  eligible: boolean
  voted: boolean
  display_name?: string | null
}

export interface VoterInput {
  email: string
  display_name?: string | null
}

export interface SurveySummary {
  id: string
  slug: string
  title: string
  status: SurveyStatus
  responses: number
  created_at: string
  updated_at: string
}

/** Errors raised by the SQL functions, normalised by api.ts. */
export type SurveyErrorCode =
  | 'survey_not_found'
  | 'survey_closed'
  | 'already_responded'
  | 'results_hidden'
  | 'results_locked'
  | 'missing_required_answer'
  | 'selection_count_out_of_range'
  | 'rating_out_of_range'
  | 'unknown_option_for_question'
  | 'auth_required'
  | 'slug_required'
  | 'not_found_or_not_owner'
  | 'slug_taken'
  | 'rate_limited'
  | 'bad_pair'
  | 'too_many_pairs'
  | 'duplicate_rank'
  | 'not_an_eligible_voter'
  | 'bad_voter_list'
  | 'bad_rank_weights'
  | 'unknown'

export class SurveyError extends Error {
  code: SurveyErrorCode
  /** question id, when the failure was about one specific question */
  questionId?: string

  constructor(code: SurveyErrorCode, message: string, questionId?: string) {
    super(message)
    this.name = 'SurveyError'
    this.code = code
    this.questionId = questionId
  }
}
