/**
 * What to optimize, resolved into something the optimizer can walk.
 *
 * The awkward part of a codon optimizer is not the codons, it is the
 * bookkeeping: a CDS may sit on the minus strand, may declare a reading frame
 * offset, and on a circular plasmid may wrap the origin. Rather than special
 * case each combination in the optimizer, every target is reduced here to a
 * coding-strand string plus a map from each of its bases back to the genomic
 * index it came from. Writing the result back is then the same operation for
 * all of them: walk the map, complement if the region was read backwards.
 */

import type { Annotation } from '../models/Annotation'
import type { Sequence } from '../models/Sequence'
import { complementBase } from '../models/complement'
import { isCodingAnnotation } from '../utils/annotation-sequence'
import type { GeneticCode } from './genetic-codes'

export type TargetKind = 'selection' | 'cds' | 'whole'

export interface TargetRegion {
  /** Stable id: the annotation id, or the kind for the other two. */
  id: string
  label: string
  /** Bases as the ribosome reads them: plus strand, frame applied. */
  codingBases: string
  /** Genomic index of each coding base. */
  map: number[]
  /** True when the region was read off the minus strand. */
  reverse: boolean
  /** Codon indices that must not change, and why. */
  locked: Map<number, string>
  /** Trailing bases that did not make up a whole codon. */
  remainder: number
}

export interface TargetOptions {
  /** Leave the first codon alone when it is an initiator. */
  keepStartCodon: boolean
  /** Leave a terminal stop codon alone. */
  keepStopCodon: boolean
  /** Leave this many codons at the 5' end untouched. */
  keepFirstCodons: number
  /** Do not rewrite bases covered by a non-coding annotated feature. */
  protectFeatures: boolean
}

export const DEFAULT_TARGET_OPTIONS: TargetOptions = {
  keepStartCodon: true,
  keepStopCodon: true,
  keepFirstCodons: 0,
  protectFeatures: true,
}

/** GenBank /codon_start is 1-based: 2 means skip one base. */
function codonStartOffset(ann: Annotation): number {
  const raw = ann.qualifiers?.codon_start?.[0]
  if (!raw) return 0
  const n = parseInt(raw, 10)
  return n === 2 || n === 3 ? n - 1 : 0
}

/** Genomic indices of a feature, in the order the ribosome reads them. */
function codingMap(ann: Annotation, seqLength: number): number[] {
  const indices: number[] = []
  if (ann.start > ann.end) {
    // Wraps the origin: tail then head, in plus-strand order.
    for (let i = ann.start; i < seqLength; i++) indices.push(i)
    for (let i = 0; i < ann.end; i++) indices.push(i)
  } else {
    for (let i = ann.start; i < ann.end; i++) indices.push(i)
  }
  if (ann.strand === -1) indices.reverse()
  return indices.slice(codonStartOffset(ann))
}

function basesFor(map: readonly number[], sequence: Sequence, reverse: boolean): string {
  const out: string[] = new Array(map.length)
  for (let i = 0; i < map.length; i++) {
    const base = sequence.baseAt(map[i]).toUpperCase()
    out[i] = reverse ? complementBase(base) : base
  }
  return out.join('')
}

/**
 * Codon indices to leave alone.
 *
 * Three different reasons land in the same map so the optimizer only has to
 * consult one thing, and the report can say which reason applied.
 */
function lockedCodons(
  region: Omit<TargetRegion, 'locked'>,
  code: GeneticCode,
  options: TargetOptions,
  protectedPositions: ReadonlySet<number> | null,
): Map<number, string> {
  const locked = new Map<number, string>()
  const codonCount = Math.floor(region.codingBases.length / 3)

  if (options.keepStartCodon && codonCount > 0) {
    const first = region.codingBases.slice(0, 3)
    if (code.starts.includes(first)) locked.set(0, 'start codon')
  }
  if (options.keepStopCodon && codonCount > 0) {
    const last = region.codingBases.slice((codonCount - 1) * 3, codonCount * 3)
    if (code.table[last] === '*') locked.set(codonCount - 1, 'stop codon')
  }
  for (let i = 0; i < Math.min(options.keepFirstCodons, codonCount); i++) {
    if (!locked.has(i)) locked.set(i, "kept 5' codon")
  }
  if (protectedPositions && protectedPositions.size > 0) {
    for (let i = 0; i < codonCount; i++) {
      if (locked.has(i)) continue
      for (let b = 0; b < 3; b++) {
        if (protectedPositions.has(region.map[i * 3 + b])) {
          locked.set(i, 'protected feature')
          break
        }
      }
    }
  }
  // A codon containing anything but ACGT cannot be translated, so it cannot be
  // swapped for a synonym either.
  for (let i = 0; i < codonCount; i++) {
    if (locked.has(i)) continue
    const codon = region.codingBases.slice(i * 3, i * 3 + 3)
    if (!code.table[codon]) locked.set(i, 'ambiguous bases')
  }
  return locked
}

/**
 * Genomic positions covered by features that should not be rewritten.
 *
 * Coding features are excluded: those are the target. What this protects is
 * everything else that happens to sit inside one, which on a real plasmid
 * means ribosome binding sites, primer binding sites, tags and overlapping
 * regulatory elements.
 */
