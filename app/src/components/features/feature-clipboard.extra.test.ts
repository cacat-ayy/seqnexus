/**
 * A FASTA record copied to the clipboard has to end with a line break, or
 * the next record pasted after it runs onto the last sequence line.
 */
import { describe, it, expect } from 'vitest'
import { writeFastaRecord } from '../../io/fasta'

describe('FASTA for the clipboard', () => {
  it('ends with a line break, so two records pasted in a row stay two', () => {
    const a = writeFastaRecord('featA', 'ACGTACGTAC')
    const b = writeFastaRecord('featB', 'TTTTGGGGCC')
    expect(a.endsWith('\n')).toBe(true)
    expect((a + b).split('\n').filter(l => l.startsWith('>'))).toEqual(['>featA', '>featB'])
  })

  it('keeps a name with spaces readable, as the file export does', () => {
    expect(writeFastaRecord('my feature', 'ACGT')).toBe('>my_feature my feature\nACGT\n')
  })
})
