/**
 * A cloning design: what goes in, how it is joined, and what to call it.
 *
 * This is what gets saved. Results are never stored: they come from running
 * the design (./run), so they are always what the current engines say, and a
 * fix to an engine reaches every old design the next time it is opened.
 *
 * Each part carries a snapshot of its sequence. A design that only pointed
 * at its sources would silently change, or break, when one of them was
 * edited or deleted; one that keeps a copy can say "this source has changed
 * since. Refresh?" and let the user decide.
 */

import type { AnnotationData } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import type { KitId } from './kits'
import type { GatewayReaction } from './gateway'
import type { TopoVariant } from './topo'
import type { OligoDuplex } from './duplex'
import { annealOligos } from './duplex'
import { withoutSegments } from './fragment'

export type CloningMethodId = 'restriction' | 'golden-gate' | 'homology' | 'gateway' | 'topo'

export const METHOD_LABEL: Record<CloningMethodId, string> = {
  'restriction': 'Restriction & ligation',
  'golden-gate': 'Golden Gate',
  'homology': 'Seamless assembly',
  'gateway': 'Gateway',
  'topo': 'TOPO',
}

/** One line on what each method is for, shown when choosing one. */
export const METHOD_BLURB: Record<CloningMethodId, string> = {
  'restriction': 'Cut each part at the sites you click on its map, and ligate the ends.',
  'golden-gate': 'Type IIS enzymes cut beside their sites, so parts join seamlessly in one pot.',
  'homology': 'HiFi, Gibson, In-Fusion: parts join on shared ends, in any order.',
  'gateway': 'Recombine a cassette between att sites into a destination vector.',
  'topo': 'Topoisomerase joins a PCR product straight into a ready-cut vector.',
}

export type PartRole = 'vector' | 'insert'
export type PartOrientation = 'auto' | 'forward' | 'reverse'

export interface PartSource {
  /** Tab id of the sequence it was taken from. */
  id: string
  /** Fingerprint of the sequence when it was taken, to spot later edits. */
  hash: string
}

export interface DesignPart {
  id: string
  name: string
  role: PartRole
  bases: string
  topology: 'linear' | 'circular'
  annotations: AnnotationData[]
  source?: PartSource
  /** Use only this stretch of the sequence. End below start wraps the origin. */
  region?: { start: number; end: number }
  /** Pin the part to one orientation, or let the engine try both. */
  orientation: PartOrientation
  /**
   * Restriction cloning: the enzymes this part is cut with, chosen by clicking
   * its sites on the map. Unset, it is cut with the design's enzymes, so one
   * list still does for the common case of cutting everything the same way.
   * Per part is what lets a vector cut with BamHI take an insert cut with
   * BglII: different sites, the same GATC overhang. Empty, every site was
   * clicked off again and the part is not cut.
   */
  enzymes?: string[]
  /** Restriction cloning: take the phosphates off this part's ends. */
  dephosphorylated?: boolean
  /**
   * A pair of oligos annealed into the part rather than a piece cut out of a
   * sequence: a short insert is ordered, not digested. Set, the part is not
   * cut at all and brings the ends the two strands leave (see ./duplex);
   * `bases` is its top strand, so its length and its map still read.
   */
  duplex?: OligoDuplex
  /**
   * Restriction and Golden Gate: which digest fragment to keep, by where it
   * sits on the part. Unset means the obvious choice; see ./run.
   */
  keep?: { start: number; end: number }
  damMethylated?: boolean
  dcmMethylated?: boolean
}

export interface CloningDesign {
  method: CloningMethodId
  parts: DesignPart[]
  /**
   * Restriction cloning: shown on every part's map, and what cuts any part
   * that has no enzymes of its own.
   */
  enzymes: string[]
  /** Golden Gate. */
  typeIIS: string
  /** Seamless assembly. */
  kit: KitId
  minOverlap?: number
  maxOverlap?: number
  gateway: GatewayReaction
  topo: TopoVariant
  /**
   * Restriction cloning: join only the fragments being kept, as after a gel
   * purification. Off, every fragment of every digest is in the tube, which
   * is how the off-target products of a one-pot reaction show up.
   */
  purify: boolean
  /** The product chosen as the outcome, by its canonical key. */
  selected?: string
}

