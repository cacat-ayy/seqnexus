import { describe, it, expect } from 'vitest'
import { uniprotDocument, uniprotFeatures, looksLikeUniProt } from './uniprot'

/** The shape of rest.uniprot.org/uniprotkb/P69905.json, cut down. */
const ENTRY = {
  primaryAccession: 'P69905',
  uniProtkbId: 'HBA_HUMAN',
  entryType: 'UniProtKB reviewed (Swiss-Prot)',
  organism: { scientificName: 'Homo sapiens', commonName: 'Human' },
  proteinDescription: { recommendedName: { fullName: { value: 'Hemoglobin subunit alpha' } } },
  genes: [{ geneName: { value: 'HBA1' } }],
  sequence: { value: 'MVLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHFDLSHGSAQVKGHGKKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR' },
  features: [
    { type: 'Initiator methionine', location: { start: { value: 1 }, end: { value: 1 } }, description: 'Removed' },
    { type: 'Chain', location: { start: { value: 2 }, end: { value: 142 } }, description: 'Hemoglobin subunit alpha', featureId: 'PRO_0000052653' },
    { type: 'Domain', location: { start: { value: 2 }, end: { value: 142 } }, description: 'Globin' },
    { type: 'Binding site', location: { start: { value: 59 }, end: { value: 59 } }, description: 'Fe (heme)' },
    { type: 'Modified residue', location: { start: { value: 4 }, end: { value: 4 } }, description: 'Phosphoserine' },
    { type: 'Natural variant', location: { start: { value: 7 }, end: { value: 7 } }, description: 'in Hb Swan River', featureId: 'VAR_002771', alternativeSequence: { originalSequence: 'D', alternativeSequences: ['G'] } },
    { type: 'Helix', location: { start: { value: 5 }, end: { value: 17 } } },
    { type: 'Sequence conflict', location: { start: { value: 3 }, end: { value: 3 } }, description: 'in Ref. 2' },
    { type: 'Disulfide bond', location: { start: { value: 10 }, end: { value: 20 } } },
    { type: 'Disulfide bond', location: { start: { value: 30 }, end: { value: 30 } }, description: 'Interchain' },
    { type: 'Region', location: { start: { modifier: 'UNKNOWN' }, end: { value: 5 } }, description: 'unsure' },
  ],
  uniProtKBCrossReferences: [
    { database: 'PDB', id: '1A3N' },
    { database: 'PDB', id: '2HHB' },
    { database: 'AlphaFoldDB', id: 'P69905' },
    { database: 'GO', id: 'GO:0005833' },
  ],
}

describe('uniprotDocument', () => {
  it('names the document after the gene, with the protein and organism as description', () => {
    const doc = uniprotDocument(ENTRY)
    expect(doc.name).toBe('HBA1')
    expect(doc.description).toBe('Hemoglobin subunit alpha (Homo sapiens)')
    expect(doc.sequence.alphabet).toBe('protein')
    expect(doc.sequence.length).toBe(142)
    expect(doc.metadata?.origin).toBe('uniprot')
  })

  it('keeps where the structures are', () => {
    const ref = uniprotDocument(ENTRY).metadata!.uniprot!
    expect(ref.accession).toBe('P69905')
    expect(ref.entryName).toBe('HBA_HUMAN')
    expect(ref.reviewed).toBe(true)
    expect(ref.pdbIds).toEqual(['1A3N', '2HHB'])
    expect(ref.alphaFold).toBe(true)
  })

  it('refuses an entry without a sequence', () => {
    expect(() => uniprotDocument({ primaryAccession: 'X' })).toThrow(/no sequence/)
  })
})

describe('uniprotFeatures', () => {
  const feats = uniprotFeatures(ENTRY, 142)
  const byType = (t: string) => feats.filter(f => f.type === t)

  it('maps UniProt feature types to the protein feature keys, 1-based inclusive to 0-based half-open', () => {
    const chain = byType('Chain')[0]
    expect([chain.start, chain.end, chain.name]).toEqual([1, 142, 'Hemoglobin subunit alpha'])
    expect(chain.qualifiers?.feature_id).toEqual(['PRO_0000052653'])
    expect(byType('Domain')[0].name).toBe('Globin')
    expect(byType('binding_site')[0].start).toBe(58)
    expect(byType('modified_residue')[0].name).toBe('Phosphoserine')
  })

  it('leaves out secondary structure, conflicts, the initiator methionine and unplaced features', () => {
    const names = feats.map(f => `${f.type}:${f.name}`)
    expect(names.some(n => n.includes('Helix'))).toBe(false)
    expect(names.some(n => n.includes('conflict'))).toBe(false)
    expect(names.some(n => n.includes('Removed'))).toBe(false)
    expect(names.some(n => n.includes('unsure'))).toBe(false)
  })

  it('writes a natural variant in the short HGVS form with the change as qualifiers', () => {
    const v = byType('variant')[0]
    expect(v.name).toBe('p.D7G')
    expect(v.qualifiers?.original).toEqual(['D'])
    expect(v.qualifiers?.replacement).toEqual(['G'])
    expect(v.qualifiers?.note).toEqual(['in Hb Swan River'])
  })

  it('makes a disulfide a two-residue bond, and an interchain one a single residue', () => {
    const [intra, inter] = byType('disulfide')
    expect(intra.segments).toEqual([[9, 10], [19, 20]])
    expect([intra.start, intra.end]).toEqual([9, 20])
    expect(inter.segments).toBeUndefined()
    expect([inter.start, inter.end]).toEqual([29, 30])
  })
})

describe('looksLikeUniProt', () => {
  it('recognises accessions and entry names, not NCBI accessions', () => {
    expect(looksLikeUniProt('P69905')).toBe(true)
    expect(looksLikeUniProt('A0A024R161')).toBe(true)
    expect(looksLikeUniProt('P69905-2')).toBe(true)
    expect(looksLikeUniProt('HBA_HUMAN')).toBe(true)
    expect(looksLikeUniProt('NP_000509.1')).toBe(false)
    expect(looksLikeUniProt('NM_001301717')).toBe(false)
    expect(looksLikeUniProt('L09137.2')).toBe(false)
    expect(looksLikeUniProt('M13mp18')).toBe(false)
  })
})
