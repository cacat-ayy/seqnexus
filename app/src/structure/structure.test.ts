import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseStructure, detectStructureFormat, cifTokens } from './parse'
import { mapToChain, bestChain, identity } from './align'
import { chainColors, plddtColor, spectrumColor } from './color'
import { isPdbId, cacheKey, textHash } from './model'
import { fetchPdbEntry, fetchAlphaFoldModel, loadStructureText, StructureFileMissing, RCSB_URL } from './sources'
import { proteinsFromStructure } from './attach'
import { Annotation } from '../models/Annotation'

vi.mock('../storage/idb', () => {
  const store = new Map<string, string>()
  return {
    saveStructure: async (k: string, t: string) => { store.set(k, t) },
    loadStructure: async (k: string) => store.get(k),
  }
})

/** One ATOM line in PDB columns. */
function atom(serial: number, name: string, resn: string, chain: string, resi: number, b = 50, rec = 'ATOM  ', icode = ' ') {
  return `${rec}${String(serial).padStart(5)} ${name.padEnd(4)} ${resn} ${chain}${String(resi).padStart(4)}${icode}   ${'1.000'.padStart(8)}${'2.000'.padStart(8)}${'3.000'.padStart(8)}${'1.00'.padStart(6)}${b.toFixed(2).padStart(6)}           C`
}

const PDB = [
  'HEADER    TEST',
  'TITLE     A SMALL TEST PROTEIN',
  atom(1, 'N', 'MET', 'A', 1, 91), atom(2, 'CA', 'MET', 'A', 1, 93),
  atom(3, 'CA', 'LYS', 'A', 2, 80),
  atom(4, 'CA', 'MSE', 'A', 3, 60),
  atom(5, 'CA', 'GLY', 'A', 5, 40),
  atom(6, 'O', 'HOH', 'A', 101, 20, 'HETATM'),
  atom(7, 'CA', 'ALA', 'B', 1), atom(8, 'CA', 'ALA', 'B', 2),
  'ENDMDL',
  atom(9, 'CA', 'TRP', 'C', 1),
].join('\n')

const CIF = `data_TEST
#
_struct.title 'A tiny entry'
#
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.B_iso_or_equiv
_atom_site.auth_seq_id
_atom_site.auth_comp_id
_atom_site.auth_asym_id
_atom_site.pdbx_PDB_model_num
ATOM 1 N MET A 1 ? 10.0 101 MET X 1
ATOM 2 CA MET A 1 ? 12.0 101 MET X 1
ATOM 3 CA VAL A 2 ? 14.0 102 VAL X 1
ATOM 4 CA LEU A 3 A 16.0 102 LEU X 1
HETATM 5 O HOH B . ? 30.0 900 HOH X 1
ATOM 6 CA GLY A 4 ? 18.0 103 GLY X 2
#
`

describe('parseStructure', () => {
  it('reads the protein chains of the first model of a PDB file', () => {
    const s = parseStructure(PDB, 'pdb')
    expect(s.title).toBe('A SMALL TEST PROTEIN')
    expect(s.chains.map(c => c.id)).toEqual(['A', 'B'])
    const a = s.chains[0]
    // MSE reads as Met; the water drops out; residue 4 is missing.
    expect(a.sequence).toBe('MKMG')
    expect(a.residues.map(r => r.num)).toEqual([1, 2, 3, 5])
    expect(a.residues[0].b).toBeCloseTo(92)
  })

  it('reads mmCIF with author numbering, insertion codes and the first model only', () => {
    const s = parseStructure(CIF, 'mmcif')
    expect(s.title).toBe('A tiny entry')
    expect(s.chains).toHaveLength(1)
    const x = s.chains[0]
    expect(x.id).toBe('X')
    expect(x.sequence).toBe('MVL')
    expect(x.residues.map(r => `${r.num}${r.icode}`)).toEqual(['101', '102', '102A'])
    expect(x.residues[2].b).toBe(16)
  })

  it('tells the formats apart', () => {
    expect(detectStructureFormat(CIF)).toBe('mmcif')
    expect(detectStructureFormat(PDB)).toBe('pdb')
    expect(detectStructureFormat('', 'x.cif')).toBe('mmcif')
  })

  it('splits quoted mmCIF values', () => {
    expect(cifTokens(`ATOM 1 "O5'" DA 'a b' x`)).toEqual(['ATOM', '1', "O5'", 'DA', 'a b', 'x'])
  })
})

describe('mapToChain', () => {
  const chain = parseStructure(PDB, 'pdb').chains[0]

  it('maps residues through the alignment, skipping a tag and a missing residue', () => {
    // The protein has a His tag the structure lacks, and residue 4 (A).
    const m = mapToChain('HHHHHHMKMAG', chain)
    expect(m.toChain[6]).toBe(0)
    expect(m.toChain[7]).toBe(1)
    expect(m.toChain[0]).toBe(-1)
    expect(m.toChain[9]).toBe(-1)
    expect(m.toProtein[3]).toBe(10)
    expect(m.aligned).toBe(4)
    expect(identity(m)).toBe(1)
  })

  it('picks the chain with the most identical residues', () => {
    const chains = parseStructure(PDB, 'pdb').chains
    expect(bestChain('MKMG', chains)!.chain).toBe('A')
    expect(bestChain('AA', chains)!.chain).toBe('B')
  })
})

