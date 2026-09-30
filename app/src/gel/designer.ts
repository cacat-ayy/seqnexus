/**
 * Diagnostic digest designer.
 *
 * Given the sequences a sample might be (the clone you wanted, the empty
 * vector, the insert backwards), find the enzymes that tell them apart on a
 * gel. Every single enzyme and, optionally, every pair from a pool is tried
 * on every candidate; each digest is run through the same migration and band
 * model the gel draws, so "distinct" means distinct on this gel, at this
 * agarose percentage and run length.
 *
 * A result scores well when:
 *   - the candidates' band patterns sit far apart (the smallest, over all
 *     pairs of candidates, of the largest gap between a band in one lane and
 *     the nearest band in the other),
 *   - each pattern is readable: a few bands, inside the gel's useful range,
 *     none merged, none too faint,
 *   - it needs one enzyme rather than two, and familiar ones at that.
 * With a single candidate only readability counts: a clean confirmatory
 * digest.
 *
 * Pure and synchronous. Pairs are only tried among enzymes that cut every
 * candidate a few times at most, which keeps a full 6-cutter search fast.
 */

import { ENZYME_DB, ENZYME_GROUPS, type RestrictionEnzyme } from '../enzymes/db'
import { findUnblockedSites } from '../cloning/digest'
import { groupBands, placeSpecies, DEFAULT_BAND_OPTIONS } from './bands'
import { resolutionRange, runLengthMm } from './migration'
import type { DnaSpecies, GelConditions } from './model'
import type { SequenceSource } from './simulate'

export type EnzymePool = 'common' | 'six' | 'all'

export const POOL_LABEL: Record<EnzymePool, string> = {
  common: 'Common enzymes',
  six: 'All 6+ cutters',
  all: 'All enzymes',
}

const COMMON = new Set([...ENZYME_GROUPS['Common (6-cutters)'] ?? [], ...ENZYME_GROUPS['Rare (8-cutters)'] ?? []])

function poolEnzymes(pool: EnzymePool): RestrictionEnzyme[] {
  if (pool === 'common') return ENZYME_DB.filter(e => COMMON.has(e.name))
  if (pool === 'six') {
    const names = new Set([...ENZYME_GROUPS['All 6-cutters'] ?? [], ...ENZYME_GROUPS['All 8+ cutters'] ?? [], ...COMMON])
    return ENZYME_DB.filter(e => names.has(e.name))
  }
  return ENZYME_DB
}

export interface DesignCandidate {
  id: string
  source: SequenceSource
}

export interface DesignOptions {
  pool: EnzymePool
  /** Try pairs of enzymes as well as single ones. */
  pairs: boolean
  /** How many results to return. */
  limit: number
}

export const DEFAULT_DESIGN_OPTIONS: DesignOptions = { pool: 'six', pairs: true, limit: 12 }

export interface CandidatePattern {
  id: string
  /** Visible band sizes (bp), top of the gel first. Merged bands give their mass-weighted size. */
  bands: number[]
  /** Band centres in mm, matching `bands`. */
  bandMm: number[]
  fragments: number[]
  /** How many times the digest cuts this candidate. */
  cutCount: number
}

export interface DigestDesign {
  enzymes: string[]
  /** Enzymes recognising the same sites, which would do the same job. */
  alternatives: string[]
  score: number
  /** Smallest pattern difference between two candidates, in mm. Infinity for one candidate. */
  separationMm: number
  patterns: CandidatePattern[]
  notes: string[]
}

/** Fragments used for scoring: 500 ng, the gel's default load. */
const LOAD_NG = 500
/** Enzymes cutting a candidate more often than this are left out of pairs. */
const MAX_CUTS_FOR_PAIRS = 4
/** Most cuts a design may make in any one candidate. */
const MAX_CUTS = 8
/** Candidates closer than this are hard to tell apart by eye. */
const MIN_SEPARATION_MM = 1
/** Separation beyond which a design counts as fully distinct. */
const CLEAR_SEPARATION_MM = 3
const MAX_READABLE_BANDS = 7
/** Fragments smaller than this are faint and easily lost. */
const MIN_COMFORTABLE_BP = 250

interface EnzymeCuts {
  enzyme: RestrictionEnzyme
  /** Per candidate: sorted, deduplicated top-strand cut positions. */
  cuts: number[][]
  /** Per candidate: sites methylation blocks. */
  blocked: number[]
  impaired: boolean
}

