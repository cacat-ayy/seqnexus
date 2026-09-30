/**
 * What DNA is in a lane.
 *
 * Turns a lane's sample into the species it contains: each with a length, a
 * form and a mass. Mass is what the stain sees, so it is tracked from the
 * load down to every fragment: a fragment gets the share of the load its
 * length is of the whole.
 *
 * Uncut circular DNA splits into supercoiled, nicked and linear forms. A
 * circular sequence cut once becomes one full-length linear molecule. Sites
 * that dam/dcm methylation blocks are skipped, using the same rule as the
 * cloning digest.
 */

import { getEnzyme, type RestrictionEnzyme } from '../enzymes/db'
import { findUnblockedSites } from '../cloning/digest'
import { getLadder, type Ladder } from './ladders'
import { simulatePcr } from '../primers/pcr'
import type { PrimerData } from '../primers/oligo'
import {
  DEFAULT_PLASMID_FORMS,
  type DnaForm,
  type DnaSpecies,
  type FormMix,
  type FragmentOrigin,
  type LaneSample,
} from './model'

/** The parts of a sequence a simulation needs. */
export interface SequenceSource {
  name: string
  bases: string
  topology: 'linear' | 'circular'
  damMethylated?: boolean
  dcmMethylated?: boolean
}

export interface LaneSimulation {
  species: DnaSpecies[]
  warnings: string[]
  /** Total DNA in the lane, in ng. */
  totalNg: number
}

const EMPTY: LaneSimulation = { species: [], warnings: [], totalNg: 0 }

export function simulateLadder(ladder: Ladder, ng?: number): LaneSimulation {
  const scale = ng !== undefined && ladder.totalNg > 0 ? ng / ladder.totalNg : 1
  const species: DnaSpecies[] = ladder.bands.map(b => ({
    bp: b.bp,
    form: 'linear',
    ng: b.ng * scale,
    ...(b.reference ? { reference: true } : {}),
  }))
  return { species, warnings: [], totalNg: ladder.totalNg * scale }
}

function uncutSpecies(source: SequenceSource, ng: number, forms: FormMix): DnaSpecies[] {
  const len = source.bases.length
  if (source.topology === 'linear') return [{ bp: len, form: 'linear', ng }]
  const sum = forms.supercoiled + forms.nicked + forms.linear
  if (sum <= 0) return [{ bp: len, form: 'supercoiled', ng }]
  return (['supercoiled', 'nicked', 'linear'] as DnaForm[])
    .filter(f => forms[f] > 0)
    .map(f => ({ bp: len, form: f, ng: (ng * forms[f]) / sum }))
}

interface Cut {
  pos: number
  enzyme: string
}

/**
 * Cut positions on the top strand, deduplicated and sorted, with the enzyme
 * that makes each. Two enzymes cutting at the same base share one cut.
 */
function cutPositions(source: SequenceSource, enzymes: RestrictionEnzyme[]): { cuts: Cut[]; warnings: string[] } {
  const len = source.bases.length
  const circular = source.topology === 'circular'
  const { sites, warnings } = findUnblockedSites(
    source.bases, source.topology, enzymes,
    source.damMethylated ?? false, source.dcmMethylated ?? false,
  )
  const byPos = new Map<number, string>()
  for (const s of sites) {
    let pos = s.fwdCut
    if (circular) pos = ((pos % len) + len) % len
    // A linear molecule can only be cut strictly inside it; a Type IIS site
    // near an end may place its cut outside.
    else if (pos <= 0 || pos >= len) continue
    const prev = byPos.get(pos)
    byPos.set(pos, prev && prev !== s.enzyme.name ? `${prev}/${s.enzyme.name}` : s.enzyme.name)
  }
  const cuts = [...byPos].map(([pos, enzyme]) => ({ pos, enzyme })).sort((a, b) => a.pos - b.pos)

  const cutting = new Set(sites.map(s => s.enzyme.name))
  for (const e of enzymes) {
    if (!cutting.has(e.name)) warnings.push(`${e.name} does not cut ${source.name}`)
  }
  return { cuts, warnings }
}

function fragmentsFromCuts(len: number, circular: boolean, cuts: Cut[]): FragmentOrigin[] {
  const frags: FragmentOrigin[] = []
  if (circular) {
    for (let i = 0; i < cuts.length; i++) {
      const left = cuts[i]
      const right = cuts[(i + 1) % cuts.length]
      frags.push({ index: i, start: left.pos, end: right.pos, leftEnzyme: left.enzyme, rightEnzyme: right.enzyme })
    }
    return frags
  }
  const bounds: { pos: number; enzyme: string | null }[] = [
    { pos: 0, enzyme: null }, ...cuts, { pos: len, enzyme: null },
  ]
  for (let i = 0; i < bounds.length - 1; i++) {
    frags.push({
      index: i,
      start: bounds[i].pos,
      end: bounds[i + 1].pos,
      leftEnzyme: bounds[i].enzyme,
      rightEnzyme: bounds[i + 1].enzyme,
    })
  }
  return frags
}

function fragmentLength(f: FragmentOrigin, len: number): number {
  if (f.end > f.start) return f.end - f.start
  // Spans the origin; a single cut in a circle gives start === end, the whole molecule.
  return len - f.start + f.end
}

