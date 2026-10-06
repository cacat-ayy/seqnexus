import { describe, expect, it } from 'vitest'
import { parseSamLine } from './mapper'
import { MappingBuilder, type MappingStorage } from './builder'
import { storeAlignment } from './alignments'
import {
  baseAt, editDistance, expectedInsert, fragmentLength, hashName, layoutReads, MappingSource, pairClass, queryLength,
  readDiff, readInRow, sortRows, viewRead, windowPileup, type LayoutOptions,
} from './view'
import { clampScale, depthOver } from '../components/ngs/mappingPaint'

function memoryStorage(): MappingStorage {
  const map = new Map<string, Uint8Array>()
  return {
    put: async (id, i, d) => { map.set(`${id}:${i}`, d) },
    get: async (id, i) => map.get(`${id}:${i}`),
    remove: async ids => { for (const k of [...map.keys()]) if (ids.includes(k.slice(0, k.lastIndexOf(':')))) map.delete(k) },
  }
}

const sam = (line: string) => parseSamLine(line, n => (n === 'ref0' ? 0 : -1))
const REF = 'ACGTACGTAAGGCCTTACGTACGTAAGGCCTT' // 32 bp
const program = { id: 'x', name: 'x', version: '', command: '' }
const opts = (o: Partial<LayoutOptions> = {}): LayoutOptions => ({ softClips: false, downsample: null, minMapq: 0, gap: 1, maxRows: 100, ...o })

async function build(lines: string[], circular = false) {
  const storage = memoryStorage()
  const refs = [{ name: 'r', tabId: null, bases: REF, circular }]
  const b = new MappingBuilder({ storageId: 'm', refs, paired: false, storage, expectedBases: 100, bucketBases: 8, spillBytes: 1 })
  for (const l of lines) await b.add(sam(l), 0)
  await b.finish({ preset: 'sr', program })
  return new MappingSource(storage, 'm', [{ name: 'r', length: REF.length, circular }])
}

describe('MappingSource', () => {
  it('loads the alignments over a stretch, and the copy of a read across a circular origin', async () => {
    const src = await build([
      'a\t0\tref0\t1\t60\t8M\t*\t0\t0\tACGTACGT\t*',
      'b\t0\tref0\t13\t60\t8M\t*\t0\t0\tCCTTACGT\t*',
      // Starts at 29 and runs 6 bases: 28-31, then 0-1 across the origin.
      'c\t16\tref0\t29\t60\t6M\t*\t0\t0\tCCTTAC\t*',
    ], true)
    const names = async (s: number, e: number) => (await src.load(0, s, e)).map(r => `${r.a.name}@${r.start}`)
    expect(await names(0, 4)).toEqual(['c@-4', 'a@0'])
    expect(await names(10, 14)).toEqual(['b@12'])
    expect(await names(30, 32)).toEqual(['c@28'])
    expect(await src.countIn(0, 0, 32)).toBeGreaterThanOrEqual(3)
    expect((await src.coverage(0))[0]).toBe(2)
    expect(await src.reference(0)).toBe(REF)
  })
})

describe('one read', () => {
  const ref = { bases: REF, circular: false }
  // ACGT A[C>G]GT, insert TT after 8, delete 2 (AA), then GG; soft clip 2 at each end.
  const a = storeAlignment(ref, sam('x\t16\tref0\t1\t30\t2S8M2I2D2M2S\t*\t0\t0\tNNACGTAGGTTTGGNN\t!!IIIII#IIIIIIII'), 0)

  it('lists mismatches, insertions and deletions with their qualities', () => {
    const d = readDiff(a)
    expect(d.mismatches).toEqual([{ pos: 5, base: 'G', qual: 2 }])
    expect(d.insertions).toEqual([{ pos: 8, bases: 'TT', qual: 40 }])
    expect(d.deletions).toEqual([{ pos: 8, len: 2 }])
    expect(editDistance(d)).toBe(5)
    expect(queryLength(a)).toBe(16)
  })

  it('says what the read shows at a position, counted along the read as sequenced', () => {
    expect(baseAt(a, ref, 0)).toEqual({ kind: 'match', base: 'A', qual: 40, readPos: 14 })
    expect(baseAt(a, ref, 5)).toMatchObject({ kind: 'mismatch', base: 'G', qual: 2 })
    expect(baseAt(a, ref, 9)?.kind).toBe('deletion')
    expect(baseAt(a, ref, 10)).toMatchObject({ kind: 'match', base: 'G' })
    expect(baseAt(a, ref, 12)).toBeNull()
  })
})

