import { describe, expect, it } from 'vitest'
import { StatsAccumulator } from '../stats'
import { QcAccumulator, duplicationLevels, gcFit } from './accumulator'
import { findContaminant } from './contaminants'
import { decodeQcReport, encodeQcReport } from './storage'
import { summarize, type QcReport } from './types'
import { expectedNote, worstUnexpected } from './expected'
import { fastqcBases, fastqcDataText } from './fastqcData'

/** A seeded random number generator, so the fixtures are the same every run. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function randomSeq(rand: () => number, n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += 'ACGT'[Math.floor(rand() * 4)]
  return s
}

const qualOf = (n: number, q: number) => String.fromCharCode(33 + q).repeat(n)

interface Read { id?: string; seq: string; qual?: string; mate?: number }

function report(reads: Read[], o: { long?: boolean; mates?: 1 | 2 } = {}): QcReport {
  const mates = o.mates ?? 1
  const stats = new StatsAccumulator(o.long ?? false, mates)
  const qc = new QcAccumulator(o.long ?? false, mates)
  reads.forEach((r, i) => {
    const qual = r.qual ?? qualOf(r.seq.length, 35)
    stats.add(r.seq, qual, r.mate ?? 0)
    qc.add(r.id ?? `read${i}`, r.seq, qual, r.mate ?? 0)
  })
  return qc.finish(stats.finish())
}

function randomReads(count: number, length: number, seed = 1): Read[] {
  const rand = rng(seed)
  return Array.from({ length: count }, () => ({ seq: randomSeq(rand, length) }))
}

describe('quality report: clean random reads', () => {
  const r = report(randomReads(2000, 100)).mates[0]

  it('passes the modules a good library passes', () => {
    expect(r.status.basic).toBe('pass')
    expect(r.status.baseQuality).toBe('pass')
    expect(r.status.seqQuality).toBe('pass')
    expect(r.status.baseContent).toBe('pass')
    expect(r.status.baseN).toBe('pass')
    expect(r.status.lengths).toBe('pass')
    expect(r.status.duplication).toBe('pass')
    expect(r.status.overrepresented).toBe('pass')
    expect(r.status.adapters).toBe('pass')
  })

  it('reports the basic statistics', () => {
    expect(r.reads).toBe(2000)
    expect(r.bases).toBe(200_000)
    expect(r.minLength).toBe(100)
    expect(r.maxLength).toBe(100)
    expect(r.gc).toBeGreaterThan(48)
    expect(r.gc).toBeLessThan(52)
    expect(r.lowestQuality).toBe(35)
  })

  it('has one value per position', () => {
    expect(r.baseContent.a).toHaveLength(100)
    expect(r.baseN).toHaveLength(100)
    expect(r.baseQuality).toHaveLength(100)
    // Probes are 12 bases: positions 0 to 88.
    expect(r.adapters[0].percent).toHaveLength(89)
  })

  it('skips the tiles when read names have none', () => {
    expect(r.status.tileQuality).toBe('skip')
    expect(r.notes.tileQuality).toMatch(/tile/)
  })

  it('fits GC with a normal distribution that matches random reads', () => {
    const sum = r.seqGc.observed.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(2000, 3)
    expect(r.status.seqGc).toBe('pass')
    expect(r.seqGc.deviation).toBeLessThan(15)
  })
})

describe('quality report: FastQC flags', () => {
  it('fails per base content on reads that all start alike', () => {
    const rand = rng(2)
    const reads = Array.from({ length: 500 }, () => ({ seq: 'AAAAAAAAAA' + randomSeq(rand, 40) }))
    const r = report(reads).mates[0]
    expect(r.status.baseContent).toBe('fail')
    expect(r.baseContent.a[0]).toBe(100)
  })

  it('flags N calls by position', () => {
    const reads = randomReads(100, 30).map((x, i) => ({ seq: (i < 10 ? 'N' : 'A') + x.seq.slice(1) }))
    const r = report(reads).mates[0]
    expect(r.baseN[0]).toBe(10)
    expect(r.status.baseN).toBe('warn')
  })

  it('takes read quality as FastQC does: whole-number mean, flag on the mode', () => {
    // Scores 30 and 21 average 25.5, which FastQC rounds down to 25.
    const reads = randomReads(100, 2).map(x => ({ ...x, qual: qualOf(1, 30) + qualOf(1, 21) }))
    const r = report(reads).mates[0]
    expect(r.seqQuality.from).toBe(25)
    expect(r.seqQuality.counts).toEqual([100])
    expect(r.status.seqQuality).toBe('warn')
  })

  it('fails per base quality on a low median, warns on a low lower quartile', () => {
    const low = report(randomReads(100, 20).map(x => ({ ...x, qual: qualOf(20, 15) }))).mates[0]
    expect(low.status.baseQuality).toBe('fail')
    const rand = rng(3)
    const mixed = report(randomReads(100, 20).map(x => ({ ...x, qual: rand() < 0.3 ? qualOf(20, 8) : qualOf(20, 36) }))).mates[0]
    expect(mixed.status.baseQuality).toBe('warn')
  })

  it('warns on reads of different lengths and fails on empty ones', () => {
    expect(report([{ seq: 'ACGTACGT' }, { seq: 'ACG' }]).mates[0].status.lengths).toBe('warn')
    const empty = report([{ seq: 'ACGTACGT' }, { seq: '' }]).mates[0]
    expect(empty.status.lengths).toBe('fail')
    expect(empty.emptyReads).toBe(1)
  })

  it('skips the quality modules without qualities', () => {
    const r = report(randomReads(50, 30).map(x => ({ ...x, qual: '' }))).mates[0]
    expect(r.status.baseQuality).toBe('skip')
    expect(r.status.seqQuality).toBe('skip')
    expect(r.status.tileQuality).toBe('skip')
    expect(r.lowestQuality).toBeNull()
  })

  it('notes qualities that look Phred+64', () => {
    const r = report(randomReads(10, 30).map(x => ({ ...x, qual: qualOf(30, 40) }))).mates[0]
    expect(r.notes.basic).toMatch(/Phred\+64/)
  })
})

describe('duplication and overrepresented sequences', () => {
  it('counts every read seen twice as half remaining', () => {
    const reads = randomReads(200, 60, 4)
    const r = report([...reads, ...reads]).mates[0]
    expect(r.duplication.remaining).toBe(50)
    expect(r.duplication.levels[1]).toBe(100)
    // 50 is not below FastQC's error limit of 50.
    expect(r.status.duplication).toBe('warn')
  })

  it('compares long reads by their first 50 bases', () => {
    const rand = rng(5)
    const head = randomSeq(rand, 50)
    const reads = Array.from({ length: 10 }, () => ({ seq: head + randomSeq(rand, 50) }))
    expect(report(reads).mates[0].duplication.remaining).toBe(10)
  })

  it('scales the levels up when tracking stopped early, as FastQC does', () => {
    const seqs = new Map<string, number>()
    for (let i = 0; i < 1000; i++) seqs.set(`s${i}`, i < 500 ? 1 : 2)
    const exact = duplicationLevels(seqs, 1500, 1500)
    expect(exact.remaining).toBeCloseTo((1000 / 1500) * 100, 3)
    // Counting stopped after 1,500 of 10,000 reads: unseen sequences of each level are estimated.
    const estimated = duplicationLevels(seqs, 1500, 10_000)
    expect(estimated.remaining).not.toBeCloseTo(exact.remaining, 1)
  })

  it('names an adapter dimer as its likely source', () => {
    const adapter = 'GATCGGAAGAGCACACGTCTGAACTCCAGTCACATCACGATCTCGTATGC'
    const reads = [...randomReads(950, 60, 6), ...Array.from({ length: 50 }, () => ({ seq: adapter + 'ATCTCGTATG' }))]
    const r = report(reads).mates[0]
    expect(r.overrepresented).toHaveLength(1)
    expect(r.overrepresented[0].percent).toBe(5)
    expect(r.overrepresented[0].source).toMatch(/^TruSeq Adapter, Index 1 \(100% over 50bp\)$/)
    expect(r.status.overrepresented).toBe('fail')
  })

  it('reports the adapter by position, cumulatively', () => {
    const rand = rng(7)
    const reads = Array.from({ length: 100 }, (_, i) => ({
      seq: i < 8 ? randomSeq(rand, 30) + 'AGATCGGAAGAG' + randomSeq(rand, 18) : randomSeq(rand, 60),
    }))
    const r = report(reads).mates[0]
    const universal = r.adapters.find(a => a.name === 'Illumina Universal Adapter')!
    expect(universal.percent[29]).toBe(0)
    expect(universal.percent[30]).toBe(8)
    expect(universal.percent[48]).toBe(8)
    expect(r.status.adapters).toBe('warn')
  })
})

describe('findContaminant', () => {
  it('finds a match with one mismatch on either strand', () => {
    const seq = 'GATCGGAAGAGCACACGTCTGAACTCCAGTCAC'
    const oneOff = seq.slice(0, 15) + 'T' + seq.slice(16)
    expect(findContaminant(oneOff)).toMatch(/\(96% over 33bp\)$/)
    const rc = [...seq].reverse().map(c => ({ A: 'T', C: 'G', G: 'C', T: 'A' } as Record<string, string>)[c]).join('')
    expect(findContaminant(rc)).toMatch(/100% over 33bp/)
  })

  it('matches short queries only as exact substrings', () => {
    expect(findContaminant('GATCGGAAGAGCAC')).toMatch(/100% over 14bp/)
    expect(findContaminant('ACGTTGCATTGCAAGGCTAACGTTTCAGGCTAGCTAAAGCTTGCA')).toBeNull()
  })
})

describe('per tile quality', () => {
  const name = (tile: number, i: number) => `M00123:45:000000000-ABCDE:1:${tile}:${1000 + i}:2000`

  it('finds a tile of poor quality from Casava 1.8 names', () => {
    const rand = rng(8)
    const reads: Read[] = []
    for (let i = 0; i < 300; i++) {
      const tile = [1101, 1102, 1103][i % 3]
      reads.push({ id: name(tile, i), seq: randomSeq(rand, 40), qual: qualOf(40, tile === 1103 ? 20 : 36) })
    }
    const r = report(reads).mates[0]
    expect(r.tiles?.ids).toEqual([1101, 1102, 1103])
    // Tile means 36, 36, 20; their mean is 30.67.
    expect(r.tiles!.deviation[2][0]).toBeCloseTo(-10.67, 2)
    expect(r.tiles!.deviation[0][0]).toBeCloseTo(5.33, 2)
    expect(r.status.tileQuality).toBe('fail')
  })

  it('gives up on the tiles when a name breaks the pattern', () => {
    const reads: Read[] = [{ id: name(1101, 1), seq: 'ACGTACGT' }, { id: 'odd', seq: 'ACGTACGT' }]
    const r = report(reads).mates[0]
    expect(r.status.tileQuality).toBe('skip')
    expect(r.notes.tileQuality).toMatch(/odd/)
  })
})

describe('report per mate and for long reads', () => {
  it('reports each mate on its own', () => {
    const rand = rng(9)
    const reads: Read[] = []
    for (let i = 0; i < 100; i++) {
      reads.push({ seq: randomSeq(rand, 50), mate: 0 })
      reads.push({ seq: randomSeq(rand, 50), qual: qualOf(50, 12), mate: 1 })
    }
    const r = report(reads, { mates: 2 })
    expect(r.mates).toHaveLength(2)
    expect(r.mates[0].status.baseQuality).toBe('pass')
    expect(r.mates[1].status.baseQuality).toBe('fail')
    expect(summarize(r).status.map(s => s.baseQuality)).toEqual(['pass', 'fail'])
  })

  it('skips the modules along a read for long reads', () => {
    const r = report(randomReads(50, 3000), { long: true }).mates[0]
    for (const id of ['baseQuality', 'tileQuality', 'baseContent', 'baseN', 'duplication', 'overrepresented', 'adapters'] as const) {
      expect(r.status[id]).toBe('skip')
      expect(r.notes[id]).toBeTruthy()
    }
    expect(r.status.seqQuality).toBe('pass')
    expect(r.status.seqGc).not.toBe('skip')
  })
})

describe('gcFit', () => {
  it('centres the fit on the mode and measures the deviation', () => {
    const gc = new Float64Array(101)
    gc[40] = 10
    gc[50] = 80
    gc[60] = 10
    const fit = gcFit(gc)
    expect(fit.theoretical.indexOf(Math.max(...fit.theoretical))).toBe(50)
    expect(fit.deviation).toBeGreaterThan(0)
  })

  it('copes with every read at one GC', () => {
    const gc = new Float64Array(101)
    gc[50] = 10
    expect(gcFit(gc).deviation).toBe(0)
  })
})

describe('stored reports', () => {
  it('round-trips through storage', () => {
    const rand = rng(10)
    const reads = Array.from({ length: 300 }, (_, i) => ({
      id: `M1:1:FC:1:${1101 + (i % 2)}:${i}:1`, seq: randomSeq(rand, 80), qual: qualOf(80, 30 + (i % 5)),
    }))
    const direct = report(reads)
    expect(decodeQcReport(encodeQcReport(direct))).toEqual(direct)
  })

  it('treats a damaged report as missing', () => {
    expect(decodeQcReport(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(decodeQcReport(undefined)).toBeNull()
  })
})

describe('expected flags', () => {
  const base = { long: false, trimmed: false }

  it('explains amplicon flags but not a pass or an unrelated module', () => {
    expect(expectedNote('duplication', 'fail', { ...base, library: 'amplicon' })).toMatch(/amplicon/)
    expect(expectedNote('duplication', 'pass', { ...base, library: 'amplicon' })).toBeNull()
    expect(expectedNote('baseQuality', 'fail', { ...base, library: 'amplicon' })).toBeNull()
    expect(expectedNote('duplication', 'fail', base)).toBeNull()
  })

  it('explains length warnings for long and trimmed reads', () => {
    expect(expectedNote('lengths', 'warn', { ...base, long: true })).toBeTruthy()
    expect(expectedNote('lengths', 'warn', { ...base, trimmed: true })).toBeTruthy()
    expect(expectedNote('lengths', 'warn', base)).toBeNull()
  })

  it('leaves the unexpected marks for the worst result', () => {
    const statuses = [{ ...summarize(report(randomReads(100, 50))).status[0], duplication: 'fail' as const, adapters: 'warn' as const }]
    expect(worstUnexpected(statuses, base)).toBe('fail')
    expect(worstUnexpected(statuses, { ...base, library: 'amplicon' })).toBe('warn')
    expect(worstUnexpected(statuses, { ...base, library: 'smallrna' })).toBe('pass')
  })
})

/** MultiQC's FastQC parser (multiqc/modules/fastqc/fastqc.py, parse_fastqc_report), ported for the test. */
function multiqcParse(text: string) {
  const sample = /Filename\s+(.+)/.exec(text)?.[1] ?? null
  const statuses: Record<string, string> = {}
  const data: Record<string, Record<string, string | number>[]> = {}
  let section: string | null = null
  let headers: string[] | null = null
  let dedup: number | null = null
  for (const line of text.split(/\r?\n/)) {
    if (line === '>>END_MODULE') { section = null; headers = null } else if (line.startsWith('>>')) {
      const [name, status] = line.slice(2).split('\t')
      section = name.toLowerCase().replace(/ /g, '_')
      statuses[section] = status
    } else if (section === 'per_tile_sequence_quality') {
      continue
    } else if (section !== null) {
      if (line.startsWith('#')) {
        const h = line.slice(1).split('\t')
        if (h[0] === 'Total Deduplicated Percentage') dedup = Number(h[1])
        else { headers = h.map(s => s.toLowerCase().replace(/ /g, '_')); data[section] = [] }
      } else if (headers) {
        const row: Record<string, string | number> = {}
        line.split('\t').forEach((v, i) => { row[headers![i]] = Number.isNaN(Number(v)) ? v : Number(v) })
        data[section].push(row)
      }
    }
  }
  return { sample, statuses, data, dedup }
}

