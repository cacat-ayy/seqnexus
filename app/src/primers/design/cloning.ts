/**
 * Cloning primers: a binding part that starts exactly at the insert's end,
 * sized to the Tm target, behind a 5' tail that carries whatever the cloning
 * method needs (a restriction site with padding, or a homology arm).
 *
 * Unlike PCR design there is no search for the best spot: the insert
 * boundaries are fixed by what is being cloned, so only the length of the
 * binding part is free. The Tm that matters for choosing it is the binding
 * part's, since that is all that anneals in the first cycles.
 */

import { reverseComplement } from '../../models/complement'
import { calcTm } from '../thermodynamics'
import type { PrimerConstraints } from '../scoring'
import type { Region } from './types'

export interface TailedPrimer {
  /** Full oligo 5'→3': tail then binding part. */
  sequence: string
  tail: string
  anneal: string
  /** Tm of the binding part alone. */
  tm: number
}

export interface TailedPair {
  forward: TailedPrimer
  reverse: TailedPrimer
  warnings: string[]
}

function slice(template: string, from: number, to: number, circular: boolean): string | null {
  const n = template.length
  if (!circular) return from >= 0 && to <= n && from < to ? template.slice(from, to) : null
  let s = ''
  for (let p = from; p < to; p++) s += template[((p % n) + n) % n]
  return s
}

const tmOf = (s: string, c: PrimerConstraints) =>
  calcTm(s, { primerConc: c.primerConc, naConc: c.naConc, mgConc: c.mgConc, dntpConc: c.dntpConc })

/**
 * Binding part of a given length range read from `at` outwards: rightwards
 * for a forward primer, leftwards (reverse-complemented) for a reverse one.
 * Picks the length whose Tm is closest to the optimum inside the range,
 * with a 3' G/C as the tie-breaker.
 */
export function bindingPart(
  template: string,
  circular: boolean,
  at: number,
  strand: 1 | -1,
  c: PrimerConstraints,
): { anneal: string; tm: number; inRange: boolean } | null {
  let best: { anneal: string; tm: number; score: number; inRange: boolean } | null = null
  for (let len = c.minLength; len <= c.maxLength; len++) {
    const raw = strand === 1 ? slice(template, at, at + len, circular) : slice(template, at - len, at, circular)
    if (!raw || !/^[ACGT]+$/i.test(raw)) continue
    const anneal = (strand === 1 ? raw : reverseComplement(raw)).toUpperCase()
    const tm = tmOf(anneal, c)
    const inRange = tm >= c.minTm && tm <= c.maxTm
    const clamp = /[GC]$/.test(anneal) ? 0 : 0.5
    // Anything in range beats anything out of it.
    const score = Math.abs(tm - c.optTm) + clamp + (inRange ? 0 : 100)
    if (!best || score < best.score) best = { anneal, tm, score, inRange }
  }
  return best ? { anneal: best.anneal, tm: best.tm, inRange: best.inRange } : null
}

/**
 * Forward and reverse primers for an insert, each with a tail. `revTail` is
 * written 5'→3' as it appears on the reverse primer.
 */
export function designTailedPair(
  template: string,
  topology: 'linear' | 'circular',
  insert: Region,
  fwdTail: string,
  revTail: string,
  c: PrimerConstraints,
): TailedPair | { error: string } {
  const circular = topology === 'circular'
  const end = insert.start < insert.end ? insert.end : insert.end + (circular ? template.length : 0)
  if (end <= insert.start) return { error: 'Select the insert to amplify.' }
  const f = bindingPart(template, circular, insert.start, 1, c)
  const r = bindingPart(template, circular, end, -1, c)
  if (!f) return { error: 'No forward binding part fits at the start of the insert.' }
  if (!r) return { error: 'No reverse binding part fits at the end of the insert.' }
  const warnings: string[] = []
  if (!f.inRange) warnings.push(`The forward binding part only reaches ${f.tm.toFixed(1)} °C within ${c.minLength}–${c.maxLength} nt.`)
  if (!r.inRange) warnings.push(`The reverse binding part only reaches ${r.tm.toFixed(1)} °C within ${c.minLength}–${c.maxLength} nt.`)
  return {
    forward: { sequence: fwdTail + f.anneal, tail: fwdTail, anneal: f.anneal, tm: f.tm },
    reverse: { sequence: revTail + r.anneal, tail: revTail, anneal: r.anneal, tm: r.tm },
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Tails
// ---------------------------------------------------------------------------

/**
 * Restriction-site tail: padding (so the enzyme has something to hold on
 * to at the end of the product), then the recognition site. The site is
 * written as the enzyme reads it on both primers; for a palindromic site
 * that is the same thing either way round.
 */
export function restrictionTail(site: string, padding: string): string {
  return (padding + site).toUpperCase()
}

/** Every place a recognition site (IUPAC allowed) occurs in `seq`, either strand. */
export function findSite(seq: string, site: string): number[] {
  const re = new RegExp(iupacPattern(site), 'g')
  const rc = reverseComplement(site.toUpperCase())
  const hits = new Set<number>()
  const S = seq.toUpperCase()
  for (const pattern of rc === site.toUpperCase() ? [re] : [re, new RegExp(iupacPattern(rc), 'g')]) {
    pattern.lastIndex = 0
    for (let m = pattern.exec(S); m; m = pattern.exec(S)) {
      hits.add(m.index)
      pattern.lastIndex = m.index + 1
    }
  }
  return [...hits].sort((a, b) => a - b)
}

const IUPAC_CLASS: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', R: '[AG]', Y: '[CT]', S: '[CG]', W: '[AT]',
  K: '[GT]', M: '[AC]', B: '[CGT]', D: '[AGT]', H: '[ACT]', V: '[ACG]', N: '[ACGT]',
}

function iupacPattern(site: string): string {
  return site.toUpperCase().split('').map(b => IUPAC_CLASS[b] ?? b).join('')
}

export interface HomologyArms {
  fwdTail: string
  revTail: string
  /** The two overlaps as they read on the top strand of the construct. */
  left: string
  right: string
}

/**
 * Homology arms for seamless assembly (Gibson, In-Fusion): the insert goes
 * into the vector at `cut`, optionally replacing vector bases up to
 * `replaceTo`. The forward tail is the vector just upstream, the reverse
 * tail the reverse complement of the vector just downstream.
 */
export function homologyArms(
  vector: string,
  vectorTopology: 'linear' | 'circular',
  cut: number,
  replaceTo: number,
  arm: number,
): HomologyArms | { error: string } {
  const circular = vectorTopology === 'circular'
  const left = slice(vector, cut - arm, cut, circular)
  const right = slice(vector, replaceTo, replaceTo + arm, circular)
  if (!left) return { error: `There are fewer than ${arm} vector bases upstream of the insertion point.` }
  if (!right) return { error: `There are fewer than ${arm} vector bases downstream of the insertion point.` }
  return {
    fwdTail: left.toUpperCase(),
    revTail: reverseComplement(right).toUpperCase(),
    left: left.toUpperCase(),
    right: right.toUpperCase(),
  }
}
