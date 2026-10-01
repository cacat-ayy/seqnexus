/** Helpers shared by the alignment format readers and writers. */

/** The text without a leading byte-order mark (U+FEFF), which Windows editors like to add. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Lines of a text file, any line ending, BOM removed. */
export function splitLines(text: string): string[] {
  return stripBom(text).split(/\r\n|\r|\n/)
}

export function wrap(s: string, width: number): string[] {
  if (s.length === 0) return ['']
  const out: string[] = []
  for (let i = 0; i < s.length; i += width) out.push(s.slice(i, i + width))
  return out
}

/** Split a block of residues into groups of `group` separated by spaces (MSF, PHYLIP). */
export function grouped(s: string, group: number): string {
  const parts: string[] = []
  for (let i = 0; i < s.length; i += group) parts.push(s.slice(i, i + group))
  return parts.join(' ')
}

/** A name with whitespace replaced, for formats where whitespace ends the name. */
export function noSpaces(name: string): string {
  return name.trim().replace(/\s+/g, '_') || 'unnamed'
}

/**
 * Names cut to `max` characters and made unique by numbering, for formats
 * with a fixed name width (strict PHYLIP's ten characters).
 */
export function uniqueNames(names: readonly string[], max: number): string[] {
  const used = new Set<string>()
  return names.map(raw => {
    const base = noSpaces(raw).slice(0, max)
    let name = base
    let n = 1
    while (used.has(name)) {
      const suffix = String(n++)
      name = base.slice(0, Math.max(0, max - suffix.length)) + suffix
    }
    used.add(name)
    return name
  })
}

/**
 * Collect sequence text per name in order of first appearance; repeated
 * names append (interleaved files).
 */
export class RowCollector {
  private order: string[] = []
  private parts = new Map<string, string[]>()

  add(name: string, seq: string): void {
    let p = this.parts.get(name)
    if (!p) {
      p = []
      this.parts.set(name, p)
      this.order.push(name)
    }
    p.push(seq)
  }

  has(name: string): boolean {
    return this.parts.has(name)
  }

  get size(): number {
    return this.order.length
  }

  rows(): { name: string; seq: string }[] {
    return this.order.map(name => ({ name, seq: this.parts.get(name)!.join('') }))
  }
}

/**
 * Replace a "same as the first row" character ('.' in NEXUS and MEGA) with
 * the first row's residue in that column. The first row itself is left as is.
 */
export function expandMatchChar(rows: { name: string; seq: string }[], matchChar: string): void {
  if (rows.length < 2 || !matchChar) return
  const first = rows[0].seq
  for (let i = 1; i < rows.length; i++) {
    const s = rows[i].seq
    if (s.indexOf(matchChar) === -1) continue
    let out = ''
    for (let c = 0; c < s.length; c++) out += s[c] === matchChar ? (first[c] ?? matchChar) : s[c]
    rows[i].seq = out
  }
}

/** Remove whitespace and digits from a run of sequence text (some formats number their lines). */
export function residuesOnly(s: string): string {
  return s.replace(/[\s\d]+/g, '')
}
