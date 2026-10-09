import { describe, it, expect } from 'vitest'
import { prositeToRegExp, scanPattern, scanMotifs, MOTIF_LIBRARY, motifDefinition } from './motifs'
import { motifKey, convertibleMotifs, motifToAnnotationData } from '../utils/motif-features'

describe('prositeToRegExp', () => {
  it('translates the elements of a pattern', () => {
    expect(prositeToRegExp('N-{P}-[ST]-{P}')).toBe('N[^P][ST][^P]')
    expect(prositeToRegExp('[RK](2)-x-[ST].')).toBe('[RK]{2}.[ST]')
    expect(prositeToRegExp('L-x(6)-L-x(6)-L')).toBe('L.{6}L.{6}L')
    expect(prositeToRegExp('[KR](2)-x(10,12)-[KR](3,5)')).toBe('[KR]{2}.{10,12}[KR]{3,5}')
  })

  it('anchors to the ends', () => {
    expect(prositeToRegExp('<M-x')).toBe('^M.')
    expect(prositeToRegExp('[KRHQSA]-[DENQ]-E-L>')).toBe('[KRHQSA][DENQ]EL$')
  })

  it('rejects what it cannot read', () => {
    expect(prositeToRegExp('')).toBeNull()
    expect(prositeToRegExp('N-(P)')).toBeNull()
    expect(prositeToRegExp('[ST')).toBeNull()
  })

  it('every library pattern parses', () => {
    for (const m of MOTIF_LIBRARY) expect(prositeToRegExp(m.pattern), m.id).not.toBeNull()
  })
})

describe('scanPattern', () => {
  it('reports every occurrence, overlaps included', () => {
    expect(scanPattern('NGSNGS', 'N[^P][ST]')).toEqual([[0, 3], [3, 6]])
    expect(scanPattern('AAAA', 'AA')).toEqual([[0, 2], [1, 3], [2, 4]])
  })

  it('matches residues in either case', () => {
    expect(scanPattern('rgd', 'RGD')).toEqual([[0, 3]])
  })
})

describe('scanMotifs', () => {
  it('finds the sequon, the KDEL and a membrane-free protein has no span', () => {
    const hits = scanMotifs('MANVSAKDEL')
    const names = hits.map(h => h.name)
    expect(names).toContain('N-glycosylation site')
    expect(names).toContain('ER retention signal')
    const glyc = hits.find(h => h.name === 'N-glycosylation site')!
    expect([glyc.start, glyc.end, glyc.sequence]).toEqual([2, 6, 'NVSA'])
    const kdel = hits.find(h => h.name === 'ER retention signal')!
    expect([kdel.start, kdel.end]).toEqual([6, 10])
  })

  it('does not find a C-terminal signal in the middle of a protein', () => {
    expect(scanMotifs('MKDELAAAA').some(h => h.name === 'ER retention signal')).toBe(false)
  })

  it('finds a bipartite NLS', () => {
    const hits = scanMotifs('AAKRPAATKKAGQAKKKKAA')
    expect(hits.some(h => h.name === 'Bipartite nuclear localization signal')).toBe(true)
  })

  it('a sequon with a proline is not a sequon', () => {
    expect(scanMotifs('NPSA').some(h => h.motifId === 'n-glyc')).toBe(false)
    expect(scanMotifs('NASA').some(h => h.motifId === 'n-glyc')).toBe(true)
  })

  it('returns hits in sequence order with the library definition behind each', () => {
    const hits = scanMotifs('RGDAAAAAANGT')
    for (let i = 1; i < hits.length; i++) expect(hits[i].start).toBeGreaterThanOrEqual(hits[i - 1].start)
    for (const h of hits) expect(motifDefinition(h.motifId)?.category).toBe(h.category)
  })
})

describe('motif features', () => {
  it('keys a hit by motif and residues, and converts it to a feature of its type', () => {
    const [hit] = scanMotifs('RGD')
    expect(motifKey(hit)).toBe('rgd:0:3')
    const data = motifToAnnotationData(hit)
    expect(data.type).toBe('Motif')
    expect([data.start, data.end, data.strand]).toEqual([0, 3, 0])
    expect(data.name).toBe(hit.name)
  })

  it('leaves out a hit the document already has as a feature', () => {
    const hits = scanMotifs('RGDAAARGD')
    expect(hits).toHaveLength(2)
    const existing = [{ name: hits[0].name, start: 0, end: 3 }]
    expect(convertibleMotifs(hits, existing).map(h => h.start)).toEqual([6])
  })
})
