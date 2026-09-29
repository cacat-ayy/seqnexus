/**
 * Resolving a target into editable regions.
 *
 * This is where a codon optimizer quietly corrupts a plasmid: by writing a
 * minus-strand gene back in the wrong orientation, or by losing the wrap on an
 * origin-spanning feature. Every case round-trips here.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveTargets, regionEdits, codingFeatures, protectedPositions,
  DEFAULT_TARGET_OPTIONS, type TargetOptions,
} from './targets'
import { geneticCode } from './genetic-codes'
import { Sequence } from '../models/Sequence'
import { Annotation, type AnnotationData } from '../models/Annotation'
import { reverseComplement } from '../models/complement'

const code = geneticCode(1)
const options = (over: Partial<TargetOptions> = {}): TargetOptions =>
  ({ ...DEFAULT_TARGET_OPTIONS, ...over })

const ann = (over: Partial<AnnotationData> = {}) => new Annotation({
  id: 'cds1', name: 'gene', type: 'CDS', start: 0, end: 12, strand: 1, ...over,
})

/** ATG GGT GGT TAA, then filler. */
const CODING = 'ATGGGTGGTTAA'
const seq = (bases = CODING + 'AAACCCGGGTTT') => new Sequence(bases, 'linear')

describe('selection target', () => {
  it('takes the selected bases in order', () => {
    const { regions, warnings } = resolveTargets({
      kind: 'selection', sequence: seq(), annotations: [], code,
      options: options(), selection: { start: 0, end: 12 },
    })
    expect(warnings).toEqual([])
    expect(regions[0].codingBases).toBe(CODING)
    expect(regions[0].map[0]).toBe(0)
    expect(regions[0].reverse).toBe(false)
  })

  it('trims a length that is not a multiple of three, and says so', () => {
    const { regions, warnings } = resolveTargets({
      kind: 'selection', sequence: seq(), annotations: [], code,
      options: options(), selection: { start: 0, end: 13 },
    })
    expect(regions[0].codingBases).toHaveLength(12)
    expect(regions[0].remainder).toBe(1)
    expect(warnings[0]).toContain('not a multiple of 3')
  })

  it('explains an empty selection rather than optimizing nothing', () => {
    const { regions, warnings } = resolveTargets({
      kind: 'selection', sequence: seq(), annotations: [], code,
      options: options(), selection: null,
    })
    expect(regions).toEqual([])
    expect(warnings[0]).toContain('No selection')
  })
})

describe('whole sequence target', () => {
  it('reads frame 1 from the start', () => {
    const { regions } = resolveTargets({
      kind: 'whole', sequence: new Sequence(CODING, 'linear'), annotations: [], code,
      options: options(),
    })
    expect(regions[0].codingBases).toBe(CODING)
  })
})

describe('coding feature targets', () => {
  it('reads a plus-strand feature straight off the sequence', () => {
    const { regions } = resolveTargets({
      kind: 'cds', sequence: seq(), annotations: [ann()], code, options: options(),
    })
    expect(regions).toHaveLength(1)
    expect(regions[0].codingBases).toBe(CODING)
    expect(regions[0].label).toBe('gene')
  })

  it('reads a minus-strand feature in its own direction', () => {
    const bases = reverseComplement(CODING) + 'AAACCC'
    const { regions } = resolveTargets({
      kind: 'cds', sequence: new Sequence(bases, 'linear'),
      annotations: [ann({ strand: -1 })], code, options: options(),
    })
    expect(regions[0].reverse).toBe(true)
    expect(regions[0].codingBases).toBe(CODING)
    // The map runs backwards down the sequence.
    expect(regions[0].map[0]).toBe(11)
    expect(regions[0].map[11]).toBe(0)
  })

  it('follows an origin-spanning feature round the join', () => {
    // The gene starts at base 16 of a 20 bp circle and wraps to base 8.
    const bases = CODING.slice(4) + 'AAAACCCC' + CODING.slice(0, 4)
    const sequence = new Sequence(bases, 'circular')
    const { regions } = resolveTargets({
      kind: 'cds', sequence, annotations: [ann({ start: 16, end: 8 })], code, options: options(),
    })
    expect(regions[0].codingBases).toBe(CODING)
    expect(regions[0].map.slice(0, 5)).toEqual([16, 17, 18, 19, 0])
  })

  it('honours /codon_start', () => {
    const bases = 'C' + CODING
    const { regions } = resolveTargets({
      kind: 'cds', sequence: new Sequence(bases, 'linear'),
      annotations: [ann({ start: 0, end: 13, qualifiers: { codon_start: ['2'] } })],
      code, options: options(),
    })
    expect(regions[0].codingBases).toBe(CODING)
    expect(regions[0].map[0]).toBe(1)
  })

  it('skips a second feature that overlaps one already being optimized', () => {
    const { regions, warnings } = resolveTargets({
      kind: 'cds', sequence: seq(),
      annotations: [ann(), ann({ id: 'cds2', name: 'overlapping', start: 6, end: 18 })],
      code, options: options(),
    })
    expect(regions.map(r => r.id)).toEqual(['cds1'])
    expect(warnings[0]).toContain('overlaps')
  })

  it('optimizes only the features asked for', () => {
    const { regions } = resolveTargets({
      kind: 'cds', sequence: seq(),
      annotations: [ann(), ann({ id: 'cds2', name: 'other', start: 12, end: 24 })],
      code, options: options(), featureIds: new Set(['cds2']),
    })
    expect(regions.map(r => r.id)).toEqual(['cds2'])
  })

  it('says when there is nothing coding to work on', () => {
    const { regions, warnings } = resolveTargets({
      kind: 'cds', sequence: seq(),
      annotations: [ann({ type: 'promoter' })], code, options: options(),
    })
    expect(regions).toEqual([])
    expect(warnings[0]).toContain('No coding features')
  })
})

