import { describe, it, expect } from 'vitest'
import { basesFromPaste } from './paste-bases'

const bases = (text: string) => {
  const r = basesFromPaste(text)
  return r.ok ? r.bases : `refused: ${r.reason}`
}

describe('basesFromPaste', () => {
  it('takes plain sequence, in any case and layout', () => {
    expect(bases('acgt ACGT\nnnrY')).toBe('ACGTACGTNNRY')
  })

  it('leaves out a FASTA header instead of inserting its letters', () => {
    expect(bases('>my_seq description here\nATGAAA\nTTTTAA\n')).toBe('ATGAAATTTTAA')
    expect(bases('; comment\n>a\nACGT\n>b\nGGCC')).toBe('ACGTGGCC')
  })

  it('takes only the sequence block of GenBank text', () => {
    const gb = [
      'LOCUS       pX   20 bp    DNA     linear',
      'FEATURES             Location/Qualifiers',
      '     CDS             1..20',
      'ORIGIN',
      '        1 atgcgatcga atgcgatcga',
      '//',
    ].join('\n')
    expect(bases(gb)).toBe('ATGCGATCGAATGCGATCGA')
  })

  it('drops line numbers and alignment gaps', () => {
    expect(bases('    1 acgt-acgt\n    9 ac..gt')).toBe('ACGTACGTACGT')
  })

  it('refuses text that is not a sequence, and says why', () => {
    expect(bases('Hello world')).toMatch(/^refused: .*not nucleotide codes: (?=.*l)(?=.*o)/)
    expect(bases('MKVLAAGIVG')).toMatch(/^refused:/) // a protein
  })

  it('gives nothing for an empty clipboard', () => {
    expect(basesFromPaste('  \n ')).toEqual({ ok: true, bases: '' })
  })
})
