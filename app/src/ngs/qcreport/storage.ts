/**
 * A read set's quality report is stored beside its reads, in the read chunk
 * store, under `<read set id>-qc`. It is kept when the reads are discarded
 * (their key range is `<id>:`), and removed with the read set when stray
 * chunks are cleaned up at load (persistence.ts lists it as the read set's).
 */

import { deflateSync, inflateSync } from 'fflate'
import { QC_REPORT_VERSION, type QcReport } from './types'

export const qcStorageId = (readSetId: string) => `${readSetId}-qc`

export function encodeQcReport(r: QcReport): Uint8Array {
  return deflateSync(new TextEncoder().encode(JSON.stringify(r)))
}

/** A stored report, or null when it is missing, damaged or of an older version. */
export function decodeQcReport(data: Uint8Array | undefined): QcReport | null {
  if (!data) return null
  try {
    const r = JSON.parse(new TextDecoder().decode(inflateSync(data))) as QcReport
    return r && r.version === QC_REPORT_VERSION && Array.isArray(r.mates) ? r : null
  } catch {
    return null
  }
}