describe('layout', () => {
  const ref = { bases: REF, circular: false }
  const read = (name: string, pos: number, len: number, extra = '') => viewRead(storeAlignment(ref, sam(`${name}\t${extra || 0}\tref0\t${pos + 1}\t60\t${len}M\t*\t0\t0\t${REF.slice(pos, pos + len)}\t*`), 0), 0)

  it('packs reads into the first row with room', () => {
    const rs = [read('a', 0, 10), read('b', 2, 5), read('c', 11, 5), read('d', 8, 4)]
    const l = layoutReads(rs, opts())
    expect(l.rows.map(row => row.map(r => r.a.name))).toEqual([['a', 'c'], ['b', 'd']])
    expect(readInRow(l.rows[0], 12)?.a.name).toBe('c')
    expect(readInRow(l.rows[0], 10)).toBeNull()
  })

  it('downsamples the same way every time, and keeps the mates of a pair together', () => {
    const rs = Array.from({ length: 40 }, (_, i) => read(`r${i % 20}`, i % 2 ? 1 : 0, 6))
    const l1 = layoutReads(rs, opts({ downsample: { window: 10, max: 10 }, maxRows: 1000 }))
    const l2 = layoutReads([...rs].reverse(), opts({ downsample: { window: 10, max: 10 }, maxRows: 1000 }))
    const kept = (l: ReturnType<typeof layoutReads>) => l.rows.flat().map(r => r.a.name).sort()
    expect(l1.sampledOut).toBe(30)
    expect(l1.sampled).toEqual([[0, 10]])
    expect(kept(l1)).toEqual(kept(l2))
    // The ten with the lowest hashes are five names, both copies of each.
    const names = [...new Set(kept(l1))]
    expect(names.length).toBe(5)
    expect(names.sort()).toEqual([...new Set(rs.map(r => r.a.name))].sort((x, y) => hashName(x) - hashName(y)).slice(0, 5).sort())
  })

  it('filters by mapping quality and counts reads beyond the last row', () => {
    const low = viewRead(storeAlignment(ref, sam('q\t0\tref0\t1\t0\t4M\t*\t0\t0\tACGT\t*'), 0), 0)
    const l = layoutReads([read('a', 0, 8), read('b', 0, 8), read('c', 0, 8), low], opts({ minMapq: 1, maxRows: 2 }))
    expect(l).toMatchObject({ total: 3, filtered: 1, overflow: 1 })
    expect(l.rows.length).toBe(2)
  })

  it('sorts rows by the base their read shows at a position', () => {
    const alt = viewRead(storeAlignment(ref, sam(`m\t16\tref0\t1\t60\t8M\t*\t0\t0\tACGTTCGT\t*`), 0), 0)
    const l = layoutReads([read('a', 0, 8), read('b', 0, 8), alt, read('far', 20, 4)], opts({ gap: 30 }))
    const s = sortRows(l, 4, 'base', ref, 0)
    expect(s.rows[0][0].a.name).toBe('m')
    expect(s.rows[0][0].row).toBe(0)
    expect(s.rows[s.rows.length - 1][0].a.name).toBe('far')
    const st = sortRows(l, 4, 'strand', ref, 0)
    expect(st.rows[2][0].a.name).toBe('m')
  })

  it('counts the loaded reads into a pileup', () => {
    const p = windowPileup([read('a', 0, 8), read('b', 4, 8, '16')], ref, 2, 10)
    expect([...p.depth]).toEqual([1, 1, 2, 2, 2, 2, 1, 1])
    expect([...p.forward]).toEqual([1, 1, 1, 1, 1, 1, 0, 0])
    // Position 4 is A, counted twice.
    expect(p.counts[2 * 6 + 0]).toBe(2)
  })
})

describe('pairs', () => {
  const ref = { bases: REF, circular: false }
  const pair = (flag: number, pos: number, mpos: number, tlen: number, mref = '=') =>
    storeAlignment(ref, sam(`p\t${flag}\tref0\t${pos}\t60\t4M\t${mref}\t${mpos}\t${tlen}\tACGT\t*`), 0)

  it('classes pairs by distance and orientation', () => {
    const exp: [number, number] = [8, 12]
    expect(pairClass(pair(99, 1, 7, 10), 0, 32, false, exp)).toBe('proper')
    expect(pairClass(pair(99, 1, 17, 20), 0, 32, false, exp)).toBe('larger')
    expect(pairClass(pair(99, 1, 3, 6), 0, 32, false, exp)).toBe('smaller')
    // Both forward.
    expect(pairClass(pair(65, 1, 7, 10), 0, 32, false, exp)).toBe('orientation')
    // Forward mate to the right of the reverse one: facing away.
    expect(pairClass(pair(83, 1, 7, 10), 0, 32, false, exp)).toBe('orientation')
    expect(pairClass(pair(73, 1, 0, 0, '*'), 0, 32, false, exp)).toBe('mateUnmapped')
    expect(pairClass(pair(0, 1, 0, 0, '*'), 0, 32, false, exp)).toBe('single')
  })

  it('measures fragments the short way round a circular reference', () => {
    expect(fragmentLength(pair(99, 1, 7, 10), 0, 32, false)).toBe(10)
    expect(fragmentLength(pair(99, 1, 7, 28), 0, 32, true)).toBe(4)
  })

  it('takes the expected fragment lengths from the middle 99% of the histogram', () => {
    expect(expectedInsert({ edges: [100, 200, 300], counts: [0, 100] })).toEqual([200, 300])
    expect(expectedInsert({ edges: [], counts: [] })).toBeNull()
  })
})

describe('view scale', () => {
  it('keeps the view within the reference and the zoom limits', () => {
    expect(clampScale({ start: -50, bpPerPx: Infinity }, 1000, 100)).toEqual({ start: 0, bpPerPx: 10 })
    expect(clampScale({ start: 990, bpPerPx: 1 }, 1000, 100)).toEqual({ start: 900, bpPerPx: 1 })
    expect(clampScale({ start: 0, bpPerPx: 0.001 }, 1000, 100).bpPerPx).toBeCloseTo(1 / 24)
  })

  it('reads depth from the loaded pileup, then per-base coverage, then summaries', () => {
    const coverage = Uint32Array.from({ length: 64 }, (_, i) => i)
    const levels = [{ binSize: 16, mean: Float32Array.from([1, 2, 3, 4]), max: Float32Array.from([2, 4, 6, 8]), forward: Float32Array.from([1, 1, 0, 0]) }]
    expect(depthOver({ coverage, levels, pileup: null }, 10, 12, 2)).toMatchObject({ mean: 10.5, max: 11, forward: 1 })
    expect(depthOver({ coverage: null, levels, pileup: null }, 16, 48, 32)).toMatchObject({ mean: 2.5, max: 6, forward: 0.2 })
  })
})
