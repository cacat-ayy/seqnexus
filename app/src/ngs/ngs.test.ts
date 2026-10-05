import { describe, expect, it } from 'vitest'
import { ReadStreamParser, readId, type RawRead } from './fastq-stream'
import { decodeChunk, encodeChunk } from './codec'
import { StatsAccumulator } from './stats'
import { detectTechnology, looksInterleaved, pairFiles } from './detect'
import { readSetQc } from './qc'

function parseInPieces(text: string, size: number): RawRead[] {
  const p = new ReadStreamParser()
  const out: RawRead[] = []
  for (let i = 0; i < text.length; i += size) p.push(text.slice(i, i + size), out)
  p.end(out)
  return out
}

describe('ReadStreamParser', () => {
  const fq = '@r1 1:N:0:1\r\nACGT\r\n+\r\nII#I\r\n@r2\nAC\nGT\n+\n@I\nII\n'

  it('reads records split anywhere, with CRLF and wrapped lines', () => {
    for (const size of [1, 3, 7, 1000]) {
      const reads = parseInPieces(fq, size)
      expect(reads).toEqual([
        { header: 'r1 1:N:0:1', seq: 'ACGT', qual: 'II#I' },
        // A quality line may start with @: it is read by length, not by its first character.
        { header: 'r2', seq: 'ACGT', qual: '@III' },
      ])
    }
  })

  it('reads FASTA, without quality', () => {
    expect(parseInPieces('>a desc\nAC\nGT\n>b\nTT\n', 4)).toEqual([
      { header: 'a desc', seq: 'ACGT', qual: '' },
      { header: 'b', seq: 'TT', qual: '' },
    ])
  })

  it('reports a truncated record and a malformed file', () => {
    expect(() => parseInPieces('@r1\nACGT\n+\nII', 100)).toThrow(/ends before its quality/)
    expect(() => parseInPieces('hello\n', 100)).toThrow(/not FASTQ or FASTA/)
    expect(() => parseInPieces('@r1\nAC\n+\nIII\n', 100)).toThrow(/more quality values/)
  })

  it('takes the ID up to the first space', () => {
    expect(readId('A00:1:FC:1:1:2:3 1:N:0:ACGT')).toBe('A00:1:FC:1:1:2:3')
  })
})

describe('chunk codec', () => {
  it('round-trips IDs, bases (N and IUPAC kept, U read as T) and qualities', () => {
    const reads = [
      { id: 'r1', seq: 'ACGTNRYK', qual: 'IIII#!+5' },
      { id: 'r2', seq: 'acgu', qual: '????' },
      { id: 'r3', seq: '', qual: '' },
    ]
    const chunk = decodeChunk(encodeChunk(reads))
    expect(chunk.count).toBe(3)
    expect(chunk.ids).toEqual(['r1', 'r2', 'r3'])
    expect(chunk.seq(0)).toBe('ACGTNRYK')
    expect(chunk.seq(1)).toBe('ACGT')
    expect(chunk.qualText(0)).toBe('IIII#!+5')
    expect(chunk.length(2)).toBe(0)
  })

  it('stores reads without quality', () => {
    const chunk = decodeChunk(encodeChunk([{ id: 'a', seq: 'ACG', qual: '' }]))
    expect(chunk.hasQuality).toBe(false)
    expect(chunk.qualText(0)).toBe('!!!')
  })

  it('is much smaller than the text', () => {
    const reads = Array.from({ length: 2000 }, (_, i) => ({
      id: `A00123:8:H5KJ7DSXY:1:1101:${1000 + i}:2000`,
      seq: 'ACGT'.repeat(37) + 'AC',
      qual: 'F'.repeat(140) + ':'.repeat(10),
    }))
    const text = reads.map(r => `@${r.id}\n${r.seq}\n+\n${r.qual}\n`).join('').length
    expect(encodeChunk(reads).length).toBeLessThan(text / 8)
  })
})

