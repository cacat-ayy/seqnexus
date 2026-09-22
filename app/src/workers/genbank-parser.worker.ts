/**
 * Web Worker: streaming GenBank parser.
 *
 * Reads a File in chunks via stream(), parses incrementally with a line-based
 * state machine, and posts progress updates back to the main thread.
 * Avoids loading the entire file into memory as a single string.
 */

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

export interface GenbankAnnotation {
  id: string
  name: string
  type: string
  start: number
  end: number
  strand: 1 | -1 | 0
  color?: string
  qualifiers: Record<string, string[]>
}

export interface GenbankParserResult {
  type: 'done'
  name: string
  topology: 'linear' | 'circular'
  bases: string
  annotations: GenbankAnnotation[]
}

export interface GenbankParserError {
  type: 'error'
  message: string
}

export type GenbankParserMessage = GenbankParserProgress | GenbankParserResult | GenbankParserError

// ---------------------------------------------------------------------------
// Location parser (duplicated from genbank.ts to avoid cross-module issues in workers)
// ---------------------------------------------------------------------------

function parseLocation(loc: string): { start: number; end: number; strand: 1 | -1 | 0 } {
  let strand: 1 | -1 | 0 = 1
  let inner = loc

  if (inner.startsWith('complement(')) {
    strand = -1
    inner = inner.slice(11, -1)
  }

  if (inner.startsWith('join(')) {
    inner = inner.slice(5, -1)
  }

  const ranges = inner.split(',').map(part => {
    part = part.trim()
    if (part.startsWith('complement(')) {
      part = part.slice(11, -1)
    }
    const dotMatch = part.match(/(\d+)\.\.(\d+)/)
    if (dotMatch) {
      return { start: parseInt(dotMatch[1], 10), end: parseInt(dotMatch[2], 10) }
    }
    const num = parseInt(part, 10)
    return { start: num, end: num }
  })

  const start = Math.min(...ranges.map(r => r.start))
  const end = Math.max(...ranges.map(r => r.end))

  // Convert from 1-based inclusive to 0-based half-open
  return { start: start - 1, end, strand }
}

function stripQuotes(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1)
  if (s.startsWith('"')) return s.slice(1)
  if (s.endsWith('"')) return s.slice(0, -1)
  return s
}

// ---------------------------------------------------------------------------
// Streaming parser state machine (exported for testing)
// ---------------------------------------------------------------------------

let _nextId = 0
function nextId(): string {
  return `ann_${++_nextId}`
}

/** Reset ID counter (for testing). */
export function _resetIdCounter(): void {
  _nextId = 0
}

export interface ParserState {
  name: string
  topology: 'linear' | 'circular'
  annotations: GenbankAnnotation[]
  baseChunks: string[]
  section: 'header' | 'features' | 'origin'
  currentFeature: Partial<GenbankAnnotation> | null
  currentQualKey: string
  currentQualVal: string
  done: boolean
}

export function createState(): ParserState {
  return {
    name: 'Untitled',
    topology: 'linear',
    annotations: [],
    baseChunks: [],
    section: 'header',
    currentFeature: null,
    currentQualKey: '',
    currentQualVal: '',
    done: false,
  }
}

function flushQualifier(state: ParserState): void {
  if (state.currentQualKey && state.currentFeature) {
    const q = state.currentFeature.qualifiers ?? {}
    if (!q[state.currentQualKey]) q[state.currentQualKey] = []
    q[state.currentQualKey].push(state.currentQualVal)
    state.currentFeature.qualifiers = q
  }
  state.currentQualKey = ''
  state.currentQualVal = ''
}

function flushFeature(state: ParserState): void {
  flushQualifier(state)
  if (state.currentFeature && state.currentFeature.type) {
    state.annotations.push(state.currentFeature as GenbankAnnotation)
  }
  state.currentFeature = null
}