function cutsFor(source: SequenceSource, enzyme: RestrictionEnzyme): { cuts: number[]; blocked: number; impaired: boolean } {
  const len = source.bases.length
  const circular = source.topology === 'circular'
  const r = findUnblockedSites(source.bases, source.topology, [enzyme], !!source.damMethylated, !!source.dcmMethylated)
  const set = new Set<number>()
  for (const s of r.sites) {
    let pos = s.fwdCut
    if (circular) pos = ((pos % len) + len) % len
    else if (pos <= 0 || pos >= len) continue
    set.add(pos)
  }
  return {
    cuts: [...set].sort((a, b) => a - b),
    blocked: r.blocked.length,
    impaired: r.warnings.some(w => w.includes('impaired')),
  }
}

function fragmentsFrom(cuts: number[], len: number, circular: boolean): number[] {
  if (cuts.length === 0) return [len]
  const out: number[] = []
  if (circular) {
    for (let i = 0; i < cuts.length; i++) {
      const next = cuts[(i + 1) % cuts.length]
      out.push(next > cuts[i] ? next - cuts[i] : len - cuts[i] + next)
    }
  } else {
    let prev = 0
    for (const c of cuts) { out.push(c - prev); prev = c }
    out.push(len - prev)
  }
  return out.filter(f => f > 0)
}

function mergeCuts(a: number[], b: number[]): number[] {
  return [...new Set([...a, ...b])].sort((x, y) => x - y)
}

interface Evaluated {
  pattern: CandidatePattern
  readability: number
  notes: string[]
}

function evaluate(
  id: string,
  source: SequenceSource,
  cuts: number[],
  c: GelConditions,
  range: [number, number],
  runMm: number,
): Evaluated {
  const len = source.bases.length
  const fragments = fragmentsFrom(cuts, len, source.topology === 'circular')
  // Uncut circular DNA would run as several forms; a design must cut.
  const species: DnaSpecies[] = fragments.map(bp => ({ bp, form: 'linear', ng: (LOAD_NG * bp) / len }))
  const placed = species.map(s => placeSpecies(s, c, DEFAULT_BAND_OPTIONS))
  const onGel = placed.filter(s => s.mm <= runMm)
  const bands = groupBands(onGel, DEFAULT_BAND_OPTIONS).filter(b => b.visible)
  const notes: string[] = []
  let penalty = 0
  const ranOff = placed.length - onGel.length
  if (ranOff > 0) { penalty += 0.25 * ranOff; notes.push(`${ranOff} fragment${ranOff > 1 ? 's' : ''} run off`) }
  const merged = bands.filter(b => new Set(b.members.map(m => m.bp)).size > 1).length
  if (merged > 0) { penalty += 0.2 * merged; notes.push(`${merged} merged band${merged > 1 ? 's' : ''}`) }
  const small = fragments.filter(f => f < Math.max(range[0], MIN_COMFORTABLE_BP)).length
  if (small > 0) { penalty += 0.1 * small; notes.push(`${small} small fragment${small > 1 ? 's' : ''}`) }
  const large = fragments.filter(f => f > range[1]).length
  if (large > 0) { penalty += 0.15 * large; notes.push(`${large} fragment${large > 1 ? 's' : ''} above the resolving range`) }
  if (bands.length > MAX_READABLE_BANDS) { penalty += 0.3; notes.push(`${bands.length} bands`) }
  const bandSizes = bands.map(b => Math.round(b.members.reduce((a, m) => a + m.bp * m.ng, 0) / (b.ng || 1)))
  return {
    pattern: { id, bands: bandSizes, bandMm: bands.map(b => b.mm), fragments: [...fragments].sort((a, b) => b - a), cutCount: cuts.length },
    readability: Math.max(0, 1 - penalty),
    notes,
  }
}

/**
 * How different two band patterns look: the largest gap between a band in
 * one and the nearest band in the other (Hausdorff distance), in mm. Two
 * patterns with a band the other lacks differ by at least that band's gap.
 */
export function patternDistance(a: number[], b: number[], runMm: number): number {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0 || b.length === 0) return runMm
  const oneWay = (x: number[], y: number[]) => Math.max(...x.map(p => Math.min(...y.map(q => Math.abs(p - q)))))
  return Math.max(oneWay(a, b), oneWay(b, a))
}

/** Same cuts in every candidate: isoschizomers or enzymes that happen to coincide here. */
function signature(cuts: number[][]): string {
  return cuts.map(c => c.join(',')).join('|')
}

