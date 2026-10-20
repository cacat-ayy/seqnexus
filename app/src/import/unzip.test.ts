import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 as encode } from 'fflate'
import { expandZips } from './unzip'

// jsdom's TextEncoder gives a Uint8Array of another realm, which fflate takes for a folder.
const strToU8 = (s: string) => new Uint8Array(encode(s))
const textOf = (f: File) => new Promise<string>(ok => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.readAsText(f) })

const zipFile = (name: string, entries: Record<string, Uint8Array>) => new File([zipSync(entries) as BlobPart], name)

describe('expandZips', () => {
  it('puts the files of an archive, and of one inside it, under its name', async () => {
    const inner = zipSync({ 's1.fastq.gz': strToU8('reads') })
    const zip = zipFile('ORD_results.zip', {
      'ORD_fasta-files/s1.fasta': strToU8('>s1\nACGT\n'),
      'ORD.fastq.zip': inner,
      '__MACOSX/ORD_fasta-files/._s1.fasta': strToU8('junk'),
      'ORD_fasta-files/': new Uint8Array(0),
    })
    const plain = new File(['>x\nA\n'], 'x.fasta')
    const out = await expandZips([zip, plain])
    expect(out.files.map(f => f.name)).toEqual(['s1.fasta', 's1.fastq.gz', 'x.fasta'])
    expect(out.files.map(f => out.paths.get(f))).toEqual(['ORD_results/ORD_fasta-files/s1.fasta', 'ORD_results/ORD.fastq/s1.fastq.gz', undefined])
    expect(await textOf(out.files[0])).toBe('>s1\nACGT\n')
    expect(out.failed).toEqual([])
  })

  it('reports an archive it cannot read and keeps going', async () => {
    const out = await expandZips([new File(['not a zip'], 'broken.zip'), new File(['A'], 'a.fa')])
    expect(out.files.map(f => f.name)).toEqual(['a.fa'])
    expect(out.failed.map(f => f.name)).toEqual(['broken.zip'])
  })
})
