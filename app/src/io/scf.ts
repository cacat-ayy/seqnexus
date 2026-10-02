/**
 * SCF (.scf) file parser for Sanger sequencing chromatograms.
 *
 * Parses the Standard Chromatogram Format (versions 2 and 3) and extracts
 * the same data as the ABIF parser: bases, peak locations, quality scores,
 * and 4-channel fluorescence traces.
 *
 * SCF v3 stores traces as delta-delta encoded uint8/uint16 values.
 * SCF v2 stores traces as raw sample values.
 *
 * Reference: Staden Package SCF specification.
 */

import type { Ab1Data } from './ab1'
import { alignCallArrays, type TraceMetadata } from './trace'

// SCF magic: ".scf" at offset 0
const SCF_MAGIC = 0x2E736366

/**
 * Parse an SCF (.scf) file from an ArrayBuffer.
 * Returns the same Ab1Data structure used by the ABIF parser.
 * Throws on invalid/corrupt files.
 */
export function parseScf(buffer: ArrayBuffer): Ab1Data {
  const view = new DataView(buffer)

  if (buffer.byteLength < 128) {
    throw new Error('File too small to be a valid SCF file.')
  }

  const magic = view.getUint32(0, false)
  if (magic !== SCF_MAGIC) {
    throw new Error('Not an SCF file - invalid magic bytes.')
  }

  // Header (128 bytes, big-endian)
  const numSamples     = view.getUint32(4, false)
  const samplesOffset  = view.getUint32(8, false)
  const numBases       = view.getUint32(12, false)
  // const leftClip    = view.getUint32(16, false) // unused
  // const rightClip   = view.getUint32(20, false) // unused
  const basesOffset    = view.getUint32(24, false)
  const commentsSize   = view.getUint32(28, false)
  const commentsOffset = view.getUint32(32, false)

  // Version string at offset 36, 4 bytes (e.g. "3.00" or "2.00")
  const versionStr = String.fromCharCode(
    view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39),
  )
  const majorVersion = parseInt(versionStr[0], 10)

  const sampleSize = view.getUint32(40, false) // 1 = uint8, 2 = uint16

  // Validate
  if (numSamples === 0 || numBases === 0) {
    throw new Error('SCF file contains no data.')
  }

  // Comments are KEY=value lines (Staden conventions: NAME, MACH, LANE, SIGN, ...)
  const comments = new Map<string, string>()
  if (commentsSize > 0 && commentsOffset + commentsSize <= buffer.byteLength) {
    const commentStr = new TextDecoder('latin1').decode(new Uint8Array(buffer, commentsOffset, commentsSize))
    for (const line of commentStr.split(/\r?\n/)) {
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim().toUpperCase()
      const val = line.slice(eq + 1).replace(/\0/g, '').trim()
      if (key && val && !comments.has(key)) comments.set(key, val)
    }
  }
  const name = comments.get('NAME') || comments.get('SAMP') || 'Untitled'

  let tracesA: number[]
  let tracesC: number[]
  let tracesG: number[]
  let tracesT: number[]

  if (majorVersion >= 3) {
    // SCF v3: traces are stored as 4 separate channels, each numSamples values,
    // delta-delta encoded. Sample size is 1 (uint8) or 2 (uint16).
    const rawA = readSamplesV3(view, buffer, samplesOffset, numSamples, sampleSize, 0)
    const rawC = readSamplesV3(view, buffer, samplesOffset, numSamples, sampleSize, 1)
    const rawG = readSamplesV3(view, buffer, samplesOffset, numSamples, sampleSize, 2)
    const rawT = readSamplesV3(view, buffer, samplesOffset, numSamples, sampleSize, 3)

    tracesA = undeltaDelta(rawA, sampleSize)
    tracesC = undeltaDelta(rawC, sampleSize)
    tracesG = undeltaDelta(rawG, sampleSize)
    tracesT = undeltaDelta(rawT, sampleSize)
  } else {
    // SCF v2: traces are interleaved as [A0,C0,G0,T0, A1,C1,G1,T1, ...]
    // Each sample is a uint32 (4 bytes) or sometimes uint16
    tracesA = []
    tracesC = []
    tracesG = []
    tracesT = []

    for (let i = 0; i < numSamples; i++) {
      // Actually v2 stores each sample point as: struct { uint8 sample_A; uint8 sample_C; uint8 sample_G; uint8 sample_T; }
      // But the actual format is 4 separate uint32 values per sample point when sampleSize=4,
      // or the samples are stored sequentially per channel.
      // Let me re-read the spec: v2 stores samples as an array of structs:
      //   struct { uint32 sample_A, sample_C, sample_G, sample_T; } samples[numSamples]
      // But with sampleSize indicating bytes per sample value.
      // Actually the v2 format stores: for each sample point, 4 values (A,C,G,T) as uint8 or uint16 or uint32.
      // The total size is numSamples * 4 * sampleSize bytes, but they're interleaved.

      // Correction: SCF v2 stores samples as 4 interleaved channels.
      // Each sample point has 4 values. The size of each value depends on sampleSize.
      // But the common case is sampleSize=2 (uint16).
      const base = samplesOffset + i * 4 * (sampleSize || 2)
      const sz = sampleSize || 2
      if (sz === 1) {
        tracesA.push(view.getUint8(base))
        tracesC.push(view.getUint8(base + 1))
        tracesG.push(view.getUint8(base + 2))
        tracesT.push(view.getUint8(base + 3))
      } else if (sz === 2) {
        tracesA.push(view.getUint16(base, false))
        tracesC.push(view.getUint16(base + 2, false))
        tracesG.push(view.getUint16(base + 4, false))
        tracesT.push(view.getUint16(base + 6, false))
      } else {
        // uint32
        tracesA.push(view.getUint32(base, false))
        tracesC.push(view.getUint32(base + 4, false))
        tracesG.push(view.getUint32(base + 8, false))
        tracesT.push(view.getUint32(base + 12, false))
      }
    }
  }

  // Parse bases
  let bases = ''
  const peakLocations: number[] = []
  const qualityScores: number[] = []

  if (majorVersion >= 3) {
    // v3 bases: stored as 4 separate arrays then peak indices then bases
    // Layout at basesOffset:
    //   uint32 peak_index[numBases]     - 4 * numBases bytes
    //   uint8  prob_A[numBases]
    //   uint8  prob_C[numBases]
    //   uint8  prob_G[numBases]
    //   uint8  prob_T[numBases]
    //   char   base[numBases]
    const peakOff = basesOffset
    const probAOff = peakOff + numBases * 4
    const probCOff = probAOff + numBases
    const probGOff = probCOff + numBases
    const probTOff = probGOff + numBases
    const baseOff = probTOff + numBases

    for (let i = 0; i < numBases; i++) {
      peakLocations.push(view.getUint32(peakOff + i * 4, false))

      const pA = view.getUint8(probAOff + i)
      const pC = view.getUint8(probCOff + i)
      const pG = view.getUint8(probGOff + i)
      const pT = view.getUint8(probTOff + i)
      const b = String.fromCharCode(view.getUint8(baseOff + i)).toUpperCase()
      qualityScores.push(calledProbability(b, pA, pC, pG, pT))
      bases += b
    }
  } else {
    // v2 bases: stored as array of structs
    // struct { uint32 peak_index; uint8 prob_A, prob_C, prob_G, prob_T; char base; uint8 spare[3]; }
    // = 12 bytes per base
    for (let i = 0; i < numBases; i++) {
      const off = basesOffset + i * 12
      peakLocations.push(view.getUint32(off, false))

      const pA = view.getUint8(off + 4)
      const pC = view.getUint8(off + 5)
      const pG = view.getUint8(off + 6)
      const pT = view.getUint8(off + 7)
      const b = String.fromCharCode(view.getUint8(off + 8)).toUpperCase()
      qualityScores.push(calledProbability(b, pA, pC, pG, pT))
      bases += b
    }
  }

  const traces = { A: tracesA, C: tracesC, G: tracesG, T: tracesT }
  const calls = alignCallArrays(bases, peakLocations, qualityScores.some(q => q > 0) ? qualityScores : undefined)

  const metadata: TraceMetadata = { format: 'scf' }
  const lane = Number.parseInt(comments.get('LANE') ?? '', 10)
  if (Number.isFinite(lane)) metadata.lane = lane
  const setText = (key: keyof TraceMetadata, ...from: string[]) => {
    for (const k of from) {
      const v = comments.get(k)
      if (v) { (metadata as Record<string, unknown>)[key] = v; return }
    }
  }
  setText('sampleName', 'NAME', 'SAMP')
  setText('machineName', 'MACH')
  setText('instrument', 'MODL')
  setText('basecaller', 'BCSW')
  setText('dyeSet', 'DYEP')
  setText('comment', 'COMM')
  const signal = parseSignal(comments.get('SIGN'))
  if (signal) metadata.signal = signal
  const spacing = Number.parseFloat(comments.get('SPAC') ?? '')
  if (Number.isFinite(spacing) && spacing > 0) metadata.averageSpacing = spacing
  const date = /^(\d{4})(\d{2})(\d{2})/.exec(comments.get('RUND') ?? comments.get('DATE') ?? '')
  if (date) metadata.runStartDate = `${date[1]}-${date[2]}-${date[3]}`
  if (calls.qualityMissing) metadata.qualityMissing = true

  return {
    name,
    bases: calls.bases,
    peakLocations: calls.peakLocations,
    qualityScores: calls.qualityScores,
    traces,
    metadata,
  }
}

