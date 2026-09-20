/**
 * Main-thread API for the streaming GenBank parser Web Worker.
 *
 * For large files (>1MB), parses in a worker using File.stream() to avoid
 * blocking the UI. Falls back to the synchronous parser for small files
 * or when workers are unavailable.
 */

import { Sequence, type Topology } from '../models/Sequence'
import { Annotation, type AnnotationData } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { parseGenBankMulti } from '../io/genbank'
import type {
  GenbankParserRequest,
  GenbankParserMessage,
  GenbankParserResult,
} from './genbank-parser.worker'

/** Threshold in bytes above which we use the streaming worker. */
const STREAMING_THRESHOLD = 1024 * 1024 // 1 MB

export interface ParseProgress {
  bytesRead: number
  totalBytes: number
}

/**
 * Parse a GenBank file, using a streaming Web Worker for large files.
 * Returns an array of DocumentState (one per record in the file).
 *
 * @param file        The File to parse.
 * @param onProgress  Optional callback for progress updates (large files only).
 * @returns           Array of DocumentState ready to open.
 */
export function parseGenbankFile(
  file: File,
  onProgress?: (p: ParseProgress) => void,
): Promise<DocumentState[]> {
  // Small files: read as text and use the multi-record parser
  if (file.size < STREAMING_THRESHOLD) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          resolve(parseGenBankMulti(reader.result as string))
        } catch (err) {
          reject(err)
        }
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsText(file)
    })
  }

  // Large files: stream in a worker
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(
        new URL('./genbank-parser.worker.ts', import.meta.url),
        { type: 'module' },
      )
    } catch {
      // Worker unavailable - fall back to sync on main thread
      const reader = new FileReader()
      reader.onload = () => {
        try {
          resolve(parseGenBankMulti(reader.result as string))
        } catch (err) {
          reject(err)
        }
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsText(file)
      return
    }

    worker.onmessage = (e: MessageEvent<GenbankParserMessage>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        onProgress?.({ bytesRead: msg.bytesRead, totalBytes: msg.totalBytes })
      } else if (msg.type === 'done') {
        resolve([rehydrate(msg)])
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

/**
 * Convert the worker's plain-object result into a full DocumentState
 * with Sequence and Annotation class instances.
 */
function rehydrate(result: GenbankParserResult): DocumentState {
  return {
    name: result.name,
    sequence: new Sequence(result.bases, result.topology as Topology),
    annotations: result.annotations.map(a => new Annotation(a as AnnotationData)),
  }
}
