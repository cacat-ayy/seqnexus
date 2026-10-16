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
  isAlreadyAnnotated, isCoveredByAnnotation, proposalsFrom, proposalAnnotations, proposalName,
  suggestionLoci, offeredSuggestions, isRejected,
} from './auto-annotations'
import type { AnnotationMatch } from '../workers/annotate-list'

const match = (over: Partial<AnnotationMatch> = {}): AnnotationMatch => ({
  refName: 'AmpR', refType: 'CDS', start: 100, end: 400, strand: 1, similarity: 98,
  color: '#ff0000', ...over,
})

/** A feature as the store holds it: only the fields the rule reads. */
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
    // 100 bp of a 300 bp match: 33%, under 75 either way.
    expect(isAlreadyAnnotated(match(), [feature({ start: 300, end: 400 })], 75)).toBe(false)
  })

  it('requires the overlap to be reciprocal', () => {
    // The match sits entirely inside a much larger feature: 100% of the match,
    // but only 10% of the feature. A primer site must not hide a whole gene.
    expect(isAlreadyAnnotated(match(), [feature({ start: 0, end: 3000 })], 75)).toBe(false)
  })

  it('counts a feature of any type or strand on the same stretch', () => {
    // A curator's "protein_bind" lac operator is the library's "lacO"
    // misc_feature; an unoriented polyA signal is the library's terminator.
    expect(isAlreadyAnnotated(match(), [feature({ type: 'promoter' })], 75)).toBe(true)
    expect(isAlreadyAnnotated(match(), [feature({ strand: -1 })], 75)).toBe(true)
    expect(isAlreadyAnnotated(match(), [feature({ strand: 0 })], 75)).toBe(true)
  })

  it('measures a span across the origin as one, given the length', () => {
    // A 300 bp match across the origin of a 1000 bp plasmid, 900..200.
    const across = match({ start: 900, end: 200 })
    const same = feature({ start: 900, end: 200 })
    expect(isAlreadyAnnotated(across, [same], 75, 1000)).toBe(true)
    expect(isAlreadyAnnotated(across, [feature({ start: 0, end: 200 })], 75, 1000)).toBe(false)
    // Without the length a wrapping span cannot be measured, and covers nothing.
    expect(isAlreadyAnnotated(across, [same], 75)).toBe(false)
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

  it('marks a copy with an end missing as partial and truncated', () => {
    const partial = match({ coverage: 90, similarity: 91.3 })
    expect(proposalName(partial)).toBe('AmpR (partial, 91.3%)')
    expect(proposalName(match())).toBe('AmpR (98%)')
    const [ann] = proposalAnnotations([partial])
    expect(ann.truncated).toBe(true)
    expect(proposalAnnotations([match()])[0].truncated).toBeFalsy()
  })
})

describe('suggestionLoci', () => {
  const gfp = (refName: string, similarity: number, over: Partial<AnnotationMatch> = {}) =>
    match({ refName, similarity, start: 600, end: 1320, ...over })

  it('offers relatives on one stretch once, the best first, with the rest behind it', () => {
    const loci = suggestionLoci([gfp('EGFP', 98.8), gfp('ECFP', 98.9), gfp('EYFP', 98.6)])
    expect(loci).toHaveLength(1)
    expect(loci[0].shown.refName).toBe('ECFP')
    expect(loci[0].members.map(m => m.refName)).toEqual(['ECFP', 'EGFP', 'EYFP'])
  })

  it('shows the relative the user picked instead of the best', () => {
    const list = [gfp('EGFP', 98.8), gfp('ECFP', 98.9)]
    const [locus] = suggestionLoci(list, undefined, new Set([matchKey(list[0])]))
    expect(locus.shown.refName).toBe('EGFP')
  })

  it('keeps elements apart that only overlap: a promoter inside a gene, a short tag', () => {
    const gene = match({ refName: 'lacZ', start: 0, end: 3000 })
    const inside = match({ refName: 'lacZα', start: 0, end: 300 })
    expect(suggestionLoci([gene, inside])).toHaveLength(2)
  })

  it('keeps elements of different types apart on the same bases', () => {
    const promoter = match({ refName: 'SV40', refType: 'promoter', start: 0, end: 200 })
    const origin = match({ refName: 'SV40 ori', refType: 'rep_origin', start: 0, end: 190 })
    expect(suggestionLoci([promoter, origin])).toHaveLength(2)
  })

  it('gathers relatives across the origin of a circular sequence', () => {
    const a = match({ refName: 'A', start: 900, end: 200, similarity: 99 })
    const b = match({ refName: 'B', start: 905, end: 200, similarity: 97 })
    expect(suggestionLoci([a, b], 1000)).toHaveLength(1)
  })

  it('lists loci in position order', () => {
    const loci = suggestionLoci([match({ refName: 'late', start: 900, end: 1000 }), match({ refName: 'early', start: 10, end: 100 })])
    expect(loci.map(l => l.shown.refName)).toEqual(['early', 'late'])
  })
})

describe('offeredSuggestions', () => {
  it('leaves out what the document covers and what the user rejected', () => {
    const amp = match()
    const lac = match({ refName: 'lacZ', start: 900, end: 1200 })
    const kan = match({ refName: 'kanR', start: 2000, end: 2800 })
    const offered = offeredSuggestions([amp, lac, kan], [feature()], 75, 5000, [{ name: 'kanR', type: 'CDS' }])
    expect(offered.map(l => l.shown.refName)).toEqual(['lacZ'])
  })

  it('rejects by name and type, not by name alone', () => {
    const promoter = match({ refName: 'URA3', refType: 'promoter', start: 0, end: 200 })
    expect(isRejected(promoter, [{ name: 'URA3', type: 'CDS' }])).toBe(false)
    expect(isRejected(promoter, [{ name: 'URA3', type: 'promoter' }])).toBe(true)
  })
})

describe('isCoveredByAnnotation for the ORF overlay', () => {
  it('still requires the same type and strand by default', () => {
    const orf = { type: 'CDS', strand: 1, start: 100, end: 400 }
    expect(isCoveredByAnnotation(orf, [feature()], 75)).toBe(true)
    expect(isCoveredByAnnotation(orf, [feature({ type: 'promoter' })], 75)).toBe(false)
    expect(isCoveredByAnnotation(orf, [feature({ strand: -1 })], 75)).toBe(false)
  })
})
