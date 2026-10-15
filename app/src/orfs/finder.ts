/**
 * Six-frame open reading frame finder.
 *
 * The one implementation: the worker runs it off the main thread, and the
 * main thread runs it directly when a worker can't be started.
 *
 * Each frame is read from a stop codon to the first start codon after it
 * and on to the next stop, so an ORF is the longest one ending at its stop:
 * a start further downstream in the same frame is part of it, not an ORF of
 * its own. One ORF per stop codon is kept, which also holds on a circle,
 * where a frame's reading meets the same stop again after crossing the
 * origin. Asked for every start, each start codon opens an ORF of its own,
 * to the same stop as the longest one.
 *
 * A region scans only those bases, as a linear fragment of their own, and
 * gives the ORFs back in the sequence's coordinates.
 */

import { reverseComplement } from '../models/complement'
import { geneticCode, translateCodonWith, DEFAULT_GENETIC_CODE_ID } from '../codon/genetic-codes'

export interface ORFResult {
  start: number   // 0-based, half-open; start > end for one that crosses the origin
  end: number
  strand: 1 | -1
  frame: number   // 0, 1, or 2, counted from the start of the strand it is on
  codons: number  // codons in the ORF, its stop included when it has one
  /** Runs off the 5' end of its strand in a linear sequence: from the first whole codon, with no start codon. */
  partialStart?: boolean
  /** Runs off the 3' end of its strand in a linear sequence: no stop codon before the end. */
  partialEnd?: boolean
}

export interface ORFRequest {
  bases: string
  /** The fewest residues an ORF must encode: its codons less the stop. */
  minAminoAcids: number
  maxAminoAcids: number   // 0 = no limit
  startCodons: string[]   // e.g. ['ATG'] or ['ATG', 'GTG', 'TTG']
  allowInterior: boolean  // if false, drop ORFs nested in a longer one (filterInterior)
  topology?: 'linear' | 'circular'
  /** NCBI translation table id; its stop codons end ORFs. Standard code when absent. */
  geneticCode?: number
  /**
   * Also report ORFs cut off by the ends of a linear sequence: open from the
   * first whole codon to a stop, or from a start codon to the last whole
   * codon. A fragment, a contig or a PCR product often holds only part of a gene.
   */
  includePartial?: boolean
  /**
   * Every start codon opens an ORF of its own, ending at the same stop as
   * the longest one: a gene's alternative initiation sites. Off, one ORF per
   * stop, from the first start after the stop before it.
   */
  allStarts?: boolean
  /**
   * Scan only these bases, [start, end), read as a linear fragment whose
   * ends are the ones partial ORFs run off; start > end crosses the origin
   * of a circle. The ORFs come back in the whole sequence's coordinates.
   */
  region?: { start: number; end: number }
}

/** Residues an ORF encodes: its codons less the stop. */
export function orfAminoAcids(orf: ORFResult): number {
  return orf.partialEnd ? orf.codons : orf.codons - 1
}

/** Length of an ORF, across the origin if it wraps. */
function orfLength(o: ORFResult, seqLength: number): number {
  return o.end > o.start ? o.end - o.start : seqLength - o.start + o.end
}

export function findOrfs(req: ORFRequest): ORFResult[] {
  const { region, ...rest } = req
  const L = req.bases.length
  if (!region || L === 0) return scanOrfs(rest)
  const start = Math.min(Math.max(0, region.start), L)
  const end = Math.min(Math.max(0, region.end), L)
  if (start === end) return []
  const bases = start > end ? req.bases.slice(start) + req.bases.slice(0, end) : req.bases.slice(start, end)
  const at = (p: number) => (start + p) % L
  return scanOrfs({ ...rest, bases, topology: 'linear' }).map(o => {
    const s = at(o.start)
    // An end that reaches the end of the sequence is L, not 0.
    const e = at(o.end - 1) + 1
    // The frame is counted from the 5' end of the whole strand, not the region's.
    return { ...o, start: s, end: e, frame: (o.strand === 1 ? s : L - e) % 3 }
  }).sort((a, b) => a.start - b.start || a.strand - b.strand)
}