export function processLine(state: ParserState, line: string): void {
  if (state.done) return

  if (line.startsWith('ORIGIN')) {
    flushFeature(state)
    state.section = 'origin'
    return
  }

  if (line.startsWith('//')) {
    flushFeature(state)
    state.done = true
    return
  }

  if (state.section === 'origin') {
    // Sequence lines: strip numbers and whitespace, keep only bases
    state.baseChunks.push(line.replace(/[\s0-9]/g, ''))
    return
  }

  if (line.startsWith('LOCUS')) {
    const parts = line.split(/\s+/)
    state.name = parts[1] || 'Untitled'
    if (line.toLowerCase().includes('circular')) {
      state.topology = 'circular'
    }
    return
  }

  if (line.startsWith('FEATURES')) {
    state.section = 'features'
    return
  }

  if (state.section === 'features') {
    // Feature key line
    if (line.length > 5 && line[0] === ' ' && line[5] !== ' ') {
      flushFeature(state)
      const match = line.match(/^\s{5}(\S+)\s+(.+)$/)
      if (match) {
        const [, type, locationStr] = match
        const { start, end, strand } = parseLocation(locationStr.trim())
        state.currentFeature = {
          id: nextId(),
          name: type,
          type,
          start,
          end,
          strand,
          qualifiers: {},
        }
      }
    }
    // Qualifier line
    else if (line.length > 21 && /^\s{21}\//.test(line)) {
      flushQualifier(state)
      const qLine = line.trim().slice(1)
      const eqIdx = qLine.indexOf('=')
      if (eqIdx >= 0) {
        state.currentQualKey = qLine.slice(0, eqIdx)
        state.currentQualVal = stripQuotes(qLine.slice(eqIdx + 1))
      } else {
        state.currentQualKey = qLine
        state.currentQualVal = ''
      }
    }
    // Continuation line
    else if (line.length > 21 && /^\s{21}[^/\s]/.test(line) && state.currentQualKey) {
      state.currentQualVal += stripQuotes(line.trim())
    }
  }
}

export function finalize(state: ParserState): GenbankParserResult {
  flushFeature(state)

  // Apply label/gene/standard_name/product as annotation name
  for (const ann of state.annotations) {
    const q = ann.qualifiers ?? {}
    if (q['label']?.[0]) ann.name = q['label'][0]
    else if (q['gene']?.[0]) ann.name = q['gene'][0]
    else if (q['standard_name']?.[0]) ann.name = q['standard_name'][0]
    else if (q['product']?.[0]) ann.name = q['product'][0]
  }

  const bases = state.baseChunks.join('').toUpperCase()

  return {
    type: 'done',
    name: state.name,
    topology: state.topology,
    bases,
    annotations: state.annotations,
  }
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

self.onmessage = async (e: MessageEvent<GenbankParserRequest>) => {
  const { file } = e.data
  const totalBytes = file.size

  try {
    const state = createState()
    let bytesRead = 0
    let lastProgress = 0
    let leftover = ''

    const stream = file.stream()
    const reader = stream.getReader()
    const decoder = new TextDecoder()

    // Report progress at most every 500KB
    const PROGRESS_INTERVAL = 512 * 1024

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      bytesRead += value.byteLength
      const text = leftover + decoder.decode(value, { stream: true })
      const lines = text.split(/\r?\n/)

      // Last element is incomplete - save for next chunk
      leftover = lines.pop()!

      for (const line of lines) {
        processLine(state, line)
        if (state.done) break
      }

      if (state.done) break

      // Throttled progress updates
      if (bytesRead - lastProgress >= PROGRESS_INTERVAL) {
        lastProgress = bytesRead
        const msg: GenbankParserProgress = { type: 'progress', bytesRead, totalBytes }
        self.postMessage(msg)
      }
    }

    // Process any remaining leftover
    if (leftover && !state.done) {
      processLine(state, leftover)
    }

    const result = finalize(state)
    self.postMessage(result)
  } catch (err) {
    const msg: GenbankParserError = {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(msg)
  }
}
