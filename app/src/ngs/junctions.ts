/**
 * Junctions: positions where many reads stop aligning at the same base.
 *
 * An aligner soft-clips the part of a read it cannot place next to the
 * rest. When several reads are clipped at the same reference position, the
 * sample's sequence leaves the reference there: the edge of a deletion too
 * long to align through, an inversion, an insertion of other DNA, a
 * plasmid's junction with its vector, a construct's assembly seam. Every
 * stored alignment (primary and supplementary) with at least MIN_CLIP bases
 * clipped at an end counts for the junction at that end, by side: "left"
 * when the clip is before the aligned part (the reads continue to the left
 * as something else), "right" when it is after.
 *
 * A junction is kept when at least MIN_READS reads, and at least 10% of the
 * reads covering the position, are clipped there. Its clipped sequence is
 * the majority base at each distance from the junction while two or more
 * reads reach that far, written outward from the junction. The first 20 of
 * those bases are then looked for on every reference (both strands): where
 * they are found exactly once is where the sample's sequence continues.
 * Mapped back to the same reference on the same strand further on, a right
 * junction reads as a deletion of the bases between; on the other strand as
 * an inversion; on another reference as a join to it.
 *
 * Found once in the background and stored with the mapping.
 */

import { deflateSync, inflateSync } from 'fflate'
import { decodePage, type StoredAlignment } from './alignments'
import { mappingStorageIds, type MappingStorage } from './builder'
import { readMappingIndex, readReferenceBases } from './sam'
import type { AnnotationData } from '../models/Annotation'

export const MIN_CLIP = 10
export const MIN_READS = 3
export const MIN_SHARE = 0.1
/** Bases of the clipped sequence looked for on the references. */
export const PARTNER_SEED = 20
/** Most junctions kept per reference (the best supported). */
const MAX_JUNCTIONS = 500
/** Clipped sequences kept per junction for its consensus. */
const MAX_SEQS = 60

export interface Junction {
  /** The reference position at the edge of the aligned part: its first base (left) or one past its last (right). */
  pos: number
  side: 'left' | 'right'
  reads: number
  forward: number
  reverse: number
  /** Reads covering the position. */
  depth: number
  /** The clipped sequence, read outward from the junction: for a left junction its bases run leftward, so in reverse order. */
  clipped: string
  /** Where the clipped sequence continues, when found once on a reference. */
  partner: { ref: number; pos: number; strand: 1 | -1 } | null
}

interface Acc { f: number; r: number; seqs: string[] }

function rc(s: string): string {
  const m: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' }
  let out = ''
  for (let i = s.length - 1; i >= 0; i--) out += m[s[i]] ?? 'N'
  return out
}

/** Count one alignment's clips. Left-clip sequences are stored reversed, so index 0 is the base next to the junction. */
export function countClips(a: StoredAlignment, L: number, acc: Map<string, Acc>): void {
  const add = (pos: number, side: 'left' | 'right', seq: string) => {
    const key = `${side === 'left' ? 'L' : 'R'}${pos}`
    let x = acc.get(key)
    if (!x) { x = { f: 0, r: 0, seqs: [] }; acc.set(key, x) }
    if (a.flag & 0x10) x.r++
    else x.f++
    if (x.seqs.length < MAX_SEQS) x.seqs.push(seq)
  }
  if (a.clipL.length >= MIN_CLIP) add(a.start % L, 'left', [...a.clipL.toUpperCase()].reverse().join(''))
  if (a.clipR.length >= MIN_CLIP) add(a.end % L, 'right', a.clipR.toUpperCase())
}

/** Majority base at each distance from the junction, while two or more sequences reach that far. */
export function clipConsensus(seqs: readonly string[]): string {
  let out = ''
  for (let i = 0; ; i++) {
    const counts = new Map<string, number>()
    let n = 0
    for (const s of seqs) if (i < s.length) { counts.set(s[i], (counts.get(s[i]) ?? 0) + 1); n++ }
    if (n < 2) break
    let best = 'N'
    let bestN = 0
    for (const [b, c] of counts) if (c > bestN) { best = b; bestN = c }
    out += bestN * 2 > n ? best : 'N'
  }
  return out
}

/**
 * Where the clipped sequence continues: its PARTNER_SEED bases next to the
 * junction, found exactly once on the references (either strand). For a
 * right junction the sequence reads forward from the junction; for a left
 * one it was stored reversed, so the bases as they read are reversed back.
 */
export function findPartner(j: Pick<Junction, 'side' | 'clipped'>, refs: readonly { bases: string; circular: boolean }[]): Junction['partner'] {
  if (j.clipped.length < PARTNER_SEED) return null
  const near = j.clipped.slice(0, PARTNER_SEED)
  // As it reads on the forward strand of the read.
  const seed = j.side === 'right' ? near : [...near].reverse().join('')
  if (seed.includes('N')) return null
  let hit: Junction['partner'] = null
  let hits = 0
  refs.forEach((ref, r) => {
    const text = ref.circular ? ref.bases + ref.bases.slice(0, PARTNER_SEED - 1) : ref.bases
    for (const [q, strand] of [[seed, 1], [rc(seed), -1]] as const) {
      let at = text.indexOf(q)
      while (at >= 0 && hits < 2) {
        hits++
        // The partner position is the base the sequence continues from, next to the junction.
        const L = ref.bases.length
        const pos = strand === 1
          ? (j.side === 'right' ? at : at + PARTNER_SEED) % L
          : (j.side === 'right' ? at + PARTNER_SEED : at) % L
        hit = { ref: r, pos, strand }
        at = text.indexOf(q, at + 1)
      }
    }
  })
  return hits === 1 ? hit : null
}

