import { describe, it, expect } from 'vitest'
import { getProteinFeatures, EXACT_BELOW } from './protein-features'
import { PROTEIN_LIBRARY_DATA } from './protein-library-data'
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

  it('holds the protein parts list: fusion partners, and tags the curated list leaves out', () => {
    const refs = getProteinFeatures()
    for (const name of ['GST', 'MBP', 'SUMO', 'SNAP-tag', 'HaloTag', 'Trx', 'AU1 tag', 'Ty1 tag']) {
      expect(refs.find(r => r.name === name)).toMatchObject({ category: expect.any(String), color: expect.any(String) })
    }
    expect(refs.find(r => r.name === 'TVMV site')).toMatchObject({ type: 'Site', category: 'Protease site' })
    // Covered already by the curated HRV 3C site, so not listed twice.
    expect(refs.some(r => r.name === 'PreScission')).toBe(false)
  })

  it('leaves out parts too short to mean anything when found', () => {
    expect(PROTEIN_LIBRARY_DATA.filter(([, sequence]) => sequence.length < 6)).toEqual([])
  })

  it('finds a GST fusion at the threshold and proposes one TAP tag, not each version', () => {
    const refs = getProteinFeatures()
    const gst = refs.find(r => r.name === 'GST')!.sequence
    const tap = refs.find(r => r.name === 'TAP')!.sequence
    const protein = 'M' + gst + 'GSGSGS' + tap
    const long = refs.filter(r => r.sequence.length >= EXACT_BELOW)
    const hits = scanForReferences({ documentBases: protein, references: long, minSimilarity: 90, bestMatchOnly: true, protein: true })
    const names = hits.map(h => h.refName)
    expect(names).toContain('GST')
    expect(names.filter(n => n.startsWith('TAP'))).toEqual(['TAP'])
  })

  it('keeps one name per entry, grouping a translated version of a listed part', () => {
    const refs = getProteinFeatures()
    const names = refs.map(r => `${r.name}\u0000${r.type}`)
    expect(names.length).toBe(new Set(names).size)
    // The parts list has Gal4 AD with its NLS; the DNA library's is the bare
    // domain. Both are found in a fusion, and proposed once, as the longer.
    const gal4 = refs.filter(r => r.name.startsWith('Gal4 AD'))
    expect(gal4.length).toBe(2)
    expect(new Set(gal4.map(r => r.group))).toEqual(new Set(['Gal4 AD']))
    const full = gal4.find(r => r.name === 'Gal4 AD')!.sequence
    const hits = scanForReferences({ documentBases: 'MSG' + full + 'GSG', references: gal4, minSimilarity: 85, bestMatchOnly: true, protein: true })
    expect(hits.map(h => h.refName)).toEqual(['Gal4 AD'])
  })

  it('holds shBFP as UniProt does, without the tag of the crystallised construct', () => {
    const sh = getProteinFeatures().find(r => r.name === 'shBFP')!
    expect(sh.sequence.startsWith('MRIKMDMEGTVNGHYFKC')).toBe(true)
  })
})
