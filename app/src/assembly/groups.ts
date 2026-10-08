/**
 * Grouping reads by name: which reads come from the same clone.
 *
 * A plate of clones is sequenced with two or more reads each, and the clone
 * is written into every read's name with what tells the reads apart after
 * it: `A03.1` and `A03.2`, `pX12_M13F` and `pX12_M13R`,
 * `Achl_ACHLO006-09_1_F` and `Achl_ACHLO006-09_2_R`. The name is split at a
 * separator and some of its parts name the clone: the first n parts, or
 * every part but the last n. Geneious's "Assemble by name" works the same
 * way (a delimiter and which part).
 *
 * suggestGrouping tries every separator and choice of parts and keeps the
 * one that puts the most reads into clones of two to four reads, the shape
 * of a plate sequenced from both ends (or with a primer walk). Grouping
 * everything into one clone, or nothing into any, scores low.
 */

export const NAME_SEPARATORS = ['_', '-', '.', ' '] as const
export type NameSeparator = (typeof NAME_SEPARATORS)[number]

export interface NameGrouping {
  separator: NameSeparator
  /** Which parts name the clone: the first `parts`, or all but the last `parts`. */
  take: 'first' | 'all-but-last'
  parts: number
}

export const SEPARATOR_LABEL: Record<NameSeparator, string> = {
  '_': 'underscore (_)',
  '-': 'hyphen (-)',
  '.': 'full stop (.)',
  ' ': 'space',
}

/**
 * The clone a name belongs to. A name with too few parts for the grouping
 * is a clone of its own, named in full: it cannot be told apart from the
 * others it might go with, so it is not guessed into one.
 */
export function groupKey(name: string, g: NameGrouping): string {
  const parts = name.split(g.separator)
  const n = g.take === 'first' ? g.parts : parts.length - g.parts
  if (n < 1 || n >= parts.length) return name
  return parts.slice(0, n).join(g.separator)
}

export interface NameGroup<T> {
  key: string
  items: T[]
}

/** Items grouped by the clone their names give, groups and items in the order first met. */
export function groupByName<T>(items: readonly T[], name: (t: T) => string, g: NameGrouping): NameGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const it of items) {
    const key = groupKey(name(it), g)
    const list = groups.get(key)
    if (list) list.push(it)
    else groups.set(key, [it])
  }
  return [...groups].map(([key, list]) => ({ key, items: list }))
}

/** Most parts tried from either end; clone names rarely hold more. */
const MAX_PARTS = 4
/** Reads in a clone that count fully: forward, reverse and a couple of walking primers. */
const FULL_GROUP = 4

/**
 * How well a grouping fits a plate: every read in a clone of two or more
 * counts, up to four per clone. Clones of one count nothing (the grouping
 * found no partner), and one huge clone counts only four.
 */
export function groupingScore(names: readonly string[], g: NameGrouping): number {
  const sizes = new Map<string, number>()
  for (const n of names) {
    const k = groupKey(n, g)
    sizes.set(k, (sizes.get(k) ?? 0) + 1)
  }
  let score = 0
  for (const size of sizes.values()) if (size >= 2) score += Math.min(size, FULL_GROUP)
  return score
}

/**
 * The grouping that best fits the names, or null when none puts two reads
 * together. Ties go to the earlier separator, then to the first parts over
 * all but the last, then to fewer parts.
 */
export function suggestGrouping(names: readonly string[]): NameGrouping | null {
  let best: NameGrouping | null = null
  let bestScore = 0
  for (const separator of NAME_SEPARATORS) {
    if (!names.some(n => n.includes(separator))) continue
    for (const take of ['first', 'all-but-last'] as const) {
      for (let parts = 1; parts <= MAX_PARTS; parts++) {
        const g: NameGrouping = { separator, take, parts }
        const score = groupingScore(names, g)
        if (score > bestScore) { best = g; bestScore = score }
      }
    }
  }
  return best
}

/** "first 2 parts, split at underscore (_)" */
export function describeGrouping(g: NameGrouping): string {
  const parts = g.take === 'first'
    ? (g.parts === 1 ? 'the first part' : `the first ${g.parts} parts`)
    : (g.parts === 1 ? 'all but the last part' : `all but the last ${g.parts} parts`)
  return `${parts} of the name, split at ${SEPARATOR_LABEL[g.separator]}`
}

export function sanitizeGrouping(raw: unknown): NameGrouping | null {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Partial<NameGrouping>
  if (!NAME_SEPARATORS.includes(x.separator as NameSeparator)) return null
  if (x.take !== 'first' && x.take !== 'all-but-last') return null
  if (typeof x.parts !== 'number' || !Number.isInteger(x.parts) || x.parts < 1 || x.parts > 20) return null
  return { separator: x.separator as NameSeparator, take: x.take, parts: x.parts }
}
