/**
 * Turning ORFs into features.
 *
 * The rule that differs from auto-annotation suggestions: an ORF a CDS already
 * covers stays visible in the overlay, but is not something a conversion adds
 * again. These tests pin that asymmetry down.
 */
import { describe, it, expect } from 'vitest'
import {
  ORF_ID_PREFIX, orfKey, orfIdFor, keyFromOrfId, isOrfId, orfName,
  isOrfAnnotated, convertibleOrfs, orfToAnnotationData,
} from './orf-features'
import type { ORFResult } from '../workers/orf-finder'

const orf = (over: Partial<ORFResult> = {}): ORFResult => ({
  start: 100, end: 400, strand: 1, frame: 0, codons: 100, ...over,
})

const cds = (over: Partial<{ type: string; strand: number; start: number; end: number }> = {}) =>
  ({ type: 'CDS', strand: 1, start: 100, end: 400, ...over })

describe('ORF identity', () => {
  it('round-trips through the annotation id', () => {
    expect(keyFromOrfId(orfIdFor(orf()))).toBe(orfKey(orf()))
    expect(isOrfId(orfIdFor(orf()))).toBe(true)
  })

  it('keeps the prefix the rest of the app tests for', () => {
    expect(orfIdFor(orf()).startsWith('_orf_')).toBe(true)
    expect(ORF_ID_PREFIX).toBe('_orf_')
  })

  it('is not an index, so a re-scan that reorders results keeps picks valid', () => {
    const a = orf({ start: 100 })
    const b = orf({ start: 900, end: 1200 })
    expect(orfKey(a)).not.toBe(orfKey(b))
    // Same ORF found again after a settings change — same key.
    expect(orfKey({ ...a })).toBe(orfKey(a))
  })

  it('distinguishes the same span on the other strand or frame', () => {
    expect(orfKey(orf({ strand: -1 }))).not.toBe(orfKey(orf()))
    expect(orfKey(orf({ frame: 2 }))).not.toBe(orfKey(orf()))
  })

  it('ignores ids belonging to something else', () => {
    expect(keyFromOrfId('_auto_AmpR:0:30:1')).toBeNull()
    expect(keyFromOrfId('ref_3')).toBeNull()
  })
})

describe('coverage', () => {
  it('treats an exact CDS as covering the ORF', () => {
    expect(isOrfAnnotated(orf(), [cds()])).toBe(true)
  })

  it('leaves an ORF that merely overlaps a neighbouring CDS convertible', () => {
    // 80% of the ORF, but the threshold is deliberately tight.
    expect(isOrfAnnotated(orf(), [cds({ start: 160, end: 400 })])).toBe(false)
  })

  it('ignores features of another type or strand', () => {
    expect(isOrfAnnotated(orf(), [cds({ type: 'gene' })])).toBe(false)
    expect(isOrfAnnotated(orf(), [cds({ strand: -1 })])).toBe(false)
  })

  it('filters only the covered ORFs out of a conversion', () => {
    const covered = orf()
    const free = orf({ start: 900, end: 1200 })
    expect(convertibleOrfs([covered, free], [cds()])).toEqual([free])
    expect(convertibleOrfs([covered, free], [])).toHaveLength(2)
  })
})

describe('orfToAnnotationData', () => {
  it('keeps the label and colour the overlay was already showing', () => {
    const data = orfToAnnotationData(orf({ strand: -1, frame: 1, codons: 42 }))
    expect(data.name).toBe(orfName(orf({ strand: -1, frame: 1, codons: 42 })))
    expect(data.name).toBe('ORF −2 (42 aa)')
    expect(data.type).toBe('CDS')
    expect(data.strand).toBe(-1)
    expect(data.color).toBeTruthy()
  })

  it('mints a fresh id per feature', () => {
    const a = orfToAnnotationData(orf())
    const b = orfToAnnotationData(orf())
    expect(a.id).not.toBe(b.id)
  })
})
