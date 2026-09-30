import { describe, it, expect } from 'vitest'
import { bestDimer, bestHairpin } from './structure'

describe('bestDimer', () => {
  it('draws a palindrome pairing with itself', () => {
    const d = bestDimer('GAATTCGAATTC', 'GAATTCGAATTC')!
    expect(d.run).toBe(12)
    expect(d.lines[0]).toContain("5'-GAATTCGAATTC-3'")
    expect(d.lines[1].trim()).toBe('||||||||||||')
    expect(d.lines[2]).toContain("3'-CTTAAGCTTAAG-5'")
    expect(d.dG).toBeLessThan(0)
  })

  it('lines the pairing marks up under the bases they join', () => {
    const d = bestDimer('AAAAGGGCCCAAAA', 'AAAAGGGCCCAAAA')!
    const [top, marks, bottom] = d.lines
    for (let c = 0; c < marks.length; c++) {
      if (marks[c] !== '|') continue
      const pair = top[c] + bottom[c]
      expect(['AT', 'TA', 'GC', 'CG']).toContain(pair)
    }
  })

  it('flags a dimer that reaches a 3′ end', () => {
    // b's 3' end pairs with a's 3' end.
    expect(bestDimer('TTTTTTTTTTACGT', 'TTTTTTTTTTACGT')!.threePrime).toBe(true)
  })

  it('returns null when nothing pairs for 3 bp', () => {
    expect(bestDimer('AAAAAAAA', 'AAAAAAAA')).toBeNull()
  })
})

describe('bestHairpin', () => {
  it('writes the stem as dot-bracket under the sequence', () => {
    const h = bestHairpin('GCGCAAAGCGC')!
    expect(h).toEqual({ stem: 4, loop: 3, dotBracket: '((((...))))' })
  })

  it('returns null without a 3 bp stem', () => {
    expect(bestHairpin('AAAAAAAAAAAA')).toBeNull()
  })
})
