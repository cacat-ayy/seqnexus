/**
 * The optimizer.
 *
 * Greedy left to right with bounded backtracking. At each codon it takes the
 * best synonym that does not break a constraint in the window that codon can
 * affect; when nothing fits it steps back and tries the previous codon's next
 * choice. This is how DNAWorks and the commercial tools do it, and unlike a
 * scoring heuristic it can explain every choice it made.
 *
 * A full dynamic program is not an option: the state would have to be the last
 * K bases, where K is the longest constraint window, so the table is 4^K wide.
 *
 * The protein is the invariant. Whatever the settings, `optimizeRegion` checks
 * that its own output translates to the input protein and throws if it does
 * not. Returning a sequence that codes for something else is the one failure
 * this code must never have: a thrown error is a bug report, a silent one is a
 * ruined experiment.
 */

import { ConstraintSet, RepeatIndex, type Violation } from './constraints'
import { synonymsFor, translateWith, type GeneticCode } from './genetic-codes'
import {
  familyFractions, relativeAdaptiveness, rareCodons, type CodonUsageTable,
} from './usage-tables'

export type OptimizationMode = 'all' | 'rare-only'
export type CodonStrategy = 'most-frequent' | 'usage-weighted'

export interface OptimizeOptions {
  code: GeneticCode
  table: CodonUsageTable
  mode: OptimizationMode
  strategy: CodonStrategy
  /** Below this within-family percentage a codon counts as rare. */
  rareThreshold: number
  constraints: ConstraintSet
  /** Seeds the weighted strategy so a run can be repeated. */
  seed: number
  /** Give up backtracking after this many steps. */
  backtrackBudget: number
}

export const DEFAULT_OPTIMIZE_OPTIONS = {
  mode: 'all' as OptimizationMode,
  strategy: 'most-frequent' as CodonStrategy,
  rareThreshold: 10,
  seed: 1,
  backtrackBudget: 20_000,
}

export interface CodonChange {
  /** Index of the codon within the region. */
  index: number
  aa: string
  from: string
  to: string
}

export interface RegionResult {
  bases: string
  changes: CodonChange[]
  /** Constraints still broken after the walk, in region coordinates. */
  violations: Violation[]
  /** Codons the optimizer could not place without breaking something. */
  unresolved: number
  /** True when the walk ran out of backtracking budget. */
  budgetExhausted: boolean
}

/** Small deterministic PRNG, so a seed reproduces a run exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Order a family by sampling without replacement, weighted by usage.
 *
 * The point is to reproduce the host's natural spread rather than stack the
 * same codon end to end, which is what "most frequent" does and which makes
 * homopolymers and repeats more likely in the first place.
 */
function weightedOrder(
  family: readonly string[], fractions: Record<string, number>, rand: () => number,
): string[] {
  const pool = family.slice()
  const out: string[] = []
  while (pool.length > 0) {
    const total = pool.reduce((sum, c) => sum + (fractions[c] ?? 0), 0)
    if (total <= 0) { out.push(...pool); break }
    let r = rand() * total
    let picked = pool.length - 1
    for (let i = 0; i < pool.length; i++) {
      r -= fractions[pool[i]] ?? 0
      if (r <= 0) { picked = i; break }
    }
    out.push(pool.splice(picked, 1)[0])
  }
  return out
}

/**
 * Optimize one region.
 *
 * `context` is the untouched sequence on either side, so a motif straddling
 * the boundary is seen. The region occupies
 * [before.length, before.length + bases.length) of the sequence the
 * constraints are checked against.
 */
