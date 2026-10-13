import { describe, expect, it } from 'vitest'
import { countSelectable, exportSelection } from './selection'

describe('exportSelection', () => {
  const contigsOf = (id: string) => (id === 'a1' ? ['c1', 'c2'] : ['c3'])

  it('turns an assembly into its contigs', () => {
    expect(exportSelection(['assembly:a1', 'sequence:t1'], contigsOf).items).toEqual({ sequence: ['t1'], contig: ['c1', 'c2'] })
  })

  it('does not list a contig twice when it and its assembly are picked', () => {
    expect(exportSelection(['contig:c2', 'assembly:a1', 'assembly:a2'], contigsOf).items).toEqual({ contig: ['c2', 'c1', 'c3'] })
  })

  it('exports a protein as a sequence', () => {
    expect(exportSelection(['protein:p1', 'sequence:t1'], contigsOf).items).toEqual({ sequence: ['t1', 'p1'] })
  })

  it('sets oligos aside for their own export', () => {
    const pick = exportSelection(['oligo:o1', 'sequence:t1'], contigsOf)
    expect(pick.items).toEqual({ sequence: ['t1'] })
    expect(pick.oligos).toEqual(['o1'])
  })

  it('names the kinds exported from their own page and leaves them out', () => {
    const pick = exportSelection(['gel:g1', 'clone:k1', 'readset:r1'], contigsOf)
    expect(pick.items).toEqual({})
    expect(pick.elsewhere).toEqual(['readset', 'gel', 'clone'])
  })
})

describe('countSelectable', () => {
  it('counts only what Export Selected can write', () => {
    expect(countSelectable(['sequence:t1', 'protein:p1', 'gel:g1', 'clone:k1', 'readset:r1', 'oligo:o1'])).toBe(3)
  })
})
