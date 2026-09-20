/**
 * Web Worker: 6-frame ORF finder.
 *
 * Scans all 6 reading frames (3 forward, 3 reverse complement) for
 * open reading frames matching the given criteria.
 *
 * Input message:  ORFRequest
 * Output message: { orfs: ORFResult[] }
 */

export interface ORFResult {
  start: number   // 0-based, half-open
  end: number
  strand: 1 | -1
  frame: number   // 0, 1, or 2
  codons: number  // number of codons (length / 3)
}

export interface ORFRequest {
  bases: string
  minCodons: number
  maxCodons: number       // 0 = no limit
  startCodons: string[]   // e.g. ['ATG'] or ['ATG', 'GTG', 'TTG']
  allowInterior: boolean  // if false, filter out ORFs entirely within another
  topology?: 'linear' | 'circular'
}

import { reverseComplement } from '../models/complement'

const STOP_CODONS = new Set(['TAA', 'TAG', 'TGA'])

function findORFs(
  seq: string,
  strand: 1 | -1,
  minCodons: number,
  maxCodons: number,
  startCodonSet: Set<string>,
  seqLength: number,
  circular: boolean = false,
): ORFResult[] {
  const orfs: ORFResult[] = []
  // For circular sequences, append the beginning to catch origin-spanning ORFs.
  // We need at most (maxCodons * 3) extra bases, or seqLength - 1 if no limit.
  const wrapLen = circular ? Math.min(seqLength - 1, maxCodons > 0 ? maxCodons * 3 : seqLength - 1) : 0
  const scanSeq = (circular ? seq + seq.slice(0, wrapLen) : seq).toUpperCase()

  const seen = new Set<string>() // deduplicate origin-spanning ORFs

  for (let frame = 0; frame < 3; frame++) {
    let orfStart = -1

    for (let i = frame; i + 2 < scanSeq.length; i += 3) {
      const codon = scanSeq[i] + scanSeq[i + 1] + scanSeq[i + 2]

      if (startCodonSet.has(codon) && orfStart === -1) {
        orfStart = i
      } else if (STOP_CODONS.has(codon) && orfStart !== -1) {
        const orfEnd = i + 3 // include stop codon
        const codons = (orfEnd - orfStart) / 3
        if (codons >= minCodons && (maxCodons === 0 || codons <= maxCodons)) {
          // Map coordinates back to the original sequence
          let s: number, e: number
          if (strand === 1) {
            s = orfStart % seqLength
            e = orfEnd % seqLength
            if (orfEnd > seqLength && e === 0) e = seqLength // full wrap = non-spanning
          } else {
            // Reverse complement: map back to forward strand
            const fwdStart = seqLength - (orfEnd % seqLength || seqLength)
            const fwdEnd = seqLength - (orfStart % seqLength)
            s = fwdStart
            e = fwdEnd
          }

          // Skip duplicates (same ORF found in the wrapped region)
          const key = `${s}_${e}_${strand}_${frame}`
          if (!seen.has(key)) {
            seen.add(key)
            orfs.push({ start: s, end: e, strand, frame, codons })
          }
        }
        orfStart = -1
      }
    }
  }

  return orfs
}

/** Remove ORFs that are entirely contained within another ORF on the same strand. */
function filterInterior(orfs: ORFResult[]): ORFResult[] {
  // Sort by start, then by descending end (largest first)
  const sorted = [...orfs].sort((a, b) => a.start - b.start || b.end - a.end)
  const result: ORFResult[] = []

  // Track the furthest end seen per strand
  const maxEnd: Record<string, number> = { '1': -1, '-1': -1 }

  for (const orf of sorted) {
    const key = String(orf.strand)
    if (orf.end <= maxEnd[key]) {
      // This ORF is entirely within a previous one on the same strand - skip
      continue
    }
    maxEnd[key] = Math.max(maxEnd[key], orf.end)
    result.push(orf)
  }

  return result
}

self.onmessage = (e: MessageEvent<ORFRequest>) => {
  const { bases, minCodons, maxCodons, startCodons, allowInterior, topology } = e.data
  const seqLength = bases.length
  const circular = topology === 'circular'
  const startCodonSet = new Set(startCodons.map(c => c.toUpperCase()))

  // Forward strand (frames 0, 1, 2)
  const forwardORFs = findORFs(bases, 1, minCodons, maxCodons, startCodonSet, seqLength, circular)

  // Reverse complement (frames 0, 1, 2)
  const rc = reverseComplement(bases)
  const reverseORFs = findORFs(rc, -1, minCodons, maxCodons, startCodonSet, seqLength, circular)

  let orfs = [...forwardORFs, ...reverseORFs]

  // Deduplicate ORFs with identical coordinates
  const seen = new Set<string>()
  orfs = orfs.filter(orf => {
    const key = `${orf.start}_${orf.end}_${orf.strand}_${orf.frame}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (!allowInterior) {
    orfs = filterInterior(orfs)
  }

  // Sort by start position
  orfs.sort((a, b) => a.start - b.start)

  self.postMessage({ orfs })
}
