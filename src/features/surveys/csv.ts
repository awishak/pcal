/**
 * CSV export.
 *
 * survey_export() returns normalised rows; the pivot into one column per
 * question happens here, where it is easy to test and easy to change.
 */

export interface ExportAnswer {
  labels: string[]
  text: string | null
  rating: number | null
}

export interface ExportResponse {
  id: string
  created_at: string
  answers: Record<string, ExportAnswer>
}

export interface SurveyExport {
  slug: string
  title: string
  anonymous: boolean
  questions: { id: string; position: number; prompt: string; type: string }[]
  responses: ExportResponse[]
}

/** Render one answer as a single cell.
 *
 *  survey_export() returns a ranked question's labels already in place order,
 *  but "Simon; Marios" alone does not say that Simon was first. Numbering the
 *  cell is what makes the export readable as a ballot. */
export function formatAnswer(answer: ExportAnswer | undefined, type?: string): string {
  if (!answer) return ''
  if (answer.labels?.length) {
    return type === 'ranked'
      ? answer.labels.map((label, i) => `${i + 1}. ${label}`).join('; ')
      : answer.labels.join('; ')
  }
  if (answer.text != null) return answer.text
  if (answer.rating != null) return String(answer.rating)
  return ''
}

/**
 * Quote a cell for RFC 4180. Also guards against CSV injection: a cell
 * starting with =, +, - or @ is executed as a formula by Excel and Sheets,
 * so it gets a leading apostrophe.
 */
export function escapeCell(value: string): string {
  const risky = /^[=+\-@\t\r]/.test(value)
  const cell = risky ? `'${value}` : value
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

export interface CsvOptions {
  /** include the response id column (off by default, it is noise for humans) */
  includeResponseId?: boolean
}

/** Build the full CSV text: one row per response, one column per question. */
export function toCsv(data: SurveyExport, options: CsvOptions = {}): string {
  const questions = [...data.questions].sort((a, b) => a.position - b.position)

  const header = [
    ...(options.includeResponseId ? ['response_id'] : []),
    'submitted_at',
    ...questions.map((q) => q.prompt),
  ]

  const rows = data.responses.map((response) => [
    ...(options.includeResponseId ? [response.id] : []),
    response.created_at,
    ...questions.map((q) => formatAnswer(response.answers?.[q.id], q.type)),
  ])

  return [header, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n')
}

/** Filename like `favourite-colour-2026-08-05.csv`. */
export function csvFilename(data: SurveyExport, today = new Date()): string {
  const date = today.toISOString().slice(0, 10)
  return `${data.slug}-${date}.csv`
}

/** Trigger a browser download. No-op outside the browser. */
export function downloadCsv(data: SurveyExport, options?: CsvOptions): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([toCsv(data, options)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = csvFilename(data)
  link.click()
  URL.revokeObjectURL(url)
}
