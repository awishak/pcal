import { isVisible } from './branching'
import type { AnswerInput, SurveyQuestion } from './types'

export type AnswerDraft = Record<string, AnswerInput>
/** question id -> message. Empty object means the response is submittable. */
export type Problems = Record<string, string>

/**
 * Client-side mirror of the checks survey_submit() runs in SQL. The server is
 * still the authority, this exists so the user gets a per-question message
 * before a round trip, not instead of one.
 *
 * Questions hidden by a branch are skipped entirely: an unasked question
 * cannot be unanswered. survey_submit() applies the same rule.
 */
export function validateAnswers(questions: SurveyQuestion[], draft: AnswerDraft): Problems {
  const problems: Problems = {}

  for (const q of questions) {
    if (!isVisible(q.show_if, draft)) continue

    const answer = draft[q.id]

    if (q.type === 'single' || q.type === 'multi') {
      const picked = answer?.option_ids?.length ?? 0
      const min =
        q.type === 'single'
          ? q.required
            ? 1
            : 0
          : (q.min_selections ?? (q.required ? 1 : 0))
      const max = q.type === 'single' ? 1 : (q.max_selections ?? q.options.length)

      if (picked < min) {
        problems[q.id] = min === 1 ? 'Pick an option.' : `Pick at least ${min} options.`
      } else if (picked > max) {
        problems[q.id] = `Pick at most ${max} option${max === 1 ? '' : 's'}.`
      }
    } else if (q.type === 'text') {
      if (q.required && !answer?.text_value?.trim()) {
        problems[q.id] = 'This one is required.'
      }
    } else if (q.type === 'rating') {
      const value = answer?.rating_value
      if (value == null) {
        if (q.required) problems[q.id] = 'Choose a rating.'
      } else if (value < q.rating_min || value > q.rating_max) {
        problems[q.id] = `Choose a rating between ${q.rating_min} and ${q.rating_max}.`
      }
    } else if (q.type === 'ranked') {
      const picks = answer?.option_ids ?? []
      const places = rankedPlaces(q)
      const min = q.min_selections ?? (q.required ? places : 0)

      if (new Set(picks).size !== picks.length) {
        problems[q.id] = 'Each pick can only take one place.'
      } else if (picks.length < min) {
        problems[q.id] =
          min === places ? `Fill all ${places} places.` : `Fill at least ${min} places.`
      } else if (picks.length > places) {
        problems[q.id] = `There ${places === 1 ? 'is' : 'are'} only ${places} place${places === 1 ? '' : 's'}.`
      }
    } else if (q.type === 'pairwise') {
      const done = answer?.pairs?.length ?? 0
      const asked = Math.min(q.pair_count, maxPairsFor(q.options.length))
      if (q.required && done < asked) {
        problems[q.id] = `Make all ${asked} choices.`
      }
    }
  }

  return problems
}

function maxPairsFor(optionCount: number): number {
  return optionCount < 2 ? 0 : (optionCount * (optionCount - 1)) / 2
}

/** How many places a ranked question offers. Mirrors survey_submit(). */
export function rankedPlaces(q: SurveyQuestion): number {
  return q.max_selections ?? q.options.length
}

/** Points a ranked question awards for a given 1-based place. Mirrors the
 *  weight expression in survey_results(): the vector wins where it reaches,
 *  Borda fills in the rest. */
export function rankPointsFor(q: SurveyQuestion, place: number): number {
  const weight = q.rank_weights?.[place - 1]
  if (weight != null) return weight
  return Math.max(rankedPlaces(q) - place + 1, 0)
}

/**
 * Drop entries the user never touched, so optional questions stay unanswered
 * rather than submitting empty values. Answers to questions hidden by a
 * branch are dropped too, otherwise changing your mind earlier would leave
 * orphaned answers behind.
 */
export function packAnswers(questions: SurveyQuestion[], draft: AnswerDraft): AnswerInput[] {
  return questions
    .filter((q) => isVisible(q.show_if, draft))
    .map((q) => ({ ...draft[q.id], question_id: q.id }))
    .filter(
      (a) =>
        (a.option_ids?.length ?? 0) > 0 ||
        Boolean(a.text_value?.trim()) ||
        a.rating_value != null ||
        (a.pairs?.length ?? 0) > 0,
    )
}
