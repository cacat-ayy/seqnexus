/**
 * Primer clipping for amplicon sequencing, as ivar trim does it.
 *
 * In amplicon data every read starts with a primer: those bases come from
 * the oligo, not from the sample, so a mutation under a primer is hidden by
 * reads that copy the primer and a primer's mismatch to the sample looks
 * like a variant. Each alignment whose 5' end (its start on the forward
 * strand, its end on the reverse strand) lies inside a primer's binding
 * site has the aligned bases up to the far side of that site turned into a
 * soft clip. The bases are kept, so they still export and can be shown, but
 * they no longer count for coverage, variants or the consensus. An
 * alignment left with no aligned bases is treated as not mapped.
 *
 * The 5' end may sit up to SLACK bases outside the site, as an aligner can
 * soft-clip a base or two of a primer it does not match well.
 */

import type { SamFields } from './alignments'
import { findBindingSites } from '../primers/binding'
import type { PrimerData } from '../primers/oligo'

/** A primer's binding site on a reference: 0-based, half-open, not across the origin (one across it is given as two). */
export interface PrimerSite {
  start: number
  end: number
}

export const SLACK = 3

interface Op { n: number; op: string }

function parseCigar(cigar: string): Op[] {
  const out: Op[] = []
  let n = 0
  for (let i = 0; i < cigar.length; i++) {
    const c = cigar.charCodeAt(i)
    if (c >= 48 && c <= 57) { n = n * 10 + c - 48; continue }
    out.push({ n, op: cigar[i] })
    n = 0
  }
  return out
}

const consumesRef = (op: string) => op === 'M' || op === '=' || op === 'X' || op === 'D' || op === 'N'
const consumesQuery = (op: string) => op === 'M' || op === '=' || op === 'X' || op === 'I' || op === 'S'
const aligned = (op: string) => op === 'M' || op === '=' || op === 'X'

function join(ops: Op[]): string {
  // Merge neighbours of the same kind and drop empty ones.
  const out: Op[] = []
  for (const o of ops) {
    if (o.n <= 0) continue
    const last = out[out.length - 1]
    if (last && last.op === o.op) last.n += o.n
    else out.push({ ...o })
  }
  return out.map(o => `${o.n}${o.op}`).join('')
}

/**
 * Soft-clip what aligns before reference position `to`. Returns the new
 * CIGAR and start, or null when nothing aligned would be left.
 */
export function clipLeft(cigar: string, pos: number, to: number): { cigar: string; pos: number } | null {
  const ops = parseCigar(cigar)
  const hard = ops[0]?.op === 'H' ? ops.shift()! : null
  let clip = 0
  let p = pos
  const rest: Op[] = []
  let i = 0
  for (; i < ops.length; i++) {
    const o = ops[i]
    if (p >= to && aligned(o.op)) break
    if (o.op === 'S') { clip += o.n; continue }
    if (aligned(o.op)) {
      const take = Math.min(o.n, to - p)
      clip += take
      p += take
      if (take < o.n) { rest.push({ n: o.n - take, op: o.op }); i++; break }
    } else if (consumesRef(o.op)) p += o.n
    else if (consumesQuery(o.op)) clip += o.n
  }
  for (; i < ops.length; i++) rest.push(ops[i])
  // An insertion or deletion now at the start is part of the clip.
  while (rest.length && !aligned(rest[0].op) && rest[0].op !== 'S' && rest[0].op !== 'H') {
    const o = rest.shift()!
    if (consumesRef(o.op)) p += o.n
    else if (consumesQuery(o.op)) clip += o.n
  }
  if (!rest.some(o => aligned(o.op))) return null
  return { cigar: join([...(hard ? [hard] : []), { n: clip, op: 'S' }, ...rest]), pos: p }
}

