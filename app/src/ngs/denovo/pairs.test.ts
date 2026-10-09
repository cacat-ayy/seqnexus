import { describe, expect, it } from 'vitest'
import { encodeChunk } from '../codec'
import { BASE_CODE, KmerRoller } from './kmer'
import { exitOf, insertOf, pathsBetween, SparseIndex, chainSequence } from './pairs'
import { assembleShortReads } from './short'
import { compareToExpected } from './compare'
import { randomSequence, rng, simulatePairs, type SimRead } from './simulate'
import { reverseComplement as revcomp } from '../../models/complement'
import { DEFAULT_SHORT_SETTINGS } from './types'
import type { GraphLink } from './graph'

const codes = (s: string) => Array.from(s, c => BASE_CODE[c.charCodeAt(0)])

function chunksOf(reads: SimRead[]): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let i = 0; i < reads.length; i += 2000) out.push(encodeChunk(reads.slice(i, i + 2000)))
  return out
}

describe('placing pairs', () => {
  const rand = rng(51)
  const tig = randomSequence(3000, rand)

  it('places a read on either strand with its 5\' end', () => {
    const index = new SparseIndex([{ seq: tig, circular: false, coverage: 1 }], 31)
    const roller = new KmerRoller(31)
    const f = index.place(codes(tig.slice(1000, 1150)), roller)
    expect(f).toEqual({ tig: 0, pos5: 1000, forward: true })
    const r = index.place(codes(revcomp(tig.slice(1200, 1350))), roller)
    expect(r).toEqual({ tig: 0, pos5: 1349, forward: false })
    expect(insertOf(f!, r!)).toBe(350)
    expect(exitOf(f!, 3000)).toEqual({ strand: '+', dist: 2000 })
    expect(exitOf(r!, 3000)).toEqual({ strand: '-', dist: 1350 })
  })

  it('finds the single path of the right length, and none when two fit', () => {
    // 0 -> 2 -> 1 and 0 -> 3 -> 1, unitigs 2 and 3 of different lengths; k = 31.
    const lengths = [1000, 1000, 150, 200]
    const links: GraphLink[] = [[0, '+', 2, '+'], [2, '+', 1, '+'], [0, '+', 3, '+'], [3, '+', 1, '+']]
    const adj: [number, '+' | '-'][][] = Array.from({ length: 8 }, () => [])
    for (const [a, as, b, bs] of links) {
      adj[a * 2 + (as === '-' ? 1 : 0)].push([b, bs])
      adj[b * 2 + (bs === '-' ? 0 : 1)].push([a, as === '+' ? '-' : '+'])
    }
    const passable = (t: number) => lengths[t] < 500
    // Through unitig 2: 150 - 2 * 30 = 90 bases between.
    expect(pathsBetween(adj, lengths, 31, 0, '+', 1, '+', 90, 20, passable)).toEqual([[[2, '+']]])
    expect(pathsBetween(adj, lengths, 31, 0, '+', 1, '+', 140, 20, passable)).toEqual([[[3, '+']]])
    expect(pathsBetween(adj, lengths, 31, 0, '+', 1, '+', 115, 40, passable).length).toBe(2)
    expect(chainSequence([{ seq: 'ACGTA', circular: false, coverage: 1 }, { seq: 'TAGGC', circular: false, coverage: 1 }], [[0, '+'], [1, '+']], 3)).toBe('ACGTAGGC')
  })
})

describe('joining contigs with pairs', () => {
  it('joins across repeats shorter than the insert and leaves a longer one', async () => {
    const rand = rng(52)
    const short1 = randomSequence(160, rand)
    const short2 = randomSequence(180, rand)
    const long = randomSequence(1200, rand)
    const piece = () => randomSequence(15000, rand)
    // Each short repeat twice (once reversed), the long one twice: circular.
    const genome = piece() + short1 + piece() + short2 + piece() + revcomp(short1) + piece() + long + piece() + short2 + piece() + long
    const reads = simulatePairs(genome, { n: 30000, circular: true, insert: 380, sd: 30, readLength: 150, seed: 53 })
    const chunks = chunksOf(reads)
    const bases = reads.reduce((n, r) => n + r.seq.length, 0)
    const run = (pairs: boolean) => assembleShortReads({
      readSet: { chunks: chunks.length, bases, meanLength: bases / reads.length, paired: true },
      settings: { ...DEFAULT_SHORT_SETTINGS, k: 99, pairs },
      getChunk: async i => chunks[i],
    })
    const without = await run(false)
    const withPairs = await run(true)
    const p = withPairs.report.pairs!
    expect(Math.abs(p.insert - 380)).toBeLessThan(10)
    expect(p.insertSd).toBeGreaterThan(15)
    expect(p.joins).toBeGreaterThanOrEqual(4)
    // Without pairs: six stretches between repeats, and the repeats. With them: the two stretches around the long repeat.
    const big = (r: typeof without) => r.contigs.filter(c => c.bases.length > 5000)
    expect(big(without).length).toBe(6)
    expect(big(withPairs).length).toBe(2)
    // Every joined contig is exact: it lies in the genome as it is.
    for (const c of big(withPairs)) {
      const cmp = compareToExpected({ contig: c.bases, contigCircular: false, expected: genome, expectedCircular: true })
      expect(cmp.differences.length).toBe(0)
    }
    expect(withPairs.graph.segments.some(s => /part 2/.test(s.name))).toBe(true)
  }, 120_000)
})