/** What a junction suggests, in words. */
export function describeJunction(j: Junction, refIndex: number, refNames: readonly string[]): string {
  const p = j.partner
  if (!p) return j.clipped.length < PARTNER_SEED ? 'Clipped sequence too short to place' : 'Clipped sequence not found on the references'
  if (p.ref !== refIndex) return `Continues on ${refNames[p.ref] ?? 'another reference'} at ${(p.pos + 1).toLocaleString()}${p.strand === -1 ? ', other strand' : ''}`
  if (p.strand === -1) return `Continues at ${(p.pos + 1).toLocaleString()} on the other strand: an inversion?`
  const gap = j.side === 'right' ? p.pos - j.pos : j.pos - p.pos
  if (gap > 0) return `Continues ${gap.toLocaleString()} bases on: a deletion of ${gap.toLocaleString()} bases?`
  if (gap < 0) return `Continues ${(-gap).toLocaleString()} bases back: a duplication?`
  return 'Continues next to itself'
}

let junctionSeq = 0

/**
 * A `variation` feature for each junction, on the base where the reads stop
 * aligning (the last base before the clip), named by what the junction
 * suggests. `variation`, as for variants, so the variant caller and clone
 * verification do not take it for a feature of the construct.
 */
export function junctionAnnotations(js: readonly Junction[], refIndex: number, refNames: readonly string[], refLength: number): AnnotationData[] {
  return js.map(j => {
    const base = Math.max(0, Math.min(refLength - 1, j.side === 'left' ? j.pos : j.pos - 1))
    const what = describeJunction(j, refIndex, refNames)
    const outward = j.side === 'left' ? [...j.clipped].reverse().join('') : j.clipped
    return {
      id: `junction_${Date.now().toString(36)}_${++junctionSeq}`,
      name: `Junction, ${j.side === 'left' ? 'left' : 'right'} side`,
      type: 'variation',
      start: base, end: base + 1, strand: 0 as const,
      qualifiers: {
        note: [
          what,
          `${j.reads} of ${j.depth} reads (${Math.round((j.reads / Math.max(1, j.depth)) * 100)}%) clipped to the ${j.side}, ${j.forward} forward and ${j.reverse} reverse`,
          `clipped bases: ${outward.length > 60 ? `${outward.slice(0, 60)}...` : outward}`,
        ],
      },
    }
  })
}

export function encodeJunctions(js: readonly Junction[]): Uint8Array {
  return deflateSync(new TextEncoder().encode(JSON.stringify(js)), { level: 4 })
}

export function decodeJunctions(d: Uint8Array): Junction[] {
  return JSON.parse(new TextDecoder().decode(inflateSync(d))) as Junction[]
}

/** Find every reference's junctions and store them (under the mapping's `junctions` id, one entry per reference). */
export async function findJunctions(o: {
  storageId: string
  storage: Pick<MappingStorage, 'get' | 'put'>
  references: readonly { name: string; length: number; circular: boolean }[]
  onProgress?: (done: number, total: number) => void
}): Promise<{ junctions: number }> {
  const ids = mappingStorageIds(o.storageId)
  const index = await readMappingIndex(o.storage, o.storageId)
  const total = index.refs.reduce((n, r) => n + r.pages.length, 0)
  const bases = await Promise.all(o.references.map(async (r, i) => ({ bases: (await readReferenceBases(o.storage, o.storageId, i)).toUpperCase(), circular: r.circular })))
  let done = 0
  let count = 0
  o.onProgress?.(0, total)
  for (let r = 0; r < o.references.length; r++) {
    const L = o.references[r].length || 1
    const acc = new Map<string, Acc>()
    for (const pg of index.refs[r]?.pages ?? []) {
      const data = await o.storage.get(ids.pages, pg.index)
      if (!data) throw new Error('Part of the mapping is missing from this browser\'s storage')
      for (const a of decodePage(data)) countClips(a, L, acc)
      o.onProgress?.(++done, total)
    }
    const covData = await o.storage.get(ids.coverage, r)
    const cov = covData ? (() => { const raw = inflateSync(covData); return new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)) })() : null
    const list: Junction[] = []
    for (const [key, x] of acc) {
      const reads = x.f + x.r
      if (reads < MIN_READS) continue
      const side = key[0] === 'L' ? 'left' : 'right'
      const pos = Number(key.slice(1))
      // Depth beside the junction, on the aligned side.
      const at = side === 'left' ? pos : Math.max(0, pos - 1)
      const depth = Math.max(reads, cov ? cov[Math.min(at, cov.length - 1)] ?? 0 : reads)
      if (reads < depth * MIN_SHARE) continue
      list.push({ pos, side, reads, forward: x.f, reverse: x.r, depth, clipped: clipConsensus(x.seqs), partner: null })
    }
    list.sort((a, b) => b.reads - a.reads)
    const kept = list.slice(0, MAX_JUNCTIONS)
    for (const j of kept) j.partner = findPartner(j, bases)
    kept.sort((a, b) => a.pos - b.pos)
    count += kept.length
    await o.storage.put(ids.junctions, r, encodeJunctions(kept))
  }
  return { junctions: count }
}
