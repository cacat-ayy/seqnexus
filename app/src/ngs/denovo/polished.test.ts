import { describe, expect, it } from 'vitest'
import { matchPolished, parseFasta } from './polished'

const A = 'ACGT'.repeat(20)
const B = 'GGCA'.repeat(20)
const contigs = [
  { name: 'Contig 1', fastaName: 'Contig_1', circular: true, bases: A },
  { name: 'Contig 2', fastaName: 'Contig_2', circular: false, bases: B },
]

describe('polished contigs', () => {
  it('reads FASTA, keeping the first word of each name', () => {
    expect(parseFasta('>Contig_1 length=80\nACGT\nacgt\n\n>x\n>Contig_2\nGG CC\n')).toEqual([
      { name: 'Contig_1', seq: 'ACGTACGT' }, { name: 'Contig_2', seq: 'GGCC' },
    ])
  })

  it('matches by name in any order, and says which changed', () => {
    const r = matchPolished(parseFasta(`>Contig_2\n${B}\n>Contig_1\n${A}T\n`), contigs)
    expect(r.map(x => [x.name, x.bases.length, x.circular, x.changed])).toEqual([['Contig 1', 81, true, true], ['Contig 2', 80, false, false]])
  })

  it('takes them in order when no name matches and the counts agree, and refuses otherwise', () => {
    expect(matchPolished(parseFasta(`>a\n${A}\n>b\n${B}\n`), contigs)[1].bases).toBe(B)
    expect(() => matchPolished(parseFasta(`>Contig_1\n${A}\n`), contigs)).toThrow(/Contig_2/)
    expect(() => matchPolished(parseFasta(`>a\n${A}\n`), contigs)).toThrow(/do not match/)
    expect(() => matchPolished([], contigs)).toThrow(/no sequences/)
  })
})