export function designDigests(
  candidates: DesignCandidate[],
  conditions: GelConditions,
  opts: DesignOptions = DEFAULT_DESIGN_OPTIONS,
): DigestDesign[] {
  if (candidates.length === 0) return []
  const range = resolutionRange(conditions)
  const runMm = runLengthMm(conditions)

  // Cut every candidate with every enzyme once.
  const table: EnzymeCuts[] = []
  for (const enzyme of poolEnzymes(opts.pool)) {
    const per = candidates.map(c => cutsFor(c.source, enzyme))
    if (per.every(p => p.cuts.length === 0)) continue
    if (per.some(p => p.cuts.length > MAX_CUTS)) continue
    table.push({ enzyme, cuts: per.map(p => p.cuts), blocked: per.map(p => p.blocked), impaired: per.some(p => p.impaired) })
  }

  // Combinations to try: singles, then pairs of sparse cutters.
  const combos: EnzymeCuts[][] = table.map(t => [t])
  if (opts.pairs) {
    const sparse = table.filter(t => t.cuts.every(c => c.length <= MAX_CUTS_FOR_PAIRS))
    for (let i = 0; i < sparse.length; i++) {
      for (let j = i + 1; j < sparse.length; j++) combos.push([sparse[i], sparse[j]])
    }
  }

  const bySignature = new Map<string, DigestDesign>()
  for (const combo of combos) {
    const cuts = candidates.map((_, k) => combo.reduce((acc, t) => mergeCuts(acc, t.cuts[k]), [] as number[]))
    if (cuts.some(c => c.length > MAX_CUTS)) continue
    // A pair whose second enzyme adds no cut anywhere is just the single enzyme.
    if (combo.length === 2 && combo.some(t => signature(t.cuts) === signature(cuts))) continue
    // Every candidate must be cut, or it would run as uncut plasmid forms.
    if (cuts.some((c, k) => c.length === 0 && candidates[k].source.topology === 'circular')) continue

    const evaluated = candidates.map((cand, k) => evaluate(cand.id, cand.source, cuts[k], conditions, range, runMm))
    if (evaluated.some(e => e.pattern.bands.length === 0)) continue

    let separation = Infinity
    for (let a = 0; a < evaluated.length; a++) {
      for (let b = a + 1; b < evaluated.length; b++) {
        separation = Math.min(separation, patternDistance(evaluated[a].pattern.bandMm, evaluated[b].pattern.bandMm, runMm))
      }
    }
    if (candidates.length > 1 && separation < MIN_SEPARATION_MM) continue

    const readability = evaluated.reduce((a, e) => a + e.readability, 0) / evaluated.length
    const distinct = candidates.length > 1 ? Math.min(1, separation / CLEAR_SEPARATION_MM) : 1
    const unfamiliar = combo.filter(t => !COMMON.has(t.enzyme.name)).length
    const impaired = combo.some(t => t.impaired)
    const blocked = combo.some(t => t.blocked.some(n => n > 0))
    const score = (candidates.length > 1 ? 0.6 * distinct + 0.4 * readability : readability)
      - 0.08 * (combo.length - 1)
      - 0.04 * unfamiliar
      - (impaired ? 0.1 : 0)

    const notes = [...new Set(evaluated.flatMap(e => e.notes))]
    if (impaired) notes.push('a site may be impaired by methylation')
    if (blocked) notes.push('some sites are blocked by methylation')

    const design: DigestDesign = {
      enzymes: combo.map(t => t.enzyme.name),
      alternatives: [],
      score,
      separationMm: separation,
      patterns: evaluated.map(e => e.pattern),
      notes,
    }
    // Isoschizomers, neoschizomers and coinciding enzymes give the same
    // fragments: keep the best-scoring (usually the familiar one) and list
    // the rest.
    const sig = evaluated.map(e => e.pattern.fragments.join(',')).join('|')
    const existing = bySignature.get(sig)
    if (!existing) bySignature.set(sig, design)
    else if (design.score > existing.score) {
      bySignature.set(sig, { ...design, alternatives: [...existing.alternatives, existing.enzymes.join(' + ')] })
    } else {
      existing.alternatives.push(design.enzymes.join(' + '))
    }
  }

  return [...bySignature.values()]
    .sort((a, b) => b.score - a.score || a.enzymes.length - b.enzymes.length || a.enzymes.join().localeCompare(b.enzymes.join()))
    .slice(0, opts.limit)
    .map(d => ({ ...d, alternatives: d.alternatives.slice(0, 4) }))
}
