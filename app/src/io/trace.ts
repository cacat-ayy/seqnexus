/**
 * What a Sanger trace file holds once read, whatever the file format.
 *
 * The four channels are kept as plain number arrays so the object survives
 * JSON session export as well as IndexedDB. Sanger traces are small (a few
 * thousand samples); this is not the storage model for NGS reads.
 */

export type TraceBase = 'A' | 'C' | 'G' | 'T'

export const TRACE_BASES: readonly TraceBase[] = ['A', 'C', 'G', 'T']

export interface TraceMetadata {
  /** Source format. Absent on reads saved before it was recorded. */
  format?: 'ab1' | 'scf'
  /** Sample name written by the instrument (the read itself is named after the file). */
  sampleName?: string
  /** Plate well, e.g. "B9". */
  well?: string
  /** Capillary or lane number. */
  lane?: number
  plateName?: string
  /** Instrument model, e.g. "3730xl". */
  instrument?: string
  /** The individual machine's name or serial. */
  machineName?: string
  runName?: string
  runModule?: string
  runStartDate?: string
  runStartTime?: string
  runEndDate?: string
  runEndTime?: string
  dyeSet?: string
  polymer?: string
  mobilityFile?: string
  /** Base caller and its version, e.g. "KB 1.2". */
  basecaller?: string
  /** Data collection software version. */
  dataCollection?: string
  /** Average signal intensity per channel, as reported by the instrument. */
  signal?: Record<TraceBase, number>
  /** Baseline noise per channel. */
  noise?: Record<TraceBase, number>
  /** Average peak spacing in samples. */
  averageSpacing?: number
  owner?: string
  comment?: string
  /** The file carries no quality values; every score is 0. */
  qualityMissing?: boolean
}

export interface TraceData {
  name: string
  bases: string
  /** Trace sample index of each called base. Same length as `bases`. */
  peakLocations: number[]
  /** Phred quality of each called base. Same length as `bases`. */
  qualityScores: number[]
  traces: Record<TraceBase, number[]>
  metadata: TraceMetadata
  /**
   * The base caller's own calls, kept when the file also carries edited
   * calls that differ from them (ABIF PBAS.1 vs PBAS.2). Absent otherwise.
   */
  originalCalls?: {
    bases: string
    peakLocations: number[]
    qualityScores: number[]
  }
}

/** Number of trace samples (the longest channel). */
export function traceLength(data: TraceData): number {
  const t = data.traces
  return Math.max(t.A.length, t.C.length, t.G.length, t.T.length)
}

/**
 * Bring calls, peaks and qualities to one length. Files from some tools
 * disagree by a base or two; everything downstream indexes them in lockstep.
 */
export function alignCallArrays(
  bases: string,
  peaks: number[],
  quality: number[] | undefined,
): { bases: string; peakLocations: number[]; qualityScores: number[]; qualityMissing: boolean } {
  const n = Math.min(bases.length, peaks.length > 0 ? peaks.length : bases.length)
  const peakLocations = new Array<number>(n)
  for (let i = 0; i < n; i++) peakLocations[i] = Math.max(0, peaks[i] ?? 0)
  // Old ABI base callers write a PCON block of zeros: no quality, not Q0.
  const qualityMissing = !quality || quality.length === 0 || quality.every(q => q === 0)
  const qualityScores = new Array<number>(n)
  for (let i = 0; i < n; i++) qualityScores[i] = Math.max(0, Math.min(99, quality?.[i] ?? 0))
  return { bases: bases.slice(0, n), peakLocations, qualityScores, qualityMissing }
}

/** One line naming the run: instrument, well, capillary, date. */
export function runLine(data: TraceData): string | null {
  const m = data.metadata
  const parts: string[] = []
  if (m.instrument) parts.push(m.instrument)
  if (m.well) parts.push(`well ${m.well}`)
  if (m.lane !== undefined) parts.push(`capillary ${m.lane}`)
  if (m.runStartDate) parts.push(m.runStartDate)
  return parts.length > 0 ? parts.join(' · ') : null
}