export function optimizeRegion(
  bases: string,
  locked: ReadonlyMap<number, string>,
  options: OptimizeOptions,
  context: { before: string; after: string } = { before: '', after: '' },
): RegionResult {
  const { code, table, constraints } = options
  const upper = bases.toUpperCase()
  const codonCount = Math.floor(upper.length / 3)
  const original: string[] = []
  for (let i = 0; i < codonCount; i++) original.push(upper.slice(i * 3, i * 3 + 3))

  const fractions = familyFractions(table, code)
  const weights = relativeAdaptiveness(table, code)
  const rare = rareCodons(table, code, options.rareThreshold)
  const rand = mulberry32(options.seed)

  /**
   * Candidates per codon, best first.
   *
   * A locked codon, an unrecognised one, and in rare-only mode a codon that is
   * already common all get a single candidate: themselves. The original always
   * appears in the list, so a codon whose every synonym breaks a constraint
   * stays as it was rather than being forced somewhere worse.
   */
  const candidates: string[][] = original.map((codon, index) => {
    if (locked.has(index)) return [codon]
    const aa = code.table[codon]
    if (!aa) return [codon]
    const family = synonymsFor(code, aa)
    if (family.length < 2) return [codon]
    if (options.mode === 'rare-only' && !rare.has(codon)) return [codon]

    return options.strategy === 'usage-weighted'
      ? weightedOrder(family, fractions, rand)
      : family.slice().sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0) || (a < b ? -1 : 1))
  })

  // The sequence under construction, as characters: context, then the codons
  // decided so far, then the original bases for everything not yet reached.
  // Keeping it as an array makes the window slices the constraints need cheap,
  // where rebuilding a string per attempt would make the whole walk quadratic.
  const before = context.before.toUpperCase()
  const after = context.after.toUpperCase()
  const offset = before.length
  const chars: string[] = [...before, ...upper, ...after]
  const total = chars.length
  const lookback = constraints.lookback

  /** The slice a change at [from, to) can affect, clipped to decided bases. */
  const windowFor = (from: number, to: number, writtenTo: number) => {
    const start = Math.max(0, from - lookback)
    const end = Math.min(writtenTo, to + lookback)
    return { text: chars.slice(start, end).join(''), start }
  }

  const repeatLimit = constraints.options.maxRepeat
  const repeats = repeatLimit > 0 ? new RepeatIndex(repeatLimit + 1) : null
  const repeatWords: { word: string; at: number }[][] =
    Array.from({ length: codonCount }, () => [])
  /** Words are only indexed up to the codon being written: the rest is stale. */
  const wordsFor = (from: number, to: number, writtenTo: number) => {
    if (!repeats) return []
    return repeats.wordStarts(from, to, writtenTo).map(at => ({
      word: chars.slice(at, at + repeats.k).join(''),
      at,
    }))
  }

  const choiceIndex: number[] = new Array(codonCount).fill(0)
  const chosen: string[] = new Array(codonCount).fill('')
  let budget = options.backtrackBudget
  let budgetExhausted = false
  const unresolvedAt = new Set<number>()

  const write = (index: number, codon: string) => {
    const at = offset + index * 3
    chars[at] = codon[0]
    chars[at + 1] = codon[1]
    chars[at + 2] = codon[2]
  }

  let i = 0
  while (i < codonCount) {
    const list = candidates[i]
    const from = offset + i * 3
    const to = from + 3
    // Everything past this codon still holds its original bases, which would
    // make the checks read stale sequence. Only the prefix is trusted, except
    // for the last codon, where the untouched flank legitimately follows.
    const writtenTo = i === codonCount - 1 ? total : to
    let placed = false

    for (let c = choiceIndex[i]; c < list.length; c++) {
      write(i, list[c])

      const { text, start } = windowFor(from, to, writtenTo)
      if (constraints.violationsIn(text, from - start, to - start).length > 0) continue

      if (repeats) {
        const words = wordsFor(from, to, writtenTo)
        if (words.some(w => repeats.earlierMatch(w.word, w.at) !== -1)) continue
        repeatWords[i] = repeats.add(words)
      }

      chosen[i] = list[c]
      choiceIndex[i] = c
      placed = true
      break
    }

    if (placed) { i++; continue }

    // Nothing fits here. Step back to the last codon with an untried choice.
    if (repeats) { repeats.rollback(repeatWords[i]); repeatWords[i] = [] }
    choiceIndex[i] = 0

    let back = i - 1
    while (back >= 0 && choiceIndex[back] + 1 >= candidates[back].length) {
      if (repeats) { repeats.rollback(repeatWords[back]); repeatWords[back] = [] }
      choiceIndex[back] = 0
      back--
    }

    if (back < 0 || budget <= 0) {
      // Out of options or out of patience: keep the first candidate, record
      // that it did not work out, and carry on. A partial answer with an
      // honest list of what it could not fix beats no answer at all.
      if (budget <= 0) budgetExhausted = true
      chosen[i] = list[0]
      write(i, list[0])
      unresolvedAt.add(i)
      if (repeats) repeatWords[i] = repeats.add(wordsFor(from, to, writtenTo))
      i++
      continue
    }

    budget--
    if (repeats) { repeats.rollback(repeatWords[back]); repeatWords[back] = [] }
    choiceIndex[back]++
    i = back
  }

  const optimized = chosen.join('') + upper.slice(codonCount * 3)

  // The invariant. Everything else here can be wrong in a way that costs a
  // resynthesis; this would cost an experiment.
  const proteinBefore = translateWith(code, upper)
  const proteinAfter = translateWith(code, optimized)
  if (proteinBefore !== proteinAfter) {
    throw new Error('codon optimization changed the protein: this is a bug, nothing was modified')
  }

  const changes: CodonChange[] = []
  for (let k = 0; k < codonCount; k++) {
    if (chosen[k] !== original[k]) {
      changes.push({ index: k, aa: code.table[original[k]] ?? '?', from: original[k], to: chosen[k] })
    }
  }

  const full = before + optimized + after
  const violations = constraints.findViolations(full)
    .filter(v => v.end > offset && v.start < offset + optimized.length)
    .map(v => ({ ...v, start: v.start - offset, end: v.end - offset }))

  return { bases: optimized, changes, violations, unresolved: unresolvedAt.size, budgetExhausted }
}
