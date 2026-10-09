import { describe, it, expect } from 'vitest'
import { getProteinFeatures, EXACT_BELOW } from './protein-features'
import { scanForReferences } from './annotate-scan'

describe('protein feature library', () => {
  it('holds the curated peptides and the translated coding entries, without stops', () => {
    const refs = getProteinFeatures()
    const names = new Set(refs.map(r => r.name))
    expect(names.has('6xHis')).toBe(true)
    expect(names.has('TEV site')).toBe(true)
    expect(names.has('P2A')).toBe(true)
    // A translated marker from the DNA library.
    expect(names.has('ampR')).toBe(true)
    expect(refs.every(r => !r.sequence.includes('*') && !r.sequence.includes('?'))).toBe(true)
    expect(refs.find(r => r.name === 'ampR')!.sequence.startsWith('M')).toBe(true)
  })

  it('is found in a protein by the scan, on one strand, exactly for short peptides', () => {
    const protein = 'MGSSHHHHHHSSGLVPRGSHMASMTGGQQMGRGS' + 'ENLYFQG' + 'MKVLAAGIVGLLLAAQPAMA'
    const refs = getProteinFeatures().filter(r => r.sequence.length < EXACT_BELOW)
    const hits = scanForReferences({ documentBases: protein, references: refs, minSimilarity: 100, bestMatchOnly: true, protein: true })
    const found = hits.map(h => [h.refName, h.start, h.end])
    expect(found).toContainEqual(['6xHis', 4, 10])
    expect(found).toContainEqual(['Thrombin site', 13, 19])
    expect(found).toContainEqual(['TEV site', 34, 41])
    expect(hits.every(h => h.strand === 1)).toBe(true)
  })
})
