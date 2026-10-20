import { describe, expect, it } from 'vitest'
import { fileRole, findResultSets, sampleStem } from './detect'

const f = (name: string) => new File(['x'], name)

/** A drop with paths, as a dropped folder or an unpacked ZIP gives it. */
function drop(paths: string[]) {
  const files = paths.map(p => f(p.split('/').pop()!))
  const at = new Map(files.map((x, i) => [x, paths[i]]))
  return { files, pathOf: (x: File) => at.get(x) ?? x.name }
}

describe('fileRole and sampleStem', () => {
  it('names each file by what it is to a result set', () => {
    expect(fileRole('a.fasta')).toBe('consensus')
    expect(fileRole('a.gbk')).toBe('genbank')
    expect(fileRole('a.fastq.gz')).toBe('reads')
    expect(fileRole('a.ab1')).toBe('trace')
    expect(fileRole('a.html')).toBe('extra')
    expect(fileRole('a.dna')).toBeNull()
    expect(sampleStem('JPY6QT_1_pGFP.fastq.gz')).toBe('JPY6QT_1_pGFP')
    expect(sampleStem('x/y/JPY6QT_1_pGFP.v2.gbk')).toBe('JPY6QT_1_pGFP.v2')
  })
})

describe('findResultSets', () => {
  it('groups a vendor layout by stem across its folders', () => {
    const { files, pathOf } = drop([
      'JPY6QT_results/JPY6QT_fasta-files/JPY6QT_1_pGFP.fasta',
      'JPY6QT_results/JPY6QT_genbank-files/JPY6QT_1_pGFP.gbk',
      'JPY6QT_results/JPY6QT_ab1-files/JPY6QT_1_pGFP.ab1',
      'JPY6QT_results/JPY6QT_per-base-data/JPY6QT_1_pGFP.tsv',
      'JPY6QT_results/JPY6QT_histograms/JPY6QT_1_pGFP.png',
      'JPY6QT_results/JPY6QT_fasta-files/JPY6QT_2_pRFP.fasta',
      'JPY6QT_results/JPY6QT_genbank-files/JPY6QT_2_pRFP.gbk',
      'JPY6QT_results/JPY6QT_gel.png',
      'JPY6QT.fastq/JPY6QT_1_pGFP.fastq.gz',
    ])
    const sets = findResultSets(files, pathOf)
    expect(sets.samples.map(s => s.name)).toEqual(['JPY6QT_1_pGFP', 'JPY6QT_2_pRFP'])
    const [a, b] = sets.samples
    expect(a.consensus?.name).toBe('JPY6QT_1_pGFP.fasta')
    expect(a.reads?.name).toBe('JPY6QT_1_pGFP.fastq.gz')
    expect(a.trace?.name).toBe('JPY6QT_1_pGFP.ab1')
    expect(a.extras.map(x => x.name)).toEqual(['JPY6QT_1_pGFP.tsv', 'JPY6QT_1_pGFP.png'])
    expect(b.reads).toBeNull()
    expect(sets.rest.map(x => x.name)).toEqual(['JPY6QT_gel.png'])
  })

  it('leaves ordinary drops alone', () => {
    expect(findResultSets([f('pUC19.gb'), f('pX12.fasta'), f('A01.ab1')]).samples).toEqual([])
    // A Sanger plate: each read's chromatogram with its calls as FASTA.
    expect(findResultSets([f('A01.ab1'), f('A01.fasta'), f('A02.ab1'), f('A02.fasta')]).samples).toEqual([])
    expect(findResultSets([f('pUC19.gb')]).rest).toHaveLength(1)
  })

  it('keeps a construct dropped with the results as an ordinary file', () => {
    const sets = findResultSets([f('s1.fasta'), f('s1.fastq.gz'), f('pX12.gb')])
    expect(sets.samples.map(s => s.name)).toEqual(['s1'])
    expect(sets.rest.map(x => x.name)).toEqual(['pX12.gb'])
  })

  it('takes a lone consensus only from the folder of other samples\' consensus files', () => {
    const { files, pathOf } = drop(['run/fasta/s1.fasta', 'run/gbk/s1.gbk', 'run/ab1/s1.ab1', 'run/fasta/s2.fasta', 'mine/pX12.fasta'])
    const sets = findResultSets(files, pathOf)
    expect(sets.samples.map(s => s.name)).toEqual(['s1', 's2'])
    expect(sets.rest.map(x => x.name)).toEqual(['pX12.fasta'])
  })

  it('counts a consensus with its own GenBank as a sample, and sorts samples by number', () => {
    const sets = findResultSets([f('o_10_a.fasta'), f('o_10_a.gbk'), f('o_2_b.fasta'), f('o_2_b.fastq')])
    expect(sets.samples.map(s => s.name)).toEqual(['o_2_b', 'o_10_a'])
  })
})

describe('findResultSets, files dropped loose', () => {
  it('takes a lone consensus named like the samples of the order', () => {
    const sets = findResultSets([f('ORD7_1_a.fasta'), f('ORD7_1_a.gbk'), f('ORD7_2_b.fasta'), f('pX12.fasta')])
    expect(sets.samples.map(s => s.name)).toEqual(['ORD7_1_a', 'ORD7_2_b'])
    expect(sets.rest.map(x => x.name)).toEqual(['pX12.fasta'])
  })
})
