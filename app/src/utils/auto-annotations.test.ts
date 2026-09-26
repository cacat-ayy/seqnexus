/**
 * Proposal filtering.
 *
 * The overlap rule carries two requirements at once: a match converted into a
 * feature must never be proposed again, and a match that appears only because
 * the user loosened the similarity threshold (or enabled another database)
 * must be proposed even though the scan around it has not changed.
 */
import { describe, it, expect } from 'vitest'
import {
  AUTO_ID_PREFIX, matchKey, autoIdFor, keyFromAutoId, isAutoAnnotationId,
  isAlreadyAnnotated, proposalsFrom, proposalAnnotations, proposalName,
} from './auto-annotations'
import type { AnnotationMatch } from '../workers/annotate-list'

const match = (over: Partial<AnnotationMatch> = {}): AnnotationMatch => ({
  refName: 'AmpR', refType: 'CDS', start: 100, end: 400, strand: 1, similarity: 98,
  color: '#ff0000', ...over,
})

/** A feature as the store holds it — only the fields the rule reads. */
const feature = (over: Partial<{ type: string; strand: number; start: number; end: number }> = {}) =>
  ({ type: 'CDS', strand: 1, start: 100, end: 400, ...over })

describe('match keys', () => {
  it('round-trips through the annotation id', () => {
    const m = match()
    expect(keyFromAutoId(autoIdFor(m))).toBe(matchKey(m))
  })

  it('survives a name containing the key separator', () => {
    const m = match({ refName: 'pUC:ori' })
    expect(keyFromAutoId(autoIdFor(m))).toBe(matchKey(m))
  })

  it('distinguishes real annotation ids from proposals', () => {
    expect(isAutoAnnotationId(AUTO_ID_PREFIX + 'x')).toBe(true)
    expect(isAutoAnnotationId('ref_3')).toBe(false)
    expect(keyFromAutoId('ref_3')).toBeNull()
  })

  it('separates hits of the same feature at different positions', () => {
    expect(matchKey(match({ start: 100 }))).not.toBe(matchKey(match({ start: 900 })))
  })
})

describe('isAlreadyAnnotated', () => {
  it('suppresses a match the document already covers exactly', () => {
    expect(isAlreadyAnnotated(match(), [feature()], 75)).toBe(true)
  })

  it('keeps a match whose overlap is below the threshold', () => {
    // 100 bp of a 300 bp match: 33% — under 75 either way.
    expect(isAlreadyAnnotated(match(), [feature({ start: 300, end: 400 })], 75)).toBe(false)
  })

  it('requires the overlap to be reciprocal', () => {
    // The match sits entirely inside a much larger feature: 100% of the match,
    // but only 10% of the feature. A primer site must not hide a whole gene.
    expect(isAlreadyAnnotated(match(), [feature({ start: 0, end: 3000 })], 75)).toBe(false)
  })

  it('does not match across types or strands', () => {
    expect(isAlreadyAnnotated(match(), [feature({ type: 'promoter' })], 75)).toBe(false)
    expect(isAlreadyAnnotated(match(), [feature({ strand: -1 })], 75)).toBe(false)
  })

  it('ignores features that do not overlap at all', () => {
    expect(isAlreadyAnnotated(match(), [feature({ start: 900, end: 1200 })], 75)).toBe(false)
  })
})

describe('proposalsFrom', () => {
  it('proposes everything when the document has no features', () => {
    const matches = [match(), match({ start: 900, end: 1200 })]
    expect(proposalsFrom(matches, [], 75)).toHaveLength(2)
  })

  it('drops only the converted match, keeping the rest', () => {
    const converted = match()
    const other = match({ refName: 'lacZ', start: 900, end: 1200 })
    const proposals = proposalsFrom([converted, other], [feature()], 75)
    expect(proposals.map(m => m.refName)).toEqual(['lacZ'])
  })

  it('shows matches that a looser threshold newly found', () => {
    // The user converted AmpR, then dropped min. similarity: the same scan now
    // also returns a weak lacZ hit. AmpR stays suppressed, lacZ appears.
    const strictRun = [match()]
    const looseRun = [match(), match({ refName: 'lacZ', start: 900, end: 1200, similarity: 71 })]
    const doc = [feature()]
    expect(proposalsFrom(strictRun, doc, 75)).toHaveLength(0)
    expect(proposalsFrom(looseRun, doc, 75).map(m => m.refName)).toEqual(['lacZ'])
  })
})

describe('proposalAnnotations', () => {
  it('carries the match through as a renderable annotation', () => {
    const [ann] = proposalAnnotations([match()])
    expect(ann.id).toBe(autoIdFor(match()))
    expect(ann.name).toBe(proposalName(match()))
    expect(ann.type).toBe('CDS')
    expect(ann.start).toBe(100)
    expect(ann.end).toBe(400)
    expect(ann.strand).toBe(1)
    expect(ann.color).toBe('#ff0000')
  })

  it('falls back to the type colour when the database has none', () => {
    const [ann] = proposalAnnotations([match({ color: undefined })])
    expect(ann.color).toBeTruthy()
  })
})