describe('locked codons', () => {
  const resolve = (o: Partial<TargetOptions>, annotations = [ann()]) =>
    resolveTargets({ kind: 'cds', sequence: seq(), annotations, code, options: options(o) }).regions[0]

  it('locks the initiator and the stop by default', () => {
    const region = resolve({})
    expect(region.locked.get(0)).toBe('start codon')
    expect(region.locked.get(3)).toBe('stop codon')
    expect(region.locked.has(1)).toBe(false)
  })

  it('can be told not to', () => {
    const region = resolve({ keepStartCodon: false, keepStopCodon: false })
    expect(region.locked.size).toBe(0)
  })

  it("locks the first N codons when asked", () => {
    const region = resolve({ keepStartCodon: false, keepStopCodon: false, keepFirstCodons: 2 })
    expect(region.locked.get(0)).toContain('kept')
    expect(region.locked.get(1)).toContain('kept')
    expect(region.locked.has(2)).toBe(false)
  })

  it('locks codons under a protected feature', () => {
    const rbs = new Annotation({
      id: 'rbs', name: 'RBS', type: 'RBS', start: 3, end: 6, strand: 0,
    })
    const region = resolve({}, [ann(), rbs])
    expect(region.locked.get(1)).toBe('protected feature')

    const unprotected = resolve({ protectFeatures: false }, [ann(), rbs])
    expect(unprotected.locked.has(1)).toBe(false)
  })

  it('locks a codon it cannot translate', () => {
    const region = resolveTargets({
      kind: 'cds', sequence: new Sequence('ATGNNNGGTTAA', 'linear'),
      annotations: [ann()], code, options: options(),
    }).regions[0]
    expect(region.locked.get(1)).toBe('ambiguous bases')
  })

  it('does not treat the target itself as a protected feature', () => {
    expect(protectedPositions([ann()], 24, new Set(['cds1'])).size).toBe(0)
    // A non-coding feature elsewhere is protected.
    const rbs = new Annotation({ id: 'r', name: 'RBS', type: 'RBS', start: 2, end: 5, strand: 0 })
    expect(protectedPositions([rbs], 24, new Set(['cds1'])).size).toBe(3)
  })
})

describe('codingFeatures', () => {
  it('lists real coding features in sequence order, skipping overlays', () => {
    const overlay = new Annotation({
      id: '_orf_1:0:12:1', name: 'ORF', type: 'CDS', start: 0, end: 12, strand: 1,
    })
    const list = codingFeatures([ann({ id: 'b', start: 30, end: 42 }), ann({ id: 'a' }), overlay])
    expect(list.map(a => a.id)).toEqual(['a', 'b'])
  })
})

describe('regionEdits', () => {
  const resolveOne = (annotation: Annotation, sequence: Sequence) =>
    resolveTargets({
      kind: 'cds', sequence, annotations: [annotation], code, options: options(),
    }).regions[0]

  it('writes a plus-strand region as one edit', () => {
    const region = resolveOne(ann(), seq())
    const edits = regionEdits(region, 'ATGGGCGGCTAA')
    expect(edits).toEqual([{ start: 0, end: 12, bases: 'ATGGGCGGCTAA' }])
  })

  it('reverse-complements a minus-strand region back onto the plus strand', () => {
    const bases = reverseComplement(CODING) + 'AAACCC'
    const region = resolveOne(ann({ strand: -1 }), new Sequence(bases, 'linear'))
    const optimized = 'ATGGGCGGCTAA'
    const edits = regionEdits(region, optimized)

    expect(edits).toEqual([
      { start: 0, end: 12, bases: reverseComplement(optimized) },
    ])
  })

  it('splits an origin-spanning region at the join', () => {
    const bases = CODING.slice(4) + 'AAAACCCC' + CODING.slice(0, 4)
    const region = resolveOne(ann({ start: 16, end: 8 }), new Sequence(bases, 'circular'))
    const edits = regionEdits(region, 'ATGGGCGGCTAA')

    expect(edits).toHaveLength(2)
    expect(edits[0]).toEqual({ start: 16, end: 20, bases: 'ATGG' })
    expect(edits[1]).toEqual({ start: 0, end: 8, bases: 'GCGGCTAA' })
  })

  it('refuses a length that does not match the region', () => {
    const region = resolveOne(ann(), seq())
    expect(() => regionEdits(region, 'ATG')).toThrow()
  })
})
