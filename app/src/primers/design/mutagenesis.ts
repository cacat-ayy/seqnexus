/**
 * Site-directed mutagenesis primers.
 *
 * An edit replaces the bases in `at` with `replacement`: a substitution when
 * both are non-empty, an insertion when `at` is empty, a deletion when the
 * replacement is. Two designs:
 *
 * - Back-to-back (Q5 SDM / KLD style). The primers face away from each
 *   other and meet at the edit, and the whole plasmid is amplified and
 *   ligated. Here the new bases ride on the 5' end of the forward primer as
 *   a tail, which is always valid; NEB's own tool centres short
 *   substitutions in the forward primer instead.
 * - Overlapping (QuikChange style). One primer carries the edit in its
 *   middle with template on both sides; the reverse is its exact reverse
 *   complement. Sized with the QuikChange Tm rule from the Agilent manual:
 *   Tm = 81.5 + 0.41·%GC − 675/N − %mismatch (the mismatch term dropped for
 *   insertions and deletions, where N excludes the edited bases), aiming for
 *   Tm ≥ 78 °C with 10–15 template bases each side and 25–45 nt overall.
 */

import { reverseComplement } from '../../models/complement'
import type { PrimerConstraints } from '../scoring'
import { bindingPart } from './cloning'
import type { Region } from './types'

export type MutagenesisMethod = 'back-to-back' | 'overlapping'

export interface MutationRequest {
  template: string
  topology: 'linear' | 'circular'
  at: Region
  replacement: string
  method: MutagenesisMethod
  constraints: PrimerConstraints
}

export interface MutagenesisDesign {
  forward: string
  reverse: string
  /** What the edit does, in words. */
  summary: string
  /** Tm the method is judged by (binding part, or QuikChange rule). */
  tmForward: number
  tmReverse: number
  warnings: string[]
}

const base = (t: string, p: number, circular: boolean) => {
  const n = t.length
  return circular ? t[((p % n) + n) % n] : t[p]
}

function read(t: string, from: number, to: number, circular: boolean): string | null {
  if (!circular && (from < 0 || to > t.length)) return null
  let s = ''
  for (let p = from; p < to; p++) s += base(t, p, circular)
  return s.toUpperCase()
}

export function describeEdit(at: Region, replacement: string, template: string): string {
  const removed = template.slice(at.start, at.end).toUpperCase()
  const add = replacement.toUpperCase()
  if (!removed && add) return `Insert ${add} after position ${at.start}`
  if (removed && !add) return `Delete ${removed} (${at.start + 1}..${at.end})`
  return `Replace ${removed} (${at.start + 1}..${at.end}) with ${add}`
}

/** QuikChange rule-of-thumb Tm for a mutagenic primer. */
export function quikChangeTm(primer: string, mismatches: number, indel: boolean): number {
  const s = primer.toUpperCase()
  const gc = (s.match(/[GC]/g)?.length ?? 0) / s.length * 100
  const n = s.length
  return 81.5 + 0.41 * gc - 675 / n - (indel ? 0 : (mismatches / n) * 100)
}

export function designMutagenesis(req: MutationRequest): MutagenesisDesign | { error: string } {
  const { template, topology, at, method, constraints } = req
  const replacement = req.replacement.toUpperCase().replace(/[^ACGT]/g, '')
  const circular = topology === 'circular'
  if (at.start > at.end) return { error: 'Select the bases to change without crossing the origin.' }
  if (at.start === at.end && !replacement) return { error: 'Type the bases to insert, or select bases to replace or delete.' }
  const removed = template.slice(at.start, at.end).toUpperCase()
  if (removed === replacement) return { error: 'The replacement is the same as the bases already there.' }
  const summary = describeEdit(at, replacement, template)
  const warnings: string[] = []
  if (!circular) warnings.push('Mutagenesis amplifies the whole plasmid; this sequence is linear.')

  if (method === 'back-to-back') {
    const f = bindingPart(template, circular, at.end, 1, constraints)
    const r = bindingPart(template, circular, at.start, -1, constraints)
    if (!f || !r) return { error: 'No binding part fits next to the edit.' }
    if (!f.inRange || !r.inRange) warnings.push('A binding part could not reach the Tm range within the length limits.')
    if (replacement.length > 30) warnings.push('Long insertions are usually split between both primers\' 5′ ends.')
    return {
      forward: replacement + f.anneal,
      reverse: r.anneal,
      summary,
      tmForward: f.tm,
      tmReverse: r.tm,
      warnings,
    }
  }

  // Overlapping: grow the flanks equally until the QuikChange Tm is met.
  const indel = removed.length !== replacement.length
  const mismatches = indel ? 0 : [...removed].filter((b, i) => b !== replacement[i]).length
  let best: { primer: string; tm: number } | null = null
  for (let flank = 10; flank <= 25; flank++) {
    const left = read(template, at.start - flank, at.start, circular)
    const right = read(template, at.end, at.end + flank, circular)
    if (!left || !right) break
    const primer = left + replacement + right
    const tm = quikChangeTm(indel ? left + right : primer, mismatches, indel)
    best = { primer, tm }
    if (tm >= 78 && primer.length >= 25) break
  }
  if (!best) return { error: 'There is not enough sequence on both sides of the edit.' }
  if (best.tm < 78) warnings.push(`The QuikChange Tm only reaches ${best.tm.toFixed(1)} °C (78 °C recommended).`)
  if (best.primer.length > 45) warnings.push(`The primers are ${best.primer.length} nt; QuikChange recommends 25–45.`)
  return {
    forward: best.primer,
    reverse: reverseComplement(best.primer),
    summary,
    tmForward: best.tm,
    tmReverse: best.tm,
    warnings,
  }
}

/** The template with the edit applied, as the mutant would read. */
export function applyEdit(template: string, at: Region, replacement: string): string {
  return template.slice(0, at.start) + replacement.toUpperCase() + template.slice(at.end)
}