export interface SequenceSampleOptions {
  ng: number
  forms?: FormMix
}

export function simulateSequence(
  source: SequenceSource,
  enzymes: RestrictionEnzyme[],
  opts: SequenceSampleOptions,
): LaneSimulation {
  const len = source.bases.length
  if (len === 0) return { ...EMPTY, warnings: [`${source.name} is empty`] }
  const ng = Math.max(0, opts.ng)
  const forms = opts.forms ?? DEFAULT_PLASMID_FORMS

  if (enzymes.length === 0) {
    return { species: uncutSpecies(source, ng, forms), warnings: [], totalNg: ng }
  }

  const { cuts, warnings } = cutPositions(source, enzymes)
  if (cuts.length === 0) {
    return { species: uncutSpecies(source, ng, forms), warnings, totalNg: ng }
  }

  const species: DnaSpecies[] = []
  for (const f of fragmentsFromCuts(len, source.topology === 'circular', cuts)) {
    const bp = fragmentLength(f, len)
    if (bp <= 0) continue
    species.push({ bp, form: 'linear', ng: (ng * bp) / len, fragment: f })
  }
  return { species, warnings, totalNg: ng }
}

/** Resolves a sample's source id to its sequence, or null when it is gone. */
export type SourceResolver = (sourceId: string) => SequenceSource | null

/** Everything a lane can refer to: sequences, and library oligos for PCR. */
export interface GelResolver {
  sequence: SourceResolver
  oligo?: (id: string) => PrimerData | null
}

export function toResolver(r: SourceResolver | GelResolver): GelResolver {
  return typeof r === 'function' ? { sequence: r } : r
}

/** Mass of each side product, relative to the main product. */
const SIDE_PRODUCT_SHARE = 0.15
/** Side products drawn; a primer in a repeat can make hundreds. */
const MAX_SIDE_PRODUCTS = 8

/**
 * A PCR lane: the product, plus any other products the primer pair could
 * make, fainter. Only a warning when the primers do not amplify.
 */
export function simulatePcrLane(
  template: SequenceSource,
  forward: PrimerData,
  reverse: PrimerData,
  ng: number,
): LaneSimulation {
  const result = simulatePcr({ ...template, annotations: [] }, forward, reverse)
  if ('error' in result) return { ...EMPTY, warnings: [result.error] }
  const main = result.bases.length
  const others = [...new Set(result.alternatives)].filter(bp => bp !== main)
  const sizes = [main, ...others.slice(0, MAX_SIDE_PRODUCTS)]
  const total = 1 + SIDE_PRODUCT_SHARE * (sizes.length - 1)
  const species: DnaSpecies[] = sizes.map((bp, i) => ({
    bp,
    form: 'linear',
    ng: (ng * (i === 0 ? 1 : SIDE_PRODUCT_SHARE)) / total,
    pcr: i === 0 ? 'product' : 'side',
  }))
  const n = others.length
  const warnings = n > 0 ? [`The primers could also make ${n} other product${n > 1 ? 's' : ''}`
    + (n > MAX_SIDE_PRODUCTS ? `; the ${MAX_SIDE_PRODUCTS} smallest are shown` : '')] : []
  return { species, warnings, totalNg: Math.max(0, ng) }
}

export function simulateLane(sample: LaneSample, resolver: SourceResolver | GelResolver): LaneSimulation {
  const { sequence: resolve, oligo } = toResolver(resolver)
  switch (sample.kind) {
    case 'empty':
      return EMPTY
    case 'ladder': {
      const ladder = getLadder(sample.ladderId)
      if (!ladder) return { ...EMPTY, warnings: [`Unknown ladder "${sample.ladderId}"`] }
      return simulateLadder(ladder, sample.ng)
    }
    case 'sequence': {
      const source = resolve(sample.sourceId)
      if (!source) return { ...EMPTY, warnings: ['The source sequence is no longer available'] }
      const enzymes: RestrictionEnzyme[] = []
      const unknown: string[] = []
      for (const name of sample.enzymes) {
        const e = getEnzyme(name)
        if (e) enzymes.push(e)
        else unknown.push(name)
      }
      const sim = simulateSequence(source, enzymes, { ng: sample.ng, forms: sample.forms })
      if (unknown.length === 0) return sim
      return { ...sim, warnings: [...unknown.map(n => `Unknown enzyme "${n}"`), ...sim.warnings] }
    }
    case 'pcr': {
      const template = resolve(sample.templateId)
      if (!template) return { ...EMPTY, warnings: ['Choose a template sequence'] }
      const fwd = oligo?.(sample.forwardId) ?? null
      const rev = oligo?.(sample.reverseId) ?? null
      if (!fwd || !rev) return { ...EMPTY, warnings: ['Choose two primers from the primer library'] }
      return simulatePcrLane(template, fwd, rev, sample.ng)
    }
    case 'sizes': {
      const species: DnaSpecies[] = sample.sizes
        .filter(bp => Number.isFinite(bp) && bp > 0)
        .map(bp => ({ bp: Math.round(bp), form: 'linear', ng: sample.ng }))
      return { species, warnings: [], totalNg: sample.ng * species.length }
    }
  }
}