describe('FastQC data file', () => {
  it('reads back as MultiQC reads it', () => {
    const rand = rng(11)
    const reads = Array.from({ length: 200 }, (_, i) => ({ id: `M1:1:FC:1:${1101 + (i % 2)}:${i}:1`, seq: randomSeq(rand, 60) }))
    const m = report(reads).mates[0]
    const parsed = multiqcParse(fastqcDataText(m, 'sample_R1.fastq.gz'))
    expect(parsed.sample).toBe('sample_R1.fastq.gz')
    expect(Object.keys(parsed.statuses)).toEqual([
      'basic_statistics', 'per_base_sequence_quality', 'per_tile_sequence_quality', 'per_sequence_quality_scores',
      'per_base_sequence_content', 'per_sequence_gc_content', 'per_base_n_content', 'sequence_length_distribution',
      'sequence_duplication_levels', 'overrepresented_sequences', 'adapter_content',
    ])
    expect(parsed.data.basic_statistics.find(r => r.measure === 'Total Sequences')?.value).toBe(200)
    expect(parsed.data.per_base_sequence_quality).toHaveLength(60)
    expect(parsed.data.per_base_sequence_quality[0]).toMatchObject({ base: 1, median: 35 })
    expect(parsed.data.per_sequence_gc_content).toHaveLength(101)
    expect(parsed.data.sequence_length_distribution).toEqual([{ length: 60, count: 200 }])
    expect(parsed.dedup).toBe(m.duplication.remaining)
    expect(parsed.data.adapter_content[0]).toHaveProperty('illumina_universal_adapter', 0)
  })

  it('leaves out the modules not run', () => {
    const m = report(randomReads(20, 3000), { long: true }).mates[0]
    const text = fastqcDataText(m, 'run.fastq')
    expect(text).not.toContain('>>Per base sequence quality')
    expect(text).toContain('>>Sequence Length Distribution\tpass')
  })

  it('writes base counts as FastQC does', () => {
    expect(fastqcBases(950)).toBe('950 bp')
    expect(fastqcBases(3_000_000)).toBe('3 Mbp')
    expect(fastqcBases(1_234_000_000)).toBe('1.2 Gbp')
  })
})
