/**
 * Main-thread API for the streaming GenBank parser Web Worker.
 *
 * For large files (>1MB), parses in a worker using File.stream() to avoid
 * blocking the UI. Falls back to the synchronous parser for small files
 * or when workers are unavailable. Both paths use the same reader, so the
 * result doesn't depend on the file's size.
 */

import type { DocumentState } from '../models/Document'
import { readGenBankRecords, toDocument, type GenBankRecord } from '../io/genbank'
import type { GenbankParserRequest, GenbankParserMessage } from './genbank-parser.worker'

/** Threshold in bytes above which we use the streaming worker. */
const STREAMING_THRESHOLD = 1024 * 1024 // 1 MB

export interface ParseProgress {
  bytesRead: number
  totalBytes: number
}

export interface ParsedGenBankFile {
  /** One per record in the file. */
  docs: DocumentState[]
  /** Features that could not be read as written, for the user. */
  warnings: string[]
}

/**
 * Parse a GenBank file, using a streaming Web Worker for large files.
 *
 * @param file        The File to parse.
 * @param onProgress  Optional callback for progress updates (large files only).
 */
export function parseGenbankFile(
  file: File,
  onProgress?: (p: ParseProgress) => void,
): Promise<ParsedGenBankFile> {
  if (file.size < STREAMING_THRESHOLD) return parseOnMainThread(file)

  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(
        new URL('./genbank-parser.worker.ts', import.meta.url),
        { type: 'module' },
      )
    } catch {
      // Worker unavailable - fall back to sync on main thread
      parseOnMainThread(file).then(resolve, reject)
      return
    }

    worker.onmessage = (e: MessageEvent<GenbankParserMessage>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        onProgress?.({ bytesRead: msg.bytesRead, totalBytes: msg.totalBytes })
      } else if (msg.type === 'done') {
        resolve(fromRecords(msg.records))
        worker.terminate()
      } else if (msg.type === 'error') {
        reject(new Error(msg.message))
        worker.terminate()
      }
    }

    worker.onerror = (err) => {
      reject(err)
      worker.terminate()
    }

    const request: GenbankParserRequest = { file }
    worker.postMessage(request)
  })
}

function parseOnMainThread(file: File): Promise<ParsedGenBankFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        resolve(fromRecords(readGenBankRecords(reader.result as string)))
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

function fromRecords(records: GenBankRecord[]): ParsedGenBankFile {
  if (records.length === 0) throw new Error('No GenBank records found in the file')
  return {
    docs: records.map(toDocument),
    warnings: records.flatMap(r => r.warnings),
  }
}
