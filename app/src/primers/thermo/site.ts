/**
 * Tm of a primer where it actually binds: against the template bases it
 * faces, not against its own perfect complement.
 *
 * Mismatches inside the annealed part are scored with the internal-mismatch
 * parameters. Where a tail leaves the template, the first tail base sits
 * opposite a template base it does not pair with; that column is scored as
 * a terminal mismatch, which is what it physically is.
 */

import type { BindingSite } from '../binding'
import { duplexTm, type Conditions } from './duplex'

const PAIR: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }

export function siteTm(
  oligo: string,
  site: BindingSite,
  template: string,
  topology: 'linear' | 'circular',
  conditions: Conditions,
): number {
  const n = template.length
  const T = template.toUpperCase()
  const O = oligo.toUpperCase()
  const at = (pos: number): string | null => {
    if (topology === 'circular') return T[((pos % n) + n) % n]
    return pos >= 0 && pos < n ? T[pos] : null
  }
  // The base on the partner strand opposite template position `pos`: the
  // bottom strand for a forward primer, the top strand itself for a reverse.
  const partner = (pos: number): string | null => {
    const b = at(pos)
    if (!b) return null
    return site.strand === 1 ? PAIR[b] ?? 'N' : b
  }
  // Template position faced by oligo index i.
  const posOf = (i: number) => {
    const offset = i - site.annealFrom
    const lastPos = site.end - 1 < site.start ? site.end - 1 + n : site.end - 1
    return site.strand === 1 ? site.start + offset : lastPos - offset
  }

  let top = O.slice(site.annealFrom, site.annealTo)
  let bot = ''
  for (let i = site.annealFrom; i < site.annealTo; i++) bot += partner(posOf(i)) ?? 'N'

  if (site.annealFrom > 0) {
    const p = partner(posOf(site.annealFrom - 1))
    if (p) { top = O[site.annealFrom - 1] + top; bot = p + bot }
  }
  if (site.annealTo < O.length) {
    const p = partner(posOf(site.annealTo))
    if (p) { top = top + O[site.annealTo]; bot = bot + p }
  }
  return duplexTm(top, bot, conditions)
}