export function emptyDesign(method: CloningMethodId = 'homology'): CloningDesign {
  return {
    method,
    parts: [],
    enzymes: [],
    typeIIS: 'BsaI',
    kit: 'hifi',
    gateway: 'LR',
    topo: 'TA',
    purify: true,
  }
}

/**
 * A short fingerprint of a sequence. Not cryptographic: it only has to tell
 * "the same as when the part was taken" from "edited since".
 */
export function sequenceHash(bases: string, topology: string): string {
  let h = 0x811c9dc5
  const text = topology[0] + bases
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i) & 0xdf // fold case
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + text.length.toString(36)
}

let partCounter = 0

/** A fresh part id, unique within the session. */
export function newPartId(): string {
  partCounter += 1
  return `p${Date.now().toString(36)}${partCounter.toString(36)}`
}

/** A part taken from an open document. */
export function partFromDoc(
  doc: DocumentState,
  options: { sourceId?: string; role?: PartRole; region?: { start: number; end: number } } = {},
): DesignPart {
  const bases = doc.sequence.bases
  const topology = doc.sequence.topology
  return {
    id: newPartId(),
    name: doc.name,
    role: options.role ?? (topology === 'circular' ? 'vector' : 'insert'),
    bases,
    topology,
    annotations: doc.annotations.map(a => withoutSegments(a.toData())),
    ...(options.sourceId ? { source: { id: options.sourceId, hash: sequenceHash(bases, topology) } } : {}),
    ...(options.region ? { region: options.region } : {}),
    orientation: 'auto',
    ...(doc.metadata?.damMethylated ? { damMethylated: true } : {}),
    ...(doc.metadata?.dcmMethylated ? { dcmMethylated: true } : {}),
  }
}

/** A part made of two oligos annealed together, not cut from a sequence. */
export function isDuplex(part: DesignPart): boolean {
  return part.duplex !== undefined
}

/**
 * A part from a pair of oligos. The top strand is what the part carries as
 * its bases, so its length, its map and its place in the product read like
 * any other part; the ends come from annealing the two (see ./duplex).
 */
export function partFromDuplex(name: string, duplex: OligoDuplex): DesignPart {
  const { top } = annealOligos(duplex)
  return {
    id: newPartId(),
    name,
    role: 'insert',
    bases: top,
    topology: 'linear',
    annotations: [],
    orientation: 'auto',
    duplex,
  }
}

/**
 * Whether a part still matches the sequence it was taken from.
 *
 * Compared base for base rather than by fingerprint. The fingerprint is what
 * gets saved, for when the source is not to hand, but while the sequence is
 * open there is no reason to trust a summary over the thing itself, and a
 * design wrongly claiming its source has changed is worse than not saying.
 */
export function partMatchesSource(
  part: DesignPart,
  bases: string,
  topology: 'linear' | 'circular',
): boolean {
  if (part.region) {
    // Only the stretch the part uses matters; an edit elsewhere on the
    // sequence leaves it alone.
    const { start, end } = part.region
    const region = end > start ? bases.slice(start, end) : bases.slice(start) + bases.slice(0, end)
    return region.toUpperCase() === partBases(part).toUpperCase()
  }
  return topology === part.topology && bases.toUpperCase() === part.bases.toUpperCase()
}

/** The stretch of a part that takes part in the reaction. */
export function partBases(part: DesignPart): string {
  if (!part.region) return part.bases
  const { start, end } = part.region
  return end > start ? part.bases.slice(start, end) : part.bases.slice(start) + part.bases.slice(0, end)
}

/** Length of the stretch that takes part. */
export function partLength(part: DesignPart): number {
  if (!part.region) return part.bases.length
  const { start, end } = part.region
  return end > start ? end - start : part.bases.length - start + end
}

/** A region of a sequence is a linear piece, whatever the sequence was. */
export function partTopology(part: DesignPart): 'linear' | 'circular' {
  return part.region ? 'linear' : part.topology
}

/** The enzymes a part is cut with in restriction cloning. */
export function partEnzymes(part: DesignPart, design: CloningDesign): string[] {
  return part.enzymes ?? design.enzymes
}

