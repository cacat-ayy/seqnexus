/**
 * GenBank flat file parser and writer.
 *
 * Handles the subset of GenBank format needed for plasmid editing:
 * LOCUS, DEFINITION, FEATURES, and ORIGIN sections.
 */

import { Sequence, Topology } from '../models/Sequence'
import { Annotation, AnnotationData, Strand } from '../models/Annotation'
import { DocumentState, type SequenceMetadata, type Strandedness } from '../models/Document'

let _idPrefix = Math.random().toString(36).slice(2, 6)
let _nextId = 0
function nextId(): string {
  return `ann_${_idPrefix}_${++_nextId}`
}

/** Reset ID counter and randomize prefix. Used between parse calls to avoid collisions. */
function resetIds(): void {
  _idPrefix = Math.random().toString(36).slice(2, 6)
  _nextId = 0
}

/** Reset ID counter with deterministic prefix (for testing). */
export function _resetIdCounter(): void {
  _idPrefix = 'test'
  _nextId = 0
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a GenBank file that may contain multiple records (delimited by //).
 * Returns an array of DocumentState, one per record.
 */
export function parseGenBankMulti(text: string): DocumentState[] {
  // Split on record terminators, filter empty chunks
  const chunks = text.split(/^\/\/\s*$/m).filter(c => c.trim().length > 0)
  if (chunks.length === 0) return [parseGenBank(text)]
  return chunks.map(chunk => parseGenBank(chunk))
}

export function parseGenBank(text: string): DocumentState {
  resetIds()
  const lines = text.split(/\r?\n/)
  let name = 'Untitled'
  let description = ''
  let topology: Topology = 'linear'
  let strandedness: Strandedness = 'double'
  const annotations: AnnotationData[] = []
  const baseChunks: string[] = []

  let section: 'header' | 'features' | 'origin' = 'header'
  let currentFeature: Partial<AnnotationData> | null = null
  let currentQualKey = ''
  let currentQualVal = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // ORIGIN section - sequence data
    if (line.startsWith('ORIGIN')) {
      flushFeature()
      section = 'origin'
      continue
    }

    // End of record
    if (line.startsWith('//')) {
      break
    }

    if (section === 'origin') {
      // Sequence lines: "   1 atgcgatcga ..."
      // Collect chunks instead of concatenating to avoid O(n²)
      baseChunks.push(line.replace(/[\s0-9]/g, ''))
      continue
    }

    // LOCUS line
    if (line.startsWith('LOCUS')) {
      const parts = line.split(/\s+/)
      name = parts[1] || 'Untitled'
      const lower = line.toLowerCase()
      if (lower.includes('circular')) topology = 'circular'
      if (lower.includes('ss-dna') || lower.includes('ss-rna')) strandedness = 'single'
      continue
    }

    // DEFINITION line(s)
    if (line.startsWith('DEFINITION')) {
      description = line.slice(12).trim()
      // DEFINITION can span multiple lines (continuation lines start with spaces)
      while (i + 1 < lines.length && lines[i + 1].startsWith('  ') && !lines[i + 1].startsWith('FEATURES') && !lines[i + 1].match(/^[A-Z]/)) {
        i++
        description += ' ' + lines[i].trim()
      }
      // Remove trailing period
      if (description.endsWith('.')) description = description.slice(0, -1)
      continue
    }

    // FEATURES section header
    if (line.startsWith('FEATURES')) {
      section = 'features'
      continue
    }

    if (section === 'features') {
      // Feature key line: starts at column 5 with a non-space char
      // e.g. "     CDS             complement(join(1..100,200..300))"
      if (line.length > 5 && line[0] === ' ' && line[5] !== ' ') {
        flushFeature()
        const match = line.match(/^\s{5}(\S+)\s+(.+)$/)
        if (match) {
          const [, type, locationStr] = match
          const { start, end, strand } = parseLocation(locationStr.trim())
          currentFeature = {
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
      // Qualifier line: starts at column 21 with /
      else if (line.length > 21 && /^\s{21}\//.test(line)) {
        flushQualifier()
        const qLine = line.trim().slice(1) // remove leading /
        const eqIdx = qLine.indexOf('=')
        if (eqIdx >= 0) {
          currentQualKey = qLine.slice(0, eqIdx)
          currentQualVal = stripQuotes(qLine.slice(eqIdx + 1))
        } else {
          currentQualKey = qLine
          currentQualVal = ''
        }
      }
      // Continuation line for qualifier value
      else if (line.length > 21 && /^\s{21}[^/\s]/.test(line) && currentQualKey) {
        currentQualVal += stripQuotes(line.trim())
      }
    }
  }

  flushFeature()

  // Use /label, /gene, /standard_name, or /product qualifier as annotation name
  for (const ann of annotations) {
    const q = ann.qualifiers ?? {}
    if (q['label']?.[0]) ann.name = q['label'][0]
    else if (q['gene']?.[0]) ann.name = q['gene'][0]
    else if (q['standard_name']?.[0]) ann.name = q['standard_name'][0]
    else if (q['product']?.[0]) ann.name = q['product'][0]
  }

  // Join all chunks once - O(n) instead of O(n²) repeated concatenation
  const bases = baseChunks.join('')

  const metadata: SequenceMetadata = { strandedness }

  return {
    name,
    description: description || undefined,
    sequence: new Sequence(bases.toUpperCase(), topology),
    annotations: annotations.map(d => new Annotation(d)),
    metadata,
  }

  function flushFeature() {
    flushQualifier()
    if (currentFeature && currentFeature.type) {
      annotations.push(currentFeature as AnnotationData)
    }
    currentFeature = null
  }

  function flushQualifier() {
    if (currentQualKey && currentFeature) {
      const q = currentFeature.qualifiers ?? {}
      if (!q[currentQualKey]) q[currentQualKey] = []
      q[currentQualKey].push(currentQualVal)
      currentFeature.qualifiers = q
    }
    currentQualKey = ''
    currentQualVal = ''
  }
}

/**
 * Parse a GenBank location string into start/end/strand.
 * Handles: simple (100..200), complement(100..200), join(), single positions.
 * Returns 0-based half-open coordinates.
 */
function parseLocation(loc: string): { start: number; end: number; strand: Strand } {
  let strand: Strand = 1
  let inner = loc

  if (inner.startsWith('complement(')) {
    strand = -1
    inner = inner.slice(11, -1) // strip complement(...)
  }

  if (inner.startsWith('join(')) {
    inner = inner.slice(5, -1) // strip join(...)
  }

  // Extract all numeric ranges
  const ranges = inner.split(',').map(part => {
    part = part.trim()
    // Remove any remaining complement() wrappers on individual parts
    if (part.startsWith('complement(')) {
      part = part.slice(11, -1)
    }
    const dotMatch = part.match(/(\d+)\.\.(\d+)/)
    if (dotMatch) {
      return { start: parseInt(dotMatch[1], 10), end: parseInt(dotMatch[2], 10) }
    }
    // Single position
    const num = parseInt(part, 10)
    return { start: num, end: num }
  })

  // Use the overall span (first start to last end)
  const start = Math.min(...ranges.map(r => r.start))
  const end = Math.max(...ranges.map(r => r.end))

  // Convert from 1-based inclusive to 0-based half-open
  return { start: start - 1, end, strand }
}

function stripQuotes(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1)
  }
  if (s.startsWith('"')) {
    return s.slice(1)
  }
  if (s.endsWith('"')) {
    return s.slice(0, -1)
  }
  return s
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export function writeGenBank(state: DocumentState): string {
  const lines: string[] = []
  const seq = state.sequence
  const bp = seq.length
  const topo = seq.topology === 'circular' ? 'circular' : 'linear'

  // LOCUS
  const bpStr = bp.toString().padStart(7)
  const strandPrefix = state.metadata?.strandedness === 'single' ? 'ss-' : 'ds-'
  lines.push(
    `LOCUS       ${padRight(state.name, 16)} ${bpStr} bp    ${strandPrefix}DNA     ${topo}   01-JAN-2000`,
  )

  // DEFINITION
  lines.push(`DEFINITION  ${state.description || state.name}.`)

  // FEATURES
  lines.push('FEATURES             Location/Qualifiers')
  for (const ann of state.annotations) {
    const loc = formatLocation(ann, bp)
    lines.push(`     ${padRight(ann.type, 16)}${loc}`)

    // Write qualifiers
    const quals = ann.qualifiers ?? {}
    // Always write /label
    if (!quals['label']) {
      lines.push(`                     /label="${ann.name}"`)
    }
    for (const [key, values] of Object.entries(quals)) {
      for (const val of values) {
        if (val) {
          lines.push(`                     /${key}="${val}"`)
        } else {
          lines.push(`                     /${key}`)
        }
      }
    }
  }

  // ORIGIN
  lines.push('ORIGIN')
  const bases = seq.bases.toLowerCase()
  for (let i = 0; i < bases.length; i += 60) {
    const num = (i + 1).toString().padStart(9)
    const chunks: string[] = []
    for (let j = i; j < Math.min(i + 60, bases.length); j += 10) {
      chunks.push(bases.slice(j, j + 10))
    }
    lines.push(`${num} ${chunks.join(' ')}`)
  }

  lines.push('//')
  return lines.join('\n')
}

function formatLocation(ann: Annotation, seqLen: number): string {
  // Convert 0-based half-open to 1-based inclusive
  const start = ann.start + 1
  const end = ann.end

  let loc: string
  if (ann.start > ann.end && ann.end > 0) {
    // Origin-spanning feature: join(start..seqLen,1..end)
    loc = `join(${start}..${seqLen},1..${end})`
  } else if (ann.start > ann.end && ann.end === 0) {
    // Feature ends exactly at origin – just goes to seqLen
    loc = `${start}..${seqLen}`
  } else {
    loc = `${start}..${end}`
  }

  return ann.strand === -1 ? `complement(${loc})` : loc
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length)
}
