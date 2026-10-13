/**
 * CSV cells, written the same way by every table the app exports.
 *
 * A cell is quoted when it holds a comma, a quote or a line break. Text a
 * spreadsheet would run as a formula, anything starting with = + - or @ (or
 * a tab or carriage return), gets a leading apostrophe, the usual guard
 * against formula injection: a feature called "=HYPERLINK(…)" or a primer
 * called "+1_F" then shows as written instead of running or reading #NAME?.
 * Numbers ("-35", "+3", "1e-5") and a lone sign (a strand) are left as they are.
 */

const FORMULA_START = /^[=+\-@\t\r]/
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/

export function csvCell(value: string | number): string {
  let s = String(value)
  if (typeof value === 'string' && FORMULA_START.test(s) && s !== '-' && s !== '+' && !NUMBER.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** A row of cells, comma separated. */
export function csvRow(cells: readonly (string | number)[]): string {
  return cells.map(csvCell).join(',')
}

/** A cell as written before `csvCell` guarded it, for reading our own tables back. */
export function unguardCsvCell(s: string): string {
  return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s
}