describe('chainColors', () => {
  const chain = parseStructure(PDB, 'pdb').chains[0]
  const mapping = mapToChain('MKMG', chain)
  const base = { chain, mapping, palette: {}, protein: 'MKMG', neutral: '#999999' }

  it('colours by the smallest covering feature, neutral elsewhere', () => {
    const features = [
      new Annotation({ id: 'd', name: 'Domain', type: 'Domain', start: 0, end: 4, strand: 0, color: '#112233' }),
      new Annotation({ id: 's', name: 'Site', type: 'Site', start: 1, end: 2, strand: 0, color: '#aabbcc' }),
    ]
    expect(chainColors({ ...base, mode: 'features', features })).toEqual(['#112233', '#aabbcc', '#112233', '#112233'])
    expect(chainColors({ ...base, mode: 'features', features: [] })).toEqual(Array(4).fill('#999999'))
  })

  it('colours by confidence in the AlphaFold bands, and N to C from blue to red', () => {
    expect(chainColors({ ...base, mode: 'confidence', features: [] })).toEqual(['#0053d6', '#65cbf3', '#ffdb13', '#ff7d45'])
    expect(plddtColor(95)).toBe('#0053d6')
    expect(spectrumColor(0)).toBe('#0000ff')
    expect(spectrumColor(1)).toBe('#ff0000')
  })

  it('colours by the residue palette', () => {
    expect(chainColors({ ...base, mode: 'residues', features: [], palette: { M: '#010101' } })).toEqual(['#010101', '#999999', '#010101', '#999999'])
  })
})

describe('model helpers', () => {
  it('recognises PDB ids and builds cache keys', () => {
    expect(isPdbId('1a3n')).toBe(true)
    expect(isPdbId('A3N1')).toBe(false)
    expect(isPdbId('1A3')).toBe(false)
    expect(cacheKey('alphafold', 'p69905')).toBe('afdb:P69905')
    expect(textHash('abc')).toBe(textHash('abc'))
    expect(textHash('abc')).not.toBe(textHash('abd'))
  })
})

describe('sources', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fetches a PDB entry once and serves it from the cache after', async () => {
    const fetchMock = vi.fn(async () => new Response(CIF, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const a = await fetchPdbEntry('9xyz')
    expect(fetchMock).toHaveBeenCalledWith(RCSB_URL('9XYZ'))
    expect(a.ref).toMatchObject({ source: 'pdb', id: '9XYZ', format: 'mmcif', key: 'pdb:9XYZ' })
    const b = await fetchPdbEntry('9XYZ')
    expect(b.text).toBe(CIF)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses a malformed id and reports a missing entry', async () => {
    await expect(fetchPdbEntry('ABCD')).rejects.toThrow(/not a PDB id/)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await expect(fetchPdbEntry('8ZZZ')).rejects.toThrow(/not found/)
  })

  it('finds the AlphaFold model through the prediction API', async () => {
    const fetchMock = vi.fn(async (url: string) => url.includes('/api/prediction/')
      ? new Response(JSON.stringify([{ pdbUrl: 'https://alphafold.ebi.ac.uk/files/AF-Q00000-F1-model_v6.pdb', uniprotDescription: 'Test protein', latestVersion: 6 }]))
      : new Response(PDB))
    vi.stubGlobal('fetch', fetchMock)
    const f = await fetchAlphaFoldModel('q00000')
    expect(f.ref).toMatchObject({ source: 'alphafold', id: 'Q00000', format: 'pdb', title: 'Test protein (AlphaFold model v6)' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('cannot bring back a file that is not cached', async () => {
    await expect(loadStructureText({ source: 'file', id: 'mine.pdb', key: 'file:none', format: 'pdb', chain: 'A' }))
      .rejects.toBeInstanceOf(StructureFileMissing)
  })
})

describe('proteinsFromStructure', () => {
  it('opens one protein per distinct chain, each with its structure', () => {
    const docs = proteinsFromStructure({ ref: { source: 'file', id: 't.pdb', key: 'file:x', format: 'pdb' }, text: PDB }, 't')
    expect(docs.map(d => d.name)).toEqual(['t chain A', 't chain B'])
    expect(docs[0].sequence.alphabet).toBe('protein')
    expect(docs[0].sequence.bases).toBe('MKMG')
    expect(docs[1].metadata?.structure?.chain).toBe('B')
    expect(docs[0].description).toBe('A SMALL TEST PROTEIN')
  })
})
