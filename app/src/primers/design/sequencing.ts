/**
 * Sequencing primers tiled across a region.
 *
 * Sanger reads start some way past the primer (the first ~30–50 bases are
 * unreadable) and are good for a few hundred more, so primers are placed so
 * that consecutive reads overlap. Each primer is the best candidate in a
 * short window before where its read should start, and it must bind the
 * template exactly once: a sequencing primer with a second site gives a
 * mixed read.
 */

import { reverseComplement } from '../../models/complement'
import { scorePrimer, type PrimerConstraints } from '../scoring'
import { findBindingSites } from '../binding'
import type { Region } from './types'

export interface SequencingOptions {
  /** Usable read length, bases. */
  readLength: number
  /** Overlap between consecutive reads, bases. */
  overlap: number
  /** Bases between the primer's 3' end and the first good base of its read. */
  lead: number
  strands: 'forward' | 'reverse' | 'both'
}

export const DEFAULT_SEQUENCING: SequencingOptions = { readLength: 700, overlap: 100, lead: 50, strands: 'both' }

export interface SequencingPrimer {
  strand: 1 | -1
  sequence: string
  /** Annealed span on the template. */
  start: number
  end: number
  tm: number
  penalty: number
  /** The read this primer should give, template coordinates (clamped). */
  read: Region
}

export interface SequencingPlan {
  primers: SequencingPrimer[]
  /** Region bases no read covers. */
  gaps: Region[]
  warnings: string[]
}

/** Window in which a primer's 3' end is searched, before the ideal spot. */
const WINDOW = 60

export function tileSequencingPrimers(
  template: string,
  topology: 'linear' | 'circular',
  region: Region,
  c: PrimerConstraints,
  opts: SequencingOptions = DEFAULT_SEQUENCING,
): SequencingPlan | { error: string } {
  const n = template.length
  const T = template.toUpperCase()
  const circular = topology === 'circular'
  const regionEnd = region.start < region.end ? region.end : region.end + (circular ? n : 0)
  if (regionEnd <= region.start) return { error: 'Select the region to sequence.' }
  const step = opts.readLength - opts.overlap
  if (step <= 0) return { error: 'The overlap must be shorter than the read.' }

  const at = (p: number) => (circular ? T[((p % n) + n) % n] : T[p])
  const read = (from: number, to: number) => {
    if (!circular && (from < 0 || to > n)) return null
    let s = ''
    for (let p = from; p < to; p++) s += at(p)
    return s
  }

  const warnings: string[] = []
  const primers: SequencingPrimer[] = []

  /** Best primer whose 3' end lies within WINDOW bases short of `ideal3`. */
  const pick = (ideal3: number, strand: 1 | -1): SequencingPrimer | null => {
    let best: SequencingPrimer | null = null
    for (let shift = 0; shift <= WINDOW; shift++) {
      // Forward: 3' end at ideal3 - shift, reading rightwards.
      // Reverse: 3' end at ideal3 + shift, reading leftwards.
      const end3 = strand === 1 ? ideal3 - shift : ideal3 + shift
      for (let len = c.minLength; len <= c.maxLength; len++) {
        const from = strand === 1 ? end3 - len : end3
        const raw = read(from, from + len)
        if (!raw || !/^[ACGT]+$/.test(raw)) continue
        const oligo = strand === 1 ? raw : reverseComplement(raw)
        const scored = scorePrimer(oligo, 0, strand, c)
        if (!scored.ok) continue
        // Being close to the ideal spot is worth a little, not everything.
        const penalty = scored.penalty + shift * 0.02
        if (best && penalty >= best.penalty) continue
        const sites = findBindingSites([{ id: 'x', name: 'x', sequence: oligo, role: 'primer' }], template, topology).get('x') ?? []
        if (sites.length !== 1) continue
        const readStart = strand === 1 ? end3 + opts.lead : end3 - opts.lead - opts.readLength
        const readFrom = Math.max(region.start, readStart)
        const readTo = Math.min(regionEnd, readStart + opts.readLength)
        best = {
          strand, sequence: oligo, tm: scored.tm, penalty,
          start: ((from % n) + n) % n, end: ((from + len) % n) || n,
          read: { start: readFrom, end: readTo },
        }
      }
    }
    return best
  }

  if (opts.strands !== 'reverse') {
    for (let readStart = region.start; readStart < regionEnd; readStart += step) {
      const p = pick(readStart - opts.lead, 1)
      if (p) primers.push(p)
      else warnings.push(`No unique forward primer found for the read starting near ${(readStart % n) + 1}.`)
    }
  }
  if (opts.strands !== 'forward') {
    for (let readEnd = regionEnd; readEnd > region.start; readEnd -= step) {
      const p = pick(readEnd + opts.lead, -1)
      if (p) primers.push(p)
      else warnings.push(`No unique reverse primer found for the read ending near ${(readEnd % n) || n}.`)
    }
  }

  // Coverage: what the planned reads leave uncovered.
  const covered = primers.map(p => p.read).sort((a, b) => a.start - b.start)
  const gaps: Region[] = []
  let pos = region.start
  for (const r of covered) {
    if (r.start > pos) gaps.push({ start: pos, end: r.start })
    pos = Math.max(pos, r.end)
  }
  if (pos < regionEnd) gaps.push({ start: pos, end: regionEnd })

  return { primers, gaps, warnings }
}
