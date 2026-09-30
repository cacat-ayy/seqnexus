/**
 * Oligo lists in and out.
 *
 * In: whatever people keep primers in. A CSV or TSV with a header (name and
 * sequence columns found by name), plain "name sequence" lines, bare
 * sequences, or FASTA. Lines that are not oligos are reported, not dropped
 * silently, so a typo in row 40 of a 60-primer sheet gets noticed.
 *
 * Out: CSV, FASTA, and an order sheet in the column layout synthesis
 * vendors' bulk-entry forms take (Name, Sequence, Scale, Purification; the
 * layout of IDT's bulk input). Scale and purification are the vendor's codes
 * and are passed through as given.
 */

import { cleanOligo, type OligoRole } from './oligo'

export interface ParsedOligo {
  name: string
  sequence: string
  role: OligoRole
  notes?: string
}

export interface ParseResult {
  oligos: ParsedOligo[]
  /** 1-based line numbers and why they were skipped. */
  skipped: { line: number; reason: string }[]
}

const NAME_COLS = ['name', 'oligo', 'primer', 'id', 'oligo name', 'primer name']
const SEQ_COLS = ['sequence', 'seq', 'oligo sequence', "sequence (5'-3')", "sequence 5'-3'", 'bases']
const NOTE_COLS = ['notes', 'note', 'description', 'comment', 'comments']
const ROLE_COLS = ['role', 'type']

/** Split one delimited line, honouring double quotes. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) { out.push(cur.trim()); cur = '' }
    else cur += ch
  }
  out.push(cur.trim())
  return out
}

export function parseOligoList(text: string, fallbackPrefix = 'Oligo'): ParseResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.some(l => l.startsWith('>'))) return parseFasta(lines, fallbackPrefix)

  const oligos: ParsedOligo[] = []
  const skipped: ParseResult['skipped'] = []
  const firstReal = lines.find(l => l.trim())
  if (!firstReal) return { oligos, skipped }

  const delim = firstReal.includes('\t') ? '\t' : firstReal.includes(',') ? ',' : firstReal.includes(';') ? ';' : null
  let cols: { name: number; seq: number; notes: number; role: number } | null = null

  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    // Pasted lists mix separators; a line without the file's delimiter is
    // read as whitespace-separated rather than as one long cell.
    const cells = delim && line.includes(delim) ? splitLine(line, delim) : line.split(/\s+/)

    // A header row names the columns; it is detected, not required.
    if (cols === null && oligos.length === 0) {
      const lower = cells.map(c => c.toLowerCase())
      const seqIdx = lower.findIndex(c => SEQ_COLS.includes(c))
      if (seqIdx >= 0) {
        cols = {
          seq: seqIdx,
          name: lower.findIndex(c => NAME_COLS.includes(c)),
          notes: lower.findIndex(c => NOTE_COLS.includes(c)),
          role: lower.findIndex(c => ROLE_COLS.includes(c)),
        }
        return
      }
    }

    let name: string
    let seqText: string
    let notes: string | undefined
    let role: OligoRole = 'primer'
    if (cols) {
      seqText = cells[cols.seq] ?? ''
      name = cols.name >= 0 ? cells[cols.name] ?? '' : ''
      notes = cols.notes >= 0 ? cells[cols.notes] || undefined : undefined
      if (cols.role >= 0 && /probe/i.test(cells[cols.role] ?? '')) role = 'probe'
    } else if (cells.length === 1) {
      name = ''
      seqText = cells[0]
    } else {
      // No header: the last cell that reads as an oligo is the sequence,
      // everything before it the name.
      let s = cells.length - 1
      while (s > 0 && !cleanOligo(cells[s])) s--
      seqText = cells[s]
      name = cells.slice(0, s).join(' ')
      notes = cells.slice(s + 1).join(' ') || undefined
    }
    const sequence = cleanOligo(seqText)
    if (!sequence) {
      skipped.push({ line: i + 1, reason: seqText ? `"${seqText.slice(0, 20)}" is not an oligo` : 'no sequence' })
      return
    }
    oligos.push({ name: name || `${fallbackPrefix} ${oligos.length + 1}`, sequence, role, ...(notes ? { notes } : {}) })
  })
  return { oligos, skipped }
}

function parseFasta(lines: string[], fallbackPrefix: string): ParseResult {
  const oligos: ParsedOligo[] = []
  const skipped: ParseResult['skipped'] = []
  let header: { name: string; line: number } | null = null
  let buf = ''
  const flush = () => {
    if (!header) return
    const sequence = cleanOligo(buf)
    if (sequence) oligos.push({ name: header.name || `${fallbackPrefix} ${oligos.length + 1}`, sequence, role: 'primer' })
    else skipped.push({ line: header.line, reason: buf ? 'not an oligo' : 'no sequence' })
  }
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (line.startsWith('>')) {
      flush()
      header = { name: line.slice(1).trim(), line: i + 1 }
      buf = ''
    } else if (header) {
      buf += line
    }
  })
  flush()
  return { oligos, skipped }
}

// ---------------------------------------------------------------------------
// Out
// ---------------------------------------------------------------------------

export interface ExportableOligo {
  name: string
  sequence: string
  role?: OligoRole
  notes?: string
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export function toCsv(oligos: readonly ExportableOligo[]): string {
  const rows = [['Name', 'Sequence', 'Length', 'Role', 'Notes']]
  for (const o of oligos) {
    rows.push([o.name, o.sequence, String(o.sequence.length), o.role ?? 'primer', o.notes ?? ''])
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n'
}

export function toFasta(oligos: readonly ExportableOligo[]): string {
  return oligos.map(o => `>${o.name}\n${o.sequence}\n`).join('')
}

export interface OrderOptions {
  /** Vendor scale code, e.g. "25nm", "100nm". */
  scale: string
  /** Vendor purification code, e.g. "STD" (desalted), "PAGE", "HPLC". */
  purification: string
}

export const DEFAULT_ORDER: OrderOptions = { scale: '25nm', purification: 'STD' }

/**
 * Tab-separated order sheet: Name, Sequence, Scale, Purification. Names are
 * made safe for order forms (no tabs or line breaks) and unique, since
 * vendors reject duplicate names in one order.
 */
export function toOrderSheet(oligos: readonly ExportableOligo[], opts: OrderOptions = DEFAULT_ORDER): string {
  const seen = new Map<string, number>()
  const rows = ['Name\tSequence\tScale\tPurification']
  for (const o of oligos) {
    let name = o.name.replace(/[\t\r\n]+/g, ' ').trim() || 'Oligo'
    const k = seen.get(name) ?? 0
    seen.set(name, k + 1)
    if (k > 0) name = `${name}_${k + 1}`
    rows.push([name, o.sequence, opts.scale, opts.purification].join('\t'))
  }
  return rows.join('\n') + '\n'
}
