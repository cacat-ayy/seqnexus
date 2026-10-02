/**
 * Six-frame open reading frame finder.
 *
 * The one implementation: the worker runs it off the main thread, and the
 * main thread runs it directly when a worker can't be started.
 */

import { reverseComplement } from '../models/complement'
import { geneticCode, DEFAULT_GENETIC_CODE_ID } from '../codon/genetic-codes'

export interface ORFResult {
  start: number   // 0-based, half-open; start > end for one that crosses the origin
  end: number
  strand: 1 | -1
  frame: number   // 0, 1, or 2, counted from the start of the strand it is on
  codons: number  // number of codons, stop included
}

export interface ORFRequest {
  bases: string
  minCodons: number
  maxCodons: number       // 0 = no limit
  startCodons: string[]   // e.g. ['ATG'] or ['ATG', 'GTG', 'TTG']
  allowInterior: boolean  // if false, filter out ORFs entirely within another
  topology?: 'linear' | 'circular'
  /** NCBI translation table id; its stop codons end ORFs. Standard code when absent. */
  geneticCode?: number
}

/** Length of an ORF, across the origin if it wraps. */
function orfLength(o: ORFResult, seqLength: number): number {
  return o.end > o.start ? o.end - o.start : seqLength - o.start + o.end
}

export function findOrfs(req: ORFRequest): ORFResult[] {
  const seqLength = req.bases.length
  if (seqLength === 0) return []
  const circular = req.topology === 'circular'
  const code = geneticCode(req.geneticCode ?? DEFAULT_GENETIC_CODE_ID)
  const stops = new Set(Object.keys(code.table).filter(c => code.table[c] === '*'))
  const starts = new Set(req.startCodons.map(c => c.toUpperCase()))
  const { minCodons, maxCodons } = req

  const orfs: ORFResult[] = []
  const seen = new Set<string>()
  const upper = req.bases.toUpperCase()

  for (const strand of [1, -1] as const) {
    const seq = strand === 1 ? upper : reverseComplement(upper)
    // On a circle, reading continues past the end into the start. At most
    // one turn less a base, so no ORF can overlap itself.
    const wrapLen = circular ? Math.min(seqLength - 1, maxCodons > 0 ? maxCodons * 3 : seqLength - 1) : 0
    const scan = circular ? seq + seq.slice(0, wrapLen) : seq

    for (let frame = 0; frame < 3; frame++) {
      let orfStart = -1
      for (let i = frame; i + 2 < scan.length; i += 3) {
        const codon = scan[i] + scan[i + 1] + scan[i + 2]
        if (orfStart === -1) {
          // A start past the end is the same base as one before it, already
          // read in its own frame: starting here again would only duplicate.
          if (starts.has(codon) && i < seqLength) orfStart = i
          continue
        }
        if (!stops.has(codon)) continue
        const orfEnd = i + 3
        const codons = (orfEnd - orfStart) / 3
        if (codons >= minCodons && (maxCodons === 0 || codons <= maxCodons) && orfEnd - orfStart <= seqLength) {
          let s: number
          let e: number
          if (strand === 1) {
            s = orfStart
            e = orfEnd > seqLength ? orfEnd - seqLength : orfEnd
          } else {
            s = seqLength - orfEnd
            if (s < 0) s += seqLength
            e = seqLength - orfStart
          }
          // The same ORF can be met from more than one frame of the scan when
          // the length isn't a multiple of 3: one entry, its frame from its start.
          const key = `${s}_${e}_${strand}`
          if (!seen.has(key)) {
            seen.add(key)
            orfs.push({ start: s, end: e, strand, frame: orfStart % 3, codons })
          }
        }
        orfStart = -1
      }
    }
  }

  const result = req.allowInterior ? orfs : filterInterior(orfs, seqLength)
  return result.sort((a, b) => a.start - b.start)
}

/**
 * Remove ORFs that lie entirely within another on the same strand. Spans are
 * compared around the circle, so an ORF that crosses the origin contains, and
 * is contained, like any other.
 */
export function filterInterior(orfs: ORFResult[], seqLength: number): ORFResult[] {
  const byLength = [...orfs].sort((a, b) => orfLength(b, seqLength) - orfLength(a, seqLength))
  const kept: ORFResult[] = []
  for (const orf of byLength) {
    const len = orfLength(orf, seqLength)
    const inside = kept.some(k => {
      if (k.strand !== orf.strand) return false
      const offset = (((orf.start - k.start) % seqLength) + seqLength) % seqLength
      return offset + len <= orfLength(k, seqLength)
    })
    if (!inside) kept.push(orf)
  }
  return kept
}
