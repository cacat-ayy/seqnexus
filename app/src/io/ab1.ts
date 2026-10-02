/**
 * ABIF (.ab1) Sanger trace parser.
 *
 * Reads the called bases (PBAS), their peak positions (PLOC) and qualities
 * (PCON), the four processed channels (DATA 9-12, ordered by FWO_) and the
 * run details an instrument records: sample, well, capillary, instrument,
 * run module, dye set, polymer, base caller, signal and noise.
 *
 * Tag number 2 holds the calls as last edited (by Sequence Scanner or the
 * base caller's own pass), number 1 the original calls. The edited set is
 * used; the original is kept alongside when the two differ.
 */

import { AbifFile } from './abif'
import { alignCallArrays, TRACE_BASES, type TraceBase, type TraceData, type TraceMetadata } from './trace'

/** Kept under its old name: most of the app still calls a trace `Ab1Data`. */
export type Ab1Data = TraceData

/**
 * Parse an ABIF (.ab1) file from an ArrayBuffer.
 * Throws on invalid/corrupt files.
 */
export function parseAb1(buffer: ArrayBuffer): Ab1Data {
  const f = new AbifFile(buffer)

  const edited = f.string('PBAS', 2)
  const original = f.string('PBAS', 1)
  const basesRaw = (edited || original)
  if (!basesRaw) throw new Error('No called bases (PBAS) found in ABIF file.')
  const callNum = edited ? 2 : 1

  const peaksRaw = f.numbers('PLOC', callNum) ?? f.numbers('PLOC', callNum === 2 ? 1 : 2)
  if (!peaksRaw) throw new Error('No peak locations (PLOC) found in ABIF file.')
  const qualityRaw = f.numbers('PCON', callNum) ?? f.numbers('PCON', callNum === 2 ? 1 : 2)

  // Channel order comes from the filter wheel order; ABI's default is GATC.
  let order = (f.string('FWO_') ?? '').toUpperCase()
  if (order.length < 4 || !TRACE_BASES.every(b => order.includes(b))) order = 'GATC'

  const processed = [9, 10, 11, 12].map(n => f.numbers('DATA', n))
  const channels = processed.every(c => c && c.length > 0)
    ? processed
    : [1, 2, 3, 4].map(n => f.numbers('DATA', n))
  const traces: Record<TraceBase, number[]> = { A: [], C: [], G: [], T: [] }
  for (let i = 0; i < 4; i++) traces[order[i] as TraceBase] = channels[i] ?? []

  const calls = alignCallArrays(basesRaw.toUpperCase(), peaksRaw, qualityRaw)

  let originalCalls: TraceData['originalCalls']
  if (edited && original && original.toUpperCase() !== calls.bases) {
    const o = alignCallArrays(original.toUpperCase(), f.numbers('PLOC', 1) ?? peaksRaw, f.numbers('PCON', 1))
    originalCalls = { bases: o.bases, peakLocations: o.peakLocations, qualityScores: o.qualityScores }
  }

  const metadata: TraceMetadata = {
    format: 'ab1',
    sampleName: f.string('SMPL') || undefined,
    well: f.string('TUBE') || undefined,
    lane: f.number('LANE'),
    plateName: f.string('CTNM') || f.string('CTID') || undefined,
    instrument: f.string('HCFG', 3) || f.string('MODL') || undefined,
    machineName: f.string('MCHN') || undefined,
    runName: f.string('RunN') || undefined,
    runModule: f.string('RMdN') || f.string('MODF') || undefined,
    runStartDate: f.date('RUND', 1),
    runStartTime: f.time('RUNT', 1),
    runEndDate: f.date('RUND', 2),
    runEndTime: f.time('RUNT', 2),
    dyeSet: f.string('DySN') || undefined,
    polymer: f.string('GTyp') || undefined,
    mobilityFile: f.string('PDMF', 2) || f.string('PDMF', 1) || undefined,
    basecaller: f.string('SVER', 2) || f.string('SPAC', 2) || undefined,
    dataCollection: f.string('SVER', 1) || undefined,
    signal: perChannel(f.numbers('S/N%'), order),
    noise: perChannel(f.numbers('NOIS'), order),
    averageSpacing: positive(f.number('SPAC', 3) ?? f.number('SPAC', 1)),
    owner: f.string('User') || f.string('CTOw') || undefined,
    comment: f.string('CMNT') || undefined,
    qualityMissing: calls.qualityMissing || undefined,
  }
  // Drop the keys that were not in the file, so a saved read carries only what it has.
  for (const k of Object.keys(metadata) as (keyof TraceMetadata)[]) {
    if (metadata[k] === undefined) delete metadata[k]
  }

  return {
    name: metadata.sampleName || 'Untitled',
    bases: calls.bases,
    peakLocations: calls.peakLocations,
    qualityScores: calls.qualityScores,
    traces,
    metadata,
    ...(originalCalls ? { originalCalls } : {}),
  }
}

/** Four values in channel order, keyed by base. */
function perChannel(values: number[] | undefined, order: string): Record<TraceBase, number> | undefined {
  if (!values || values.length < 4) return undefined
  const out = { A: 0, C: 0, G: 0, T: 0 }
  for (let i = 0; i < 4; i++) out[order[i] as TraceBase] = Math.round(values[i] * 10) / 10
  return out
}

function positive(n: number | undefined): number | undefined {
  return n !== undefined && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined
}

// ---------------------------------------------------------------------------
// Auto-trim
// ---------------------------------------------------------------------------

/**
 * Compute auto-trim boundaries using Mott's modified trimming algorithm.
 *
 * For each base, compute score = quality - threshold. Then find the contiguous
 * sub-array with the maximum cumulative sum (Kadane's algorithm variant).
 * This naturally trims low-quality tails while keeping the best internal region.
 *
 * Returns [trimStart, trimEnd) - 0-based, half-open.
 */
export function autoTrim(
  qualityScores: number[],
  minQuality = 20,
): [number, number] {
  const n = qualityScores.length
  if (n === 0) return [0, 0]

  // Mott's algorithm: find the sub-array with maximum cumulative sum
  // where each element is (quality - threshold)
  let bestStart = 0
  let bestEnd = 0
  let bestSum = 0
  let curStart = 0
  let curSum = 0

  for (let i = 0; i < n; i++) {
    curSum += qualityScores[i] - minQuality
    if (curSum > bestSum) {
      bestSum = curSum
      bestEnd = i + 1
      bestStart = curStart
    }
    if (curSum < 0) {
      curSum = 0
      curStart = i + 1
    }
  }

  // If no region has positive cumulative quality, return empty
  if (bestEnd <= bestStart) return [0, 0]
  return [bestStart, bestEnd]
}