/** SCF stores a probability per channel; the call's quality is its own channel's. */
function calledProbability(base: string, pA: number, pC: number, pG: number, pT: number): number {
  switch (base) {
    case 'A': return pA
    case 'C': return pC
    case 'G': return pG
    case 'T': return pT
    default: return Math.max(pA, pC, pG, pT)
  }
}

/** "A=123,C=98,G=110,T=87" */
function parseSignal(text: string | undefined): TraceMetadata['signal'] {
  if (!text) return undefined
  const out = { A: NaN, C: NaN, G: NaN, T: NaN }
  for (const m of text.matchAll(/([ACGT])\s*=\s*([\d.]+)/gi)) {
    out[m[1].toUpperCase() as 'A'] = Number.parseFloat(m[2])
  }
  return Object.values(out).every(Number.isFinite) ? out : undefined
}

/**
 * Read raw sample values for one channel in SCF v3 format.
 * v3 stores channels sequentially: all A samples, then all C, then G, then T.
 */
function readSamplesV3(
  view: DataView,
  buffer: ArrayBuffer,
  samplesOffset: number,
  numSamples: number,
  sampleSize: number,
  channelIndex: number,
): number[] {
  const sz = sampleSize || 2
  const channelOffset = samplesOffset + channelIndex * numSamples * sz
  const arr: number[] = []

  for (let i = 0; i < numSamples; i++) {
    const off = channelOffset + i * sz
    if (off + sz > buffer.byteLength) break
    if (sz === 1) {
      arr.push(view.getUint8(off))
    } else {
      arr.push(view.getUint16(off, false))
    }
  }
  return arr
}

/**
 * Undo delta-delta encoding used in SCF v3.
 * Two passes of cumulative sum to recover original values.
 */
function undeltaDelta(data: number[], sampleSize: number): number[] {
  const n = data.length
  if (n === 0) return []

  const maxVal = sampleSize === 1 ? 256 : 65536
  const result = new Array<number>(n)

  // First pass: undo first delta
  result[0] = data[0]
  for (let i = 1; i < n; i++) {
    result[i] = (result[i - 1] + data[i]) % maxVal
  }

  // Second pass: undo second delta
  for (let i = 1; i < n; i++) {
    result[i] = (result[i - 1] + result[i]) % maxVal
  }

  return result
}
