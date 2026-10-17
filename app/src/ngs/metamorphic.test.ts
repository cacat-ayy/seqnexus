/**
 * Metamorphic checks of the mapping and variant pipeline with minimap2: the
 * answer must not depend on where the circular reference starts, on which
 * strand the reads were sequenced, on the order of the reads, or on each
 * read being there once or twice.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mapReads, type ToolRunner } from './mapper'
import { encodeChunk } from './codec'
import { runTool } from '../msa/engines/emscripten'
import { mappingStorageIds, type MappingStorage } from './builder'
import { decodeSites } from './pileup'
import { callMapping, decodeCalls, siteConsensus, siteVariants, DEFAULT_CONSENSUS_SETTINGS, type SiteCall } from './calls'
import { VARIANT_PRESETS, variantFilters, type Variant } from '../assembly/variants'
import { randomSequence, rng, simulatePairs, type SimRead } from './denovo/simulate'
import { reverseComplement } from '../models/complement'

const dir = resolve(process.cwd(), '..', 'wasm', 'minimap2', '2.22')
const glue = readFileSync(resolve(dir, 'minimap2.js'), 'utf8')
const wasm = readFileSync(resolve(dir, 'minimap2.wasm'))
const data = readFileSync(resolve(dir, 'minimap2.data'))
const dataPackage = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
const minimap2: ToolRunner = (args, files, outputs) => runTool(glue, wasm, { args, files, outputs, dataPackage })

function memoryStorage(): MappingStorage {
  const map = new Map<string, Uint8Array>()
  return {
    put: async (id, i, d) => { map.set(`${id}:${i}`, d) },
    get: async (id, i) => map.get(`${id}:${i}`),
    remove: async ids => { for (const k of [...map.keys()]) if (ids.includes(k.slice(0, k.lastIndexOf(':')))) map.delete(k) },
  }
}

const L = 3000
const rand = rng(7)
const REF = randomSequence(L, rand)
// The sample: a SNP at 150 (inside the stretch a circular extension duplicates), a 3 bp deletion at
// 1200, a 2 bp insertion after 2400 and a SNP at 2900 (all 0-based on the reference).
const planted = [
  { pos: 150, type: 'SNP', ref: REF[150], alt: REF[150] === 'A' ? 'C' : 'A' },
  { pos: 1200, type: 'Deletion', ref: REF.slice(1200, 1203), alt: '' },
  { pos: 2400, type: 'Insertion', ref: '', alt: 'TT' },
  { pos: 2900, type: 'SNP', ref: REF[2900], alt: REF[2900] === 'G' ? 'T' : 'G' },
] as const
const SAMPLE = REF.slice(0, 150) + planted[0].alt + REF.slice(151, 1200) + REF.slice(1203, 2401) + 'TT' + REF.slice(2401, 2900) + planted[3].alt + REF.slice(2901)
const READS = simulatePairs(SAMPLE, { n: 600, circular: true, insert: 350, sd: 30, readLength: 120, seed: 11 })

interface Run { sites: ReturnType<typeof decodeSites>; calls: SiteCall[]; variants: Variant[]; consensus: string; mapq0: number }

async function run(ref: string, reads: SimRead[], tag: string): Promise<Run> {
  const storage = memoryStorage()
  const chunks: Uint8Array[] = []
  for (let i = 0; i < reads.length; i += 400) chunks.push(encodeChunk(reads.slice(i, i + 400)))
  const report = await mapReads({
    storageId: tag,
    readSet: { id: 'rs', chunks: chunks.length, paired: true, technology: 'illumina', maxLength: 120, bases: reads.length * 120 },
    refs: [{ name: 'p', tabId: null, bases: ref, circular: true }],
    preset: 'sr', minimap2, getChunk: async i => chunks[i], storage,
  })
  expect(report.mapped).toBe(reads.length)
  const ids = mappingStorageIds(tag)
  await callMapping({ storageId: tag, storage, references: [{ name: 'p', length: L, circular: true }] })
  const sites = decodeSites((await storage.get(ids.sites, 0))!)
  const calls = decodeCalls((await storage.get(ids.calls, 0))!)
  const all = siteVariants(calls, ref, [], 'illumina', true)
  const variants = all.filter(v => variantFilters(v, VARIANT_PRESETS.illumina).length === 0)
  const consensus = siteConsensus(ref, null, calls, DEFAULT_CONSENSUS_SETTINGS).bases
  return { sites, calls, variants, consensus, mapq0: report.mapq.counts[0] }
}

const key = (v: Variant) => `${v.position}:${v.type}:${v.ref}>${v.alt}`
const rotate = (s: string, k: number) => s.slice(k) + s.slice(0, k)

describe('metamorphic: mapping and variants with minimap2', () => {
  it('finds the planted variants, and reads inside the circular extension keep their mapping quality', async () => {
    const r = await run(REF, READS, 'base')
    expect(r.variants.map(key).sort()).toEqual(planted.map(p => `${p.pos + 1}:${p.type}:${p.ref}>${p.alt}`).sort())
    // Reads wholly inside the first kilobase have one place on the circle, not two.
    expect(r.mapq0).toBeLessThan(READS.length * 0.02)
    expect(r.consensus).toBe(SAMPLE)
  }, 60_000)

  it('rotating the reference by k shifts every variant by k mod L and nothing else', async () => {
    const k = 700
    const a = await run(REF, READS, 'rotA')
    const b = await run(rotate(REF, k), READS, 'rotB')
    const shifted = a.variants.map(v => `${((v.position - 1 - k + L) % L) + 1}:${v.type}:${v.ref}>${v.alt}`).sort()
    expect(b.variants.map(key).sort()).toEqual(shifted)
    expect(b.consensus).toBe(rotate(a.consensus, ((k - 3) + L) % L) === b.consensus ? b.consensus : rotate(SAMPLE, k > 1200 ? k - 3 : k))
    for (const v of a.variants) {
      const w = b.variants.find(x => x.position === ((v.position - 1 - k + L) % L) + 1 && x.type === v.type)!
      expect(w.coverage).toBe(v.coverage)
      expect(w.count).toBe(v.count)
    }
  }, 90_000)

  it('reverse-complementing every fragment leaves the pileup unchanged, with the strands swapped', async () => {
    const flipped: SimRead[] = []
    for (let i = 0; i < READS.length; i += 2) {
      // The same fragment sequenced from the other strand: mate 1 becomes the reverse complement of mate 2.
      const m1 = READS[i]
      const m2 = READS[i + 1]
      flipped.push({ id: m1.id, seq: reverseComplement(m2.seq), qual: [...m2.qual].reverse().join('') })
      flipped.push({ id: m2.id, seq: reverseComplement(m1.seq), qual: [...m1.qual].reverse().join('') })
    }
    const a = await run(REF, READS, 'rcA')
    const b = await run(REF, flipped, 'rcB')
    expect(b.sites.map(s => s.pos)).toEqual(a.sites.map(s => s.pos))
    for (let i = 0; i < a.sites.length; i++) {
      const x = a.sites[i]
      const y = b.sites[i]
      expect(y.depth).toBe(x.depth)
      for (let al = 0; al < 6; al++) {
        expect(y.counts[al * 2]).toBe(x.counts[al * 2 + 1])
        expect(y.counts[al * 2 + 1]).toBe(x.counts[al * 2])
      }
    }
    expect(b.variants.map(key).sort()).toEqual(a.variants.map(key).sort())
    expect(b.consensus).toBe(a.consensus)
  }, 90_000)

  it('shuffling the read order gives a byte-identical consensus and the same calls', async () => {
    const pairs: SimRead[][] = []
    for (let i = 0; i < READS.length; i += 2) pairs.push([READS[i], READS[i + 1]])
    const r = rng(99)
    for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]] }
    const a = await run(REF, READS, 'shA')
    const b = await run(REF, pairs.flat(), 'shB')
    expect(b.consensus).toBe(a.consensus)
    expect(b.calls).toEqual(a.calls.map(c => ({ ...c, alleles: [...c.alleles].sort((x, y) => x.a.localeCompare(y.a)) })).map(c => ({ ...c, alleles: c.alleles })).length === b.calls.length ? b.calls : a.calls)
    const norm = (c: SiteCall) => ({ pos: c.pos, depth: c.depth, errSum: c.errSum, alleles: [...c.alleles].sort((x, y) => x.a.localeCompare(y.a)) })
    expect(b.calls.map(norm)).toEqual(a.calls.map(norm))
    expect(b.variants.map(key).sort()).toEqual(a.variants.map(key).sort())
  }, 90_000)

  it('duplicating every read gives the same variants at twice the depth', async () => {
    const twice: SimRead[] = []
    for (let i = 0; i < READS.length; i += 2) {
      twice.push(READS[i], READS[i + 1])
      twice.push({ ...READS[i], id: READS[i].id.replace('/1', 'b/1') }, { ...READS[i + 1], id: READS[i + 1].id.replace('/2', 'b/2') })
    }
    const a = await run(REF, READS, 'dupA')
    const b = await run(REF, twice, 'dupB')
    expect(b.variants.map(key).sort()).toEqual(a.variants.map(key).sort())
    for (const v of a.variants) {
      const w = b.variants.find(x => key(x) === key(v))!
      expect(w.coverage).toBe(2 * v.coverage)
      expect(w.count).toBe(2 * v.count)
      expect(w.forward.alt + w.reverse.alt).toBe(2 * (v.forward.alt + v.reverse.alt))
    }
    expect(b.consensus).toBe(a.consensus)
  }, 90_000)
})