export function protectedPositions(
  annotations: readonly Annotation[],
  seqLength: number,
  targetIds: ReadonlySet<string>,
): Set<number> {
  const out = new Set<number>()
  for (const ann of annotations) {
    if (ann.id.startsWith('_')) continue
    if (targetIds.has(ann.id)) continue
    if (isCodingAnnotation(ann)) continue
    if (ann.start > ann.end) {
      for (let i = ann.start; i < seqLength; i++) out.add(i)
      for (let i = 0; i < ann.end; i++) out.add(i)
    } else {
      for (let i = ann.start; i < ann.end; i++) out.add(i)
    }
  }
  return out
}

/** Coding features worth offering as targets, in sequence order. */
export function codingFeatures(annotations: readonly Annotation[]): Annotation[] {
  return annotations
    .filter(a => !a.id.startsWith('_') && isCodingAnnotation(a))
    .slice()
    .sort((a, b) => a.start - b.start)
}

export interface ResolveInput {
  kind: TargetKind
  sequence: Sequence
  annotations: readonly Annotation[]
  code: GeneticCode
  options: TargetOptions
  /** For kind 'selection'. */
  selection?: { start: number; end: number } | null
  /** For kind 'cds': which features to include. Empty means all of them. */
  featureIds?: ReadonlySet<string>
}

export interface ResolveResult {
  regions: TargetRegion[]
  /** Reasons a region was skipped or trimmed, for the UI to show up front. */
  warnings: string[]
}

/** Turn the target choice into regions, with the reasons anything was dropped. */
export function resolveTargets(input: ResolveInput): ResolveResult {
  const { kind, sequence, annotations, code, options } = input
  const warnings: string[] = []
  const regions: TargetRegion[] = []
  const seqLength = sequence.length

  const finish = (
    id: string, label: string, map: number[], reverse: boolean, protect: ReadonlySet<number> | null,
  ) => {
    const remainder = map.length % 3
    if (remainder !== 0) {
      warnings.push(
        `${label}: length ${map.length} is not a multiple of 3, the last ${remainder} base${remainder === 1 ? '' : 's'} left as-is`,
      )
    }
    const usable = map.slice(0, map.length - remainder)
    if (usable.length === 0) {
      warnings.push(`${label}: too short to hold a codon`)
      return
    }
    const base: Omit<TargetRegion, 'locked'> = {
      id, label, map: usable, reverse, remainder,
      codingBases: basesFor(usable, sequence, reverse),
    }
    regions.push({ ...base, locked: lockedCodons(base, code, options, protect) })
  }

  if (kind === 'selection') {
    const sel = input.selection
    if (!sel || sel.end <= sel.start) {
      warnings.push('No selection: select a region or choose another target')
      return { regions, warnings }
    }
    const map: number[] = []
    for (let i = sel.start; i < Math.min(sel.end, seqLength); i++) map.push(i)
    const protect = options.protectFeatures
      ? protectedPositions(annotations, seqLength, new Set())
      : null
    finish('selection', 'Selection', map, false, protect)
    return { regions, warnings }
  }

  if (kind === 'whole') {
    const map: number[] = []
    for (let i = 0; i < seqLength; i++) map.push(i)
    const protect = options.protectFeatures
      ? protectedPositions(annotations, seqLength, new Set())
      : null
    finish('whole', 'Whole sequence', map, false, protect)
    return { regions, warnings }
  }

  const wanted = input.featureIds
  const features = codingFeatures(annotations)
    .filter(a => !wanted || wanted.size === 0 || wanted.has(a.id))
  if (features.length === 0) {
    warnings.push('No coding features to optimize')
    return { regions, warnings }
  }

  const targetIds = new Set(features.map(f => f.id))
  const protect = options.protectFeatures
    ? protectedPositions(annotations, seqLength, targetIds)
    : null

  // Two CDSs that share bases cannot both be optimized: rewriting one changes
  // the other's reading frame. The first one wins and the overlap is reported.
  const claimed = new Set<number>()
  for (const ann of features) {
    const map = codingMap(ann, seqLength)
    const clash = map.some(i => claimed.has(i))
    if (clash) {
      warnings.push(`${ann.name || ann.id}: overlaps a feature already being optimized, skipped`)
      continue
    }
    for (const i of map) claimed.add(i)
    finish(ann.id, ann.name || ann.id, map, ann.strand === -1, protect)
  }

  return { regions, warnings }
}

/** The edits that write an optimized region back to the document. */
export function regionEdits(
  region: TargetRegion, optimized: string,
): { start: number; end: number; bases: string }[] {
  if (optimized.length !== region.map.length) {
    throw new Error('optimized region length does not match the target')
  }
  // Contiguous runs of genomic positions become one edit each: a plus-strand
  // feature is a single edit, a minus-strand one is still contiguous but
  // reversed, and only an origin-spanning feature produces two.
  const edits: { start: number; end: number; bases: string }[] = []
  let runStart = 0
  const step = region.reverse ? -1 : 1
  for (let i = 1; i <= region.map.length; i++) {
    const continues = i < region.map.length && region.map[i] === region.map[i - 1] + step
    if (continues) continue
    const first = region.map[runStart]
    const last = region.map[i - 1]
    const chunk = optimized.slice(runStart, i)
    const bases = region.reverse
      ? chunk.split('').reverse().map(complementBase).join('')
      : chunk
    edits.push({
      start: Math.min(first, last),
      end: Math.max(first, last) + 1,
      bases,
    })
    runStart = i
  }
  return edits
}