describe('StatsAccumulator', () => {
  it('counts lengths, N50, Q20/Q30, N and GC', () => {
    const s = new StatsAccumulator(false, 1)
    s.add('GGGG', '5555') // Q20
    s.add('AAAAAANN', '????????') // Q30
    s.add('CC', '##') // Q2
    const r = s.finish()
    expect(r).toMatchObject({ reads: 3, bases: 14, minLength: 2, maxLength: 8, n50: 8 })
    expect(r.q20).toBeCloseTo(12 / 14)
    expect(r.q30).toBeCloseTo(8 / 14)
    expect(r.nFraction).toBeCloseTo(2 / 14)
    expect(r.gc).toBeCloseTo(6 / 12)
    expect(r.positionQuality[0][0].p50).toBe(20)
  })

  it('takes a read\'s quality from its error probabilities, not its mean score', () => {
    const s = new StatsAccumulator(true, 1)
    s.add('AAAA', 'II&&') // Q40, Q40, Q5, Q5: mean score 22.5
    const q = s.finish().medianReadQuality
    expect(q).toBeGreaterThan(7.5)
    expect(q).toBeLessThan(8.5)
  })

  it('knows when there is no quality', () => {
    const s = new StatsAccumulator(false, 1)
    s.add('ACGT', '')
    expect(s.finish()).toMatchObject({ qualityMissing: true, q30: 0, positionQuality: [] })
  })
})

describe('pairFiles', () => {
  it('pairs R1/R2 and _1/_2 files and leaves the rest alone', () => {
    const names = [
      'B_S2_L001_R2_001.fastq.gz', 'A_R1.fq.gz', 'B_S2_L001_R1_001.fastq.gz', 'A_R2.fq.gz',
      'reads_1.fastq', 'reads_2.fastq', 'nanopore.fastq.gz', 'Achl_1_F.fastq',
    ]
    expect(pairFiles(names)).toEqual([
      { name: 'B_S2_L001', files: [2, 0] },
      { name: 'A', files: [1, 3] },
      { name: 'reads', files: [4, 5] },
      { name: 'nanopore', files: [6] },
      { name: 'Achl_1_F', files: [7] },
    ])
  })

  it('does not pair two first mates', () => {
    expect(pairFiles(['x_R1.fq', 'x.R1.fq']).map(g => g.files.length)).toEqual([1, 1])
  })
})

describe('detection', () => {
  const read = (header: string, len = 150): RawRead => ({ header, seq: 'A'.repeat(len), qual: 'I'.repeat(len) })

  it('spots interleaved mates', () => {
    const r = [read('a/1'), read('a/2'), read('b 1:N:0'), read('b 2:N:0')]
    expect(looksInterleaved(r)).toBe(true)
    expect(looksInterleaved([read('a'), read('b'), read('c'), read('d')])).toBe(false)
  })

  it('reads the technology from headers, then from lengths', () => {
    expect(detectTechnology([read('A00123:8:H5KJ7:1:1101:1000:2000 1:N:0:ACGT')])).toEqual({ technology: 'illumina', certain: true })
    expect(detectTechnology([read('0d4b2a7e-1c5f-4a1e-9e1d-2b3c4d5e6f70 runid=abc ch=12', 5000)])).toEqual({ technology: 'nanopore', certain: true })
    expect(detectTechnology([read('m64011_190830_220126/1/ccs', 12000)])).toEqual({ technology: 'pacbio', certain: true })
    expect(detectTechnology([read('SRR1.1', 100)])).toEqual({ technology: 'illumina', certain: false })
    expect(detectTechnology([read('x', 4000)])).toEqual({ technology: 'nanopore', certain: false })
  })
})

describe('readSetQc', () => {
  const stats = (over: object) => {
    const s = new StatsAccumulator(false, 1)
    for (let i = 0; i < 2000; i++) s.add('ACGT', 'IIII')
    return { ...s.finish(), ...over }
  }

  it('judges short reads by Q30 and long reads by read quality', () => {
    expect(readSetQc(stats({}), 'illumina').verdict).toBe('good')
    expect(readSetQc(stats({ q30: 0.7 }), 'illumina').verdict).toBe('check')
    expect(readSetQc(stats({ q30: 0.5 }), 'illumina').verdict).toBe('fail')
    expect(readSetQc(stats({ medianReadQuality: 10 }), 'nanopore').verdict).toBe('check')
    expect(readSetQc(stats({ medianReadQuality: 10 }), 'pacbio').verdict).toBe('fail')
  })

  it('flags N calls and few reads', () => {
    expect(readSetQc(stats({ nFraction: 0.02 }), 'illumina').issues[0]).toMatch(/2\.0% of bases are N/)
    expect(readSetQc(stats({ reads: 10 }), 'illumina')).toEqual({ verdict: 'check', issues: ['Only 10 reads'] })
  })
})
