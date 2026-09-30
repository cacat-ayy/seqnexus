import { describe, it, expect } from 'vitest'
import { tailEnzymes } from './tails'

describe('tailEnzymes', () => {
  it('names a site that sits in the tail', () => {
    expect(tailEnzymes('CCGGAATTC', 'ATGACCATGATTACG')).toContain('EcoRI')
  })

  it('names a site that runs across the join into the annealed part', () => {
    // GAAT|TC: the site starts in the tail.
    expect(tailEnzymes('CCGAAT', 'TCATGACCATG')).toContain('EcoRI')
  })

  it('ignores a site entirely inside the annealed part', () => {
    expect(tailEnzymes('CCCC', 'GAATTCATGACC')).not.toContain('EcoRI')
  })

  it('finds a Type IIS site on either strand, and names isoschizomers together', () => {
    // GAGACC is BsaI (GGTCTC) read on the other strand.
    expect(tailEnzymes('TTGAGACCAA', 'ATGACCATGATTACG')).toContain('BsaI')
    expect(tailEnzymes('AAGAAGACAA', 'ATGACCATG').some(n => n.includes('BbsI') && n.includes('BpiI'))).toBe(true)
  })

  it('has nothing to say without a tail', () => {
    expect(tailEnzymes('', 'GAATTCATG')).toEqual([])
  })
})
