import type { AnswerInput, SurveyQuestion, ShowIf } from './types'
import type { AnswerDraft } from './validate'

/**
 * Conditional branching.
 *
 * These rules are evaluated twice: here, to decide what to render, and in
 * survey_question_visible() in schema.sql, to decide what "required" means.
 * They must agree, the server is the authority, so if you change one,
 * change both and re-run the tests that pin them together.
 */

/** An entry with nothing actually filled in does not count as an answer. */
export function isAnswered(answer: AnswerInput | undefined): boolean {
  if (!answer) return false
  if ((answer.option_ids?.length ?? 0) > 0) return true
  if (answer.text_value != null && answer.text_value.trim() !== '') return true
  if (answer.rating_value != null) return true
  if ((answer.pairs?.length ?? 0) > 0) return true
  return false
}

/** Should a question with this rule be shown, given the answers so far? */
export function isVisible(showIf: ShowIf | null | undefined, draft: AnswerDraft): boolean {
  if (!showIf || !showIf.question_id) return true

  const answer = draft[showIf.question_id]
  const answered = isAnswered(answer)
  const op = showIf.op ?? 'answered'

  if (op === 'answered') return answered
  if (op === 'not_answered') return !answered

  // every remaining operator is a test on a value, so it needs one
  if (!answered || !answer) return false

  const target = showIf.value == null ? '' : String(showIf.value)
  const options = answer.option_ids ?? []

  switch (op) {
    case 'includes':
      return options.includes(target)

    case 'is':
      return (
        (options.length === 1 && options[0] === target) ||
        answer.text_value === target ||
        (answer.rating_value != null && String(answer.rating_value) === target)
      )

    case 'is_not':
      return !(
        options.includes(target) ||
        answer.text_value === target ||
        (answer.rating_value != null && String(answer.rating_value) === target)
      )

    case 'gte':
    case 'lte': {
      const rating = answer.rating_value
      const bound = Number(target)
      if (rating == null || target === '' || Number.isNaN(bound)) return false
      return op === 'gte' ? rating >= bound : rating <= bound
    }

    default:
      return true
  }
}

/** The questions to render right now, in order. */
export function visibleQuestions(
  questions: SurveyQuestion[],
  draft: AnswerDraft,
): SurveyQuestion[] {
  return questions.filter((q) => isVisible(q.show_if, draft))
}

/**
 * Questions a rule may point at: earlier ones only.
 *
 * Forward references would let two questions gate each other, and a cycle
 * has no stable answer, so the builder simply cannot express one.
 */
export function eligibleTargets(
  questions: SurveyQuestion[],
  index: number,
): SurveyQuestion[] {
  return questions.slice(0, Math.max(0, index))
}

/** Human-readable summary of a rule, for the builder. */
export function describeRule(showIf: ShowIf, questions: SurveyQuestion[]): string {
  const target = questions.find((q) => q.id === showIf.question_id)
  const name = target ? `“${target.prompt}”` : 'an earlier question'
  const option = target?.options.find((o) => o.id === String(showIf.value))
  const value = option ? `“${option.label ?? option.image_alt ?? 'that option'}”` : showIf.value

  switch (showIf.op) {
    case 'answered':
      return `Shown when ${name} is answered`
    case 'not_answered':
      return `Shown when ${name} is skipped`
    case 'is':
      return `Shown when ${name} is ${value}`
    case 'is_not':
      return `Shown when ${name} is not ${value}`
    case 'includes':
      return `Shown when ${name} includes ${value}`
    case 'gte':
      return `Shown when ${name} is at least ${value}`
    case 'lte':
      return `Shown when ${name} is at most ${value}`
    default:
      return `Shown when ${name} matches`
  }
}