function scanOrfs(req: Omit<ORFRequest, 'region'>): ORFResult[] {
  const seqLength = req.bases.length
  if (seqLength === 0) return []
  const circular = req.topology === 'circular'
  const partial = !!req.includePartial && !circular
  const code = geneticCode(req.geneticCode ?? DEFAULT_GENETIC_CODE_ID)
  const starts = new Set(req.startCodons.map(c => c.toUpperCase()))
  const { minAminoAcids, maxAminoAcids } = req
  const allStarts = !!req.allStarts
  /** Whether an ORF of `codons`, `stop` included or not, encodes an allowed number of residues. */
  const sizeOk = (codons: number, stop: boolean) => {
    const aa = stop ? codons - 1 : codons
    return aa >= minAminoAcids && (maxAminoAcids === 0 || aa <= maxAminoAcids)
  }

  /** The longest ORF ending at each stop, keyed by strand and the stop's place (and the start's, for every start). */
  const byStop = new Map<string, ORFResult>()
  const orfs: ORFResult[] = []
  const upper = req.bases.toUpperCase()

  for (const strand of [1, -1] as const) {
    const seq = strand === 1 ? upper : reverseComplement(upper)
    // On a circle, reading continues past the end into the start. At most
    // one turn less a base, so no ORF can overlap itself.
    const wrapLen = circular ? Math.min(seqLength - 1, maxAminoAcids > 0 ? (maxAminoAcids + 1) * 3 : seqLength - 1) : 0
    const scan = circular ? seq + seq.slice(0, wrapLen) : seq
    /** Strand coordinates [from, to) to the sequence's, across the origin on a circle. */
    const place = (from: number, to: number): [number, number] => {
      if (strand === 1) return [from, to > seqLength ? to - seqLength : to]
      let s = seqLength - to
      if (s < 0) s += seqLength
      return [s, seqLength - from]
    }

    for (let frame = 0; frame < 3; frame++) {
      // The starts open in this frame since its last stop, in order: only the
      // first unless every start is asked for. A partial ORF is open from the
      // first whole codon of a linear sequence.
      let opens: number[] = partial ? [frame] : []
      // The first is partial only when it does not begin on a start codon itself.
      let openAtStart = partial && !starts.has(scan.slice(frame, frame + 3))
      let i = frame
      for (; i + 2 < scan.length; i += 3) {
        const codon = scan[i] + scan[i + 1] + scan[i + 2]
        // A start past the end is the same base as one before it, already
        // read in its own frame: starting here again would only duplicate.
        if (starts.has(codon) && i < seqLength) {
          if (opens.length === 0 || (allStarts && opens[opens.length - 1] !== i)) opens.push(i)
          continue
        }
        if (opens.length === 0) continue
        // An ambiguous codon ends an ORF when every reading of it is a stop (TAR, TRA).
        if ((code.table[codon] ?? translateCodonWith(code, codon)) !== '*') continue
        const orfEnd = i + 3
        opens.forEach((orfStart, k) => {
          const codons = (orfEnd - orfStart) / 3
          const open = openAtStart && k === 0
          // A partial ORF must hold more than the stop that ends it.
          if (!sizeOk(codons, true) || orfEnd - orfStart > seqLength || (open && codons < 2)) return
          const [s, e] = place(orfStart, orfEnd)
          const stopKey = `${strand}:${strand === 1 ? e : s}`
          const key = allStarts ? `${stopKey}:${strand === 1 ? s : e}` : stopKey
          const orf: ORFResult = { start: s, end: e, strand, frame: orfStart % 3, codons, ...(open ? { partialStart: true } : {}) }
          const held = byStop.get(key)
          if (!held || held.codons < codons) byStop.set(key, orf)
        })
        opens = []
        openAtStart = false
      }
      // Open to the end of a linear sequence: the rest of the frame, in whole codons.
      if (partial) {
        opens.forEach((orfStart, k) => {
          if (i <= orfStart) return
          const codons = (i - orfStart) / 3
          if (!sizeOk(codons, false)) return
          const [s, e] = place(orfStart, i)
          orfs.push({ start: s, end: e, strand, frame: orfStart % 3, codons, ...(openAtStart && k === 0 ? { partialStart: true } : {}), partialEnd: true })
        })
      }
    }
  }

  orfs.push(...byStop.values())
  const result = req.allowInterior ? orfs : filterInterior(orfs, seqLength)
  return result.sort((a, b) => a.start - b.start || a.strand - b.strand)
}

/**
 * Remove ORFs that lie entirely within a longer one, in any frame and on
 * either strand, as NCBI ORFfinder's "Ignore nested ORFs" does. Within one
 * frame there is nothing to remove: the scan keeps only the longest ORF to
 * each stop. Spans are compared around the circle, so an ORF that crosses
 * the origin contains, and is contained, like any other.
 */
export function filterInterior(orfs: ORFResult[], seqLength: number): ORFResult[] {
  const byLength = [...orfs].sort((a, b) => orfLength(b, seqLength) - orfLength(a, seqLength))
  const kept: ORFResult[] = []
  for (const orf of byLength) {
    const len = orfLength(orf, seqLength)
    const inside = kept.some(k => {
      const offset = (((orf.start - k.start) % seqLength) + seqLength) % seqLength
      return offset + len <= orfLength(k, seqLength)
    })
    if (!inside) kept.push(orf)
  }
  return kept
}
