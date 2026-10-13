import { describe, it, expect } from 'vitest'
import { samName, samNames } from './refNames'
import { writeVcf } from '../assembly/vcf'
import { coverageBedGraph } from './coverageExport'

describe('reference names in exported files', () => {
  it('turns what SAM and VCF refuse into underscores', () => {
    expect(samName('pUC19, mutant <v2>')).toBe('pUC19_mutant_v2_')
    expect(samName('*star')).toBe('_star')
    expect(samName('  ')).toBe('reference')
  })

  it('makes repeated names unique', () => {
    expect(samNames(['a b', 'a  b', 'c'])).toEqual(['a_b', 'a_b_2', 'c'])
  })

  it('names a reference the same in the VCF as in the BAM', () => {
    const vcf = writeVcf({ references: [{ name: 'pUC19, mutant', bases: 'ACGT', variants: [] }], source: 's', referenceName: 'r' })
    expect(vcf).toContain(`##contig=<ID=${samNames(['pUC19, mutant'])[0]},length=4>`)
    expect(coverageBedGraph(samNames(['pUC19, mutant'])[0], [1, 1])[0]).toBe('pUC19_mutant\t0\t2\t1\n')
  })
})
