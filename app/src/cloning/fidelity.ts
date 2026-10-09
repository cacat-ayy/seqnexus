/**
 * How well a set of Type IIS overhangs tells itself apart.
 *
 * A Golden Gate reaction is only as specific as its overhangs. T4 ligase will
 * join a pair that does not quite match, and when two overhangs in the set
 * are similar enough the reaction quietly assembles parts in the wrong order.
 * The published ligase fidelity work (Potapov et al. 2018, Pryor et al. 2020)
 * measured this: mismatches near the middle of a 4-base overhang are far more
 * disruptive than at the ends, and G:T wobbles are tolerated best of all.
 *
 * This is a model of that behaviour rather than the measured matrix, which is
 * a few hundred thousand numbers. It reproduces what the matrix is used for:
 * ranking candidate sets, flagging the pairs that will cross-react, and
 * picking a set that will not.
 */

import { reverseComplement } from '../models/complement'

const COMPLEMENT: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }

/** How readily each mispair forms, relative to a correct pair. */
const MISPAIR_TOLERANCE: Record<string, number> = {
  // The wobble pairs: by far the most common off-target ligation.
  GT: 0.30, TG: 0.30,
  // Purine-purine and pyrimidine-pyrimidine mispairs are rarer.
  AC: 0.08, CA: 0.08,
  AG: 0.06, GA: 0.06,
  CT: 0.05, TC: 0.05,
  AA: 0.03, TT: 0.03,
  CC: 0.02, GG: 0.02,
}

/**
 * Position weights across a 4-base overhang, from the ligated end inwards.
 * A mismatch at the very end of the duplex barely registers; one in the
 * middle stops the join.
 */
const POSITION_WEIGHT = [0.55, 0.12, 0.12, 0.55]

/**
 * How readily `left` ligates to the overhang that `right` presents, relative
 * to a perfect match. 1 means they pair exactly; 0 means they will not join.
 *
 * Both overhangs are written along their own protruding strand (see ./ends),
 * so the pair that belongs together reads as reverse complements.
 */
export function crossReactivity(left: string, right: string): number {
  const a = left.toUpperCase()
  const b = reverseComplement(right.toUpperCase())
  if (a.length !== b.length || a.length === 0) return 0

  const weights = a.length === 4
    ? POSITION_WEIGHT
    : Array.from({ length: a.length }, (_, i) =>
        i === 0 || i === a.length - 1 ? 0.55 : 0.12)

  let score = 1
  let mismatches = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i] && 'ACGT'.includes(a[i])) continue
    mismatches++
    // `b` is already written as the strand `a` would pair against, so the two
    // bases that actually sit opposite each other are a[i] and whatever b[i]
    // is the complement of. Naming the mispair from a[i] and b[i] directly
    // would call a G:T wobble something else.
    const tolerance = MISPAIR_TOLERANCE[a[i] + COMPLEMENT[b[i]]] ?? 0.02
    // A mismatch costs most where the duplex is held together.
    score *= tolerance * weights[i] / 0.55
  }
  // Two mismatches essentially never ligate, whatever they are.
  if (mismatches >= 3) return 0
  return score
}

/**
 * How readily two designed overhangs get confused for each other.
 *
 * Every overhang is present at two ends in the reaction: the part upstream of
 * a junction presents it, and the part downstream presents its partner. So
 * there are two ways a pair can go wrong (one overhang against the other,
 * and one against the other's partner), and a set is only as good as the
 * worse of them.
 */
export function pairRisk(a: string, b: string): number {
  return Math.max(crossReactivity(a, b), crossReactivity(a, reverseComplement(b.toUpperCase())))
}

export interface PairRisk {
  /** The overhang that would act as the donor. */
  from: string
  /** The overhang it would wrongly join to. */
  to: string
  /** Relative to a correct join. */
  propensity: number
}

/**
 * One overhang per junction, from a list of fragment ends.
 *
 * A junction has two ends and they are each other's partners, so handing both
 * to `setFidelity` would have it compare an overhang with its own partner and
 * call the perfect match a cross-reaction. Each pair is collapsed to whichever
 * of the two sorts first, so the same junction always yields the same name.
 */
export function junctionOverhangs(ends: readonly string[]): string[] {
  const seen = new Map<string, string>()
  for (const end of ends) {
    const seq = end.toUpperCase()
    if (seq.length === 0) continue
    const partner = reverseComplement(seq)
    const key = seq < partner ? seq : partner
    if (!seen.has(key)) seen.set(key, key)
  }
  return [...seen.values()]
}

export interface SetFidelity {
  /**
   * Estimated share of ligation events that join the intended partners,
   * 0-1. Above about 0.95 a set assembles cleanly.
   */
  fidelity: number
  /** The pairs most likely to cross-react, worst first. */
  risks: PairRisk[]
  /** Overhangs that pair with themselves, which no set should contain. */
  palindromic: string[]
  /** Overhangs appearing more than once, which makes the order ambiguous. */
  duplicated: string[]
}

/** An overhang that is its own partner: it will ligate to itself. */
export function isPalindromic(overhang: string): boolean {
  const seq = overhang.toUpperCase()
  return seq.length > 0 && seq === reverseComplement(seq)
}