/** Order parts so vectors come first: the backbone reads first in a product. */
export function vectorsFirst(parts: DesignPart[]): DesignPart[] {
  return [...parts.filter(p => p.role === 'vector'), ...parts.filter(p => p.role !== 'vector')]
}

const METHODS: readonly CloningMethodId[] = ['restriction', 'golden-gate', 'homology', 'gateway', 'topo']
const KITS: readonly KitId[] = ['hifi', 'gibson', 'infusion', 'slic']

/**
 * A design read back from storage or a session file, with anything missing
 * or malformed replaced by a default rather than trusted.
 */
export function sanitizeDesign(raw: unknown): CloningDesign | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const base = emptyDesign(METHODS.includes(r.method as CloningMethodId) ? r.method as CloningMethodId : 'homology')

  const parts: DesignPart[] = []
  for (const p of Array.isArray(r.parts) ? r.parts : []) {
    if (!p || typeof p !== 'object') continue
    const q = p as Record<string, unknown>
    if (typeof q.bases !== 'string' || typeof q.name !== 'string') continue
    const region = q.region as { start?: unknown; end?: unknown } | undefined
    const keep = q.keep as { start?: unknown; end?: unknown } | undefined
    const source = q.source as { id?: unknown; hash?: unknown } | undefined
    const duplex = q.duplex as { top?: unknown; bottom?: unknown; phosphate?: unknown } | undefined
    parts.push({
      id: typeof q.id === 'string' ? q.id : newPartId(),
      name: q.name,
      role: q.role === 'vector' ? 'vector' : 'insert',
      bases: q.bases,
      topology: q.topology === 'circular' ? 'circular' : 'linear',
      annotations: Array.isArray(q.annotations) ? q.annotations as AnnotationData[] : [],
      ...(source && typeof source.id === 'string' && typeof source.hash === 'string'
        ? { source: { id: source.id, hash: source.hash } } : {}),
      ...(region && typeof region.start === 'number' && typeof region.end === 'number'
        ? { region: { start: region.start, end: region.end } } : {}),
      orientation: q.orientation === 'forward' || q.orientation === 'reverse' ? q.orientation : 'auto',
      ...(Array.isArray(q.enzymes) && q.enzymes.every(e => typeof e === 'string')
        ? { enzymes: q.enzymes as string[] } : {}),
      ...(q.dephosphorylated === true ? { dephosphorylated: true } : {}),
      ...(keep && typeof keep.start === 'number' && typeof keep.end === 'number'
        ? { keep: { start: keep.start, end: keep.end } } : {}),
      ...(q.damMethylated === true ? { damMethylated: true } : {}),
      ...(q.dcmMethylated === true ? { dcmMethylated: true } : {}),
      ...(duplex && typeof duplex.top === 'string' && typeof duplex.bottom === 'string'
        ? { duplex: { top: duplex.top, bottom: duplex.bottom, phosphate: duplex.phosphate === true } }
        : {}),
    })
  }

  return {
    ...base,
    parts,
    enzymes: Array.isArray(r.enzymes) ? r.enzymes.filter((e): e is string => typeof e === 'string') : [],
    typeIIS: typeof r.typeIIS === 'string' ? r.typeIIS : base.typeIIS,
    kit: KITS.includes(r.kit as KitId) ? r.kit as KitId : base.kit,
    ...(typeof r.minOverlap === 'number' ? { minOverlap: r.minOverlap } : {}),
    ...(typeof r.maxOverlap === 'number' ? { maxOverlap: r.maxOverlap } : {}),
    gateway: r.gateway === 'BP' || r.gateway === 'MultiSite' ? r.gateway : 'LR',
    topo: r.topo === 'Blunt' || r.topo === 'Directional' ? r.topo : 'TA',
    purify: r.purify !== false,
    ...(typeof r.selected === 'string' ? { selected: r.selected } : {}),
  }
}

/**
 * Whether a design is one whose parts are amplified, and so needs primers
 * ordering. The recombination methods join sequences you already have.
 */
export function needsOligos(design: CloningDesign): boolean {
  return (design.method === 'homology' || design.method === 'golden-gate') && design.parts.length > 0
}
