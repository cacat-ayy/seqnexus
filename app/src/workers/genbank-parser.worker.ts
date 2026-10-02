/**
 * Web Worker: streaming GenBank parser.
 *
 * Reads a File in chunks via stream() and feeds it line by line to the same
 * reader the main thread uses (io/genbank.ts), posting progress as it goes.
 * One reader means a file reads the same whatever its size: every record,
 * the description, primers and feature locations included.
 */

import { GenBankReader, type GenBankRecord } from '../io/genbank'

export interface GenbankParserRequest {
  file: File
}

export interface GenbankParserProgress {
  type: 'progress'
  /** Bytes read so far. */
  bytesRead: number
  /** Total file size in bytes. */
  totalBytes: number
}

export interface GenbankParserResult {
  type: 'done'
  records: GenBankRecord[]
}

export interface GenbankParserError {
  type: 'error'
  message: string
}

export type GenbankParserMessage = GenbankParserProgress | GenbankParserResult | GenbankParserError

/** Report progress at most every 512 KB. */
const PROGRESS_INTERVAL = 512 * 1024

self.onmessage = async (e: MessageEvent<GenbankParserRequest>) => {
  const { file } = e.data
  const totalBytes = file.size

  try {
    const reader = new GenBankReader()
    const stream = file.stream().getReader()
    const decoder = new TextDecoder()
    let bytesRead = 0
    let lastProgress = 0
    let leftover = ''

    while (true) {
      const { done, value } = await stream.read()
      if (done) break

      bytesRead += value.byteLength
      const lines = (leftover + decoder.decode(value, { stream: true })).split(/\r?\n/)
      // Last element is incomplete - save for next chunk
      leftover = lines.pop()!
      for (const line of lines) reader.line(line)

      if (bytesRead - lastProgress >= PROGRESS_INTERVAL) {
        lastProgress = bytesRead
        const msg: GenbankParserProgress = { type: 'progress', bytesRead, totalBytes }
        self.postMessage(msg)
      }
    }
    leftover += decoder.decode()
    if (leftover) reader.line(leftover)

    const result: GenbankParserResult = { type: 'done', records: reader.finish() }
    self.postMessage(result)
  } catch (err) {
    const msg: GenbankParserError = {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(msg)
  }
}