/**
 * Score a whole set of overhangs as it would be used in one reaction.
 *
 * Takes one overhang per junction. A list of fragment ends holds both halves
 * of every junction, so put it through `junctionOverhangs` first.
 *
 * Each overhang has one correct partner and every other one is a chance to go
 * wrong, so the estimate is the correct joins over all the joins that could
 * happen.
 */
export function setFidelity(overhangs: string[]): SetFidelity {
  const seqs = overhangs.map(o => o.toUpperCase()).filter(o => o.length > 0)
  const unique = [...new Set(seqs)]

  const duplicated = [...new Set(seqs.filter((o, i) => seqs.indexOf(o) !== i))]
  const palindromic = unique.filter(isPalindromic)

  const risks: PairRisk[] = []
  let onTarget = 0
  let offTarget = 0

  for (let i = 0; i < unique.length; i++) {
    const from = unique[i]
    // The intended join: this overhang against its own partner.
    onTarget += 1
    // A palindromic overhang is its own partner, so it also joins itself.
    if (isPalindromic(from)) {
      offTarget += 1
      risks.push({ from, to: from, propensity: 1 })
    }
    for (let j = i + 1; j < unique.length; j++) {
      const to = unique[j]
      const propensity = pairRisk(from, to)
      if (propensity > 0.001) {
        offTarget += propensity
        risks.push({ from, to, propensity })
      }
    }
  }

  risks.sort((a, b) => b.propensity - a.propensity)
  const total = onTarget + offTarget
  return {
    fidelity: total === 0 ? 0 : onTarget / total,
    risks: risks.slice(0, 20),
    palindromic,
    duplicated,
  }
}

/** Plain-language notes on a set, for the UI to show beside the score. */
export function fidelityWarnings(overhangs: string[]): string[] {
  const result = setFidelity(overhangs)
  const warnings: string[] = []

  for (const seq of result.palindromic) {
    warnings.push(`Overhang ${seq} reads the same on both strands, so it ligates to itself.`)
  }
  for (const seq of result.duplicated) {
    warnings.push(`Overhang ${seq} is used more than once: the parts can swap places.`)
  }
  for (const risk of result.risks.slice(0, 3)) {
    if (risk.from === risk.to) continue
    if (risk.propensity < 0.05) break
    warnings.push(
      `Overhangs ${risk.from} and ${risk.to} differ too little and will cross-react.`,
    )
  }
  if (warnings.length === 0 && result.fidelity < 0.95) {
    warnings.push(
      `This set is predicted to assemble correctly ${(result.fidelity * 100).toFixed(0)}% of the time; ` +
      'a different choice of overhangs would do better.',
    )
  }
  return warnings
}

export interface OverhangSetOptions {
  /** Overhang length. Four bases for the usual Type IIS enzymes. */
  length?: number
  /** Overhangs that must appear, because the parts already carry them. */
  include?: string[]
  /** Overhangs to stay away from. */
  exclude?: string[]
  /** Keep GC content in this range, as a fraction. Default 0.25-0.75. */
  minGc?: number
  maxGc?: number
}

/**
 * Pick a set of overhangs that will not be confused with each other.
 *
 * Greedy: start from whatever the design already fixes, then keep adding the
 * candidate that cross-reacts least with everything chosen so far. That is
 * how the published high-fidelity sets were derived, and for the handful of
 * overhangs a real assembly needs it gets within a hair of the best possible.
 */
export function chooseOverhangSet(count: number, options: OverhangSetOptions = {}): string[] {
  const length = options.length ?? 4
  const minGc = options.minGc ?? 0.25
  const maxGc = options.maxGc ?? 0.75
  const exclude = new Set((options.exclude ?? []).map(o => o.toUpperCase()))
  const chosen = (options.include ?? []).map(o => o.toUpperCase())

  const candidates: string[] = []
  const bases = ['A', 'C', 'G', 'T']
  const build = (prefix: string) => {
    if (prefix.length === length) {
      if (exclude.has(prefix) || isPalindromic(prefix)) return
      const gc = [...prefix].filter(b => b === 'G' || b === 'C').length / length
      if (gc < minGc || gc > maxGc) return
      // Three or four of the same base makes a sticky, low-complexity end.
      const counts = new Map<string, number>()
      for (const b of prefix) counts.set(b, (counts.get(b) ?? 0) + 1)
      if ([...counts.values()].some(n => n >= 3)) return
      candidates.push(prefix)
      return
    }
    for (const base of bases) build(prefix + base)
  }
  build('')

  // The complement of a chosen overhang is the partner it is meant to meet,
  // so it must not be handed out as a second overhang.
  const taken = new Set<string>()
  for (const seq of chosen) {
    taken.add(seq)
    taken.add(reverseComplement(seq))
  }

  while (chosen.length < count) {
    let best: string | null = null
    let bestWorst = Infinity
    for (const candidate of candidates) {
      if (taken.has(candidate)) continue
      // Judge a candidate by its worst interaction with the set so far.
      let worst = 0
      for (const seq of chosen) worst = Math.max(worst, pairRisk(candidate, seq))
      if (worst < bestWorst) {
        bestWorst = worst
        best = candidate
      }
    }
    if (!best) break
    chosen.push(best)
    taken.add(best)
    taken.add(reverseComplement(best))
  }

  return chosen
}