/** Soft-clip what aligns at or after reference position `from`. Null when nothing aligned would be left. */
export function clipRight(cigar: string, pos: number, from: number): { cigar: string; pos: number } | null {
  const ops = parseCigar(cigar)
  const hard = ops[ops.length - 1]?.op === 'H' ? ops.pop()! : null
  const keep: Op[] = []
  let clip = 0
  let p = pos
  for (const o of ops) {
    if (p >= from) {
      if (consumesQuery(o.op)) clip += o.n
      continue
    }
    if (aligned(o.op)) {
      const take = Math.min(o.n, from - p)
      keep.push({ n: take, op: o.op })
      clip += o.n - take
      p += o.n
    } else {
      keep.push(o)
      if (consumesRef(o.op)) p += o.n
    }
  }
  while (keep.length && !aligned(keep[keep.length - 1].op) && keep[keep.length - 1].op !== 'S') {
    const o = keep.pop()!
    if (consumesQuery(o.op)) clip += o.n
  }
  if (!keep.some(o => aligned(o.op))) return null
  return { cigar: join([...keep, { n: clip, op: 'S' }, ...(hard ? [hard] : [])]), pos }
}

/** Reference bases a CIGAR covers. */
function span(cigar: string): number {
  let n = 0
  for (const o of parseCigar(cigar)) if (consumesRef(o.op)) n += o.n
  return n
}

/** The site, if any, that `p` falls in (allowing SLACK before or after it). Sites sorted by start. */
function siteAt(sites: readonly PrimerSite[], p: number): PrimerSite | null {
  let best: PrimerSite | null = null
  for (const s of sites) {
    if (s.start - SLACK > p) break
    if (p < s.end + SLACK && (!best || s.end - s.start > best.end - best.start)) best = s
  }
  return best
}

export type ClipResult = 'kept' | 'clipped' | 'emptied'

/**
 * Clip a record's primer at its 5' end, in place. `sites` are the primer
 * sites on its reference, sorted by start; `circularLength` is the length of a
 * circular reference, whose alignments may run past its end.
 */
export function clipPrimer(f: SamFields, sites: readonly PrimerSite[], circularLength = 0): ClipResult {
  if (f.flag & 0x4 || f.cigar === '*' || sites.length === 0) return 'kept'
  const reverse = (f.flag & 0x10) !== 0
  if (!reverse) {
    const s = siteAt(sites, f.pos)
    if (!s || s.end <= f.pos) return 'kept'
    const r = clipLeft(f.cigar, f.pos, s.end)
    if (!r) { f.flag |= 0x4; return 'emptied' }
    f.cigar = r.cigar
    f.pos = r.pos
    return 'clipped'
  }
  const end = f.pos + span(f.cigar)
  let s = siteAt(sites, end - 1)
  let shift = 0
  // The end of an alignment across a circular origin, on the reference's first bases.
  if (!s && circularLength && end - 1 >= circularLength) { s = siteAt(sites, end - 1 - circularLength); shift = circularLength }
  if (!s || s.start + shift >= end) return 'kept'
  const r = clipRight(f.cigar, f.pos, s.start + shift)
  if (!r) { f.flag |= 0x4; return 'emptied' }
  f.cigar = r.cigar
  return 'clipped'
}

/** Sites from binding sites, in annotation convention (start > end across the origin), split at the origin and sorted. */
export function primerSites(sites: readonly { start: number; end: number }[], length: number): PrimerSite[] {
  const out: PrimerSite[] = []
  for (const s of sites) {
    if (s.start <= s.end) out.push({ start: s.start, end: s.end })
    else { out.push({ start: s.start, end: length }); out.push({ start: 0, end: s.end }) }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end)
}

/**
 * Where a set of oligos binds on each reference, as clipping sites: every
 * binding site findBindingSites accepts (primers/binding.ts), on either
 * strand. Also says how many of the oligos bind anywhere.
 */
export function oligoSites(
  oligos: readonly PrimerData[],
  refs: readonly { bases: string; circular: boolean }[],
): { sites: PrimerSite[][]; bound: number; count: number } {
  const boundIds = new Set<string>()
  let count = 0
  const sites = refs.map(ref => {
    const found = findBindingSites(oligos, ref.bases, ref.circular ? 'circular' : 'linear')
    const all: { start: number; end: number }[] = []
    for (const [id, list] of found) {
      if (list.length) boundIds.add(id)
      for (const s of list) all.push({ start: s.start, end: s.end })
    }
    const out = primerSites(all, ref.bases.length)
    count += out.length
    return out
  })
  return { sites, bound: boundIds.size, count }
}
