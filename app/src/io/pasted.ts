/**
 * Text pasted into the New Sequence box, split into records.
 */

/** One record of the pasted text: its FASTA header, if it had one, and its letters. */
export interface PastedRecord {
  name: string | null
  description: string
  bases: string
}

/** Whitespace and digits (GenBank-style numbering) are dropped; letters are upper-cased. */
const clean = (line: string) => line.replace(/[\s\d]/g, '').toUpperCase()

/**
 * Split pasted text into records at FASTA headers. Text before the first
 * header is a record of its own, without a name. A header names its record
 * by its first word; the rest of the line is the description. Pasting two
 * records used to join them into one sequence.
 */
export function readPasted(raw: string): PastedRecord[] {
  const records: PastedRecord[] = []
  let current: PastedRecord = { name: null, description: '', bases: '' }
  const chunks: string[] = []
  const flush = () => {
    const bases = chunks.join('')
    chunks.length = 0
    if (current.name !== null || bases) records.push({ ...current, bases })
  }
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('>')) {
      flush()
      const header = line.slice(1).trim()
      const space = header.search(/\s/)
      current = space < 0
        ? { name: header, description: '', bases: '' }
        : { name: header.slice(0, space), description: header.slice(space + 1).trim(), bases: '' }
    } else if (!line.startsWith(';')) {
      chunks.push(clean(line))
    }
  }
  flush()
  return records
}
