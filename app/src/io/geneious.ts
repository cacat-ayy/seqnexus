/**
 * Geneious .geneious file parser.
 *
 * Geneious files are ZIP-compressed XML (or occasionally plain XML).
 * The XML uses Geneious's Java XMLSerializable format with deeply nested
 * elements. We extract sequence, topology, features, and name by
 * recursively searching for known element names.
 *
 * Reference: reverse-engineered from @teselagen/bio-parsers geneiousXmlToJson.
 */

import { unzipSync } from 'fflate'
import { Sequence, type Topology } from '../models/Sequence'
import { Annotation, type AnnotationData, type Strand } from '../models/Annotation'
import type { DocumentState } from '../models/Document'

let _idPrefix = Math.random().toString(36).slice(2, 6)
let _nextId = 0
function nextId(): string {
  return `gen_${_idPrefix}_${++_nextId}`
}

function resetIds(): void {
  _idPrefix = Math.random().toString(36).slice(2, 6)
  _nextId = 0
}

/** Reset ID counter with deterministic prefix (for testing). */
export function _resetIdCounter(): void {
  _idPrefix = 'test'
  _nextId = 0
}

/**
 * Parse a Geneious .geneious file from an ArrayBuffer.
 */
export function parseGeneious(buffer: ArrayBuffer): DocumentState {
  resetIds()
  const bytes = new Uint8Array(buffer)
  let xmlString: string

  // Try ZIP decompression first (most .geneious files are ZIP archives)
  if (isZip(bytes)) {
    const unzipped = unzipSync(bytes)
    const entries = Object.entries(unzipped)
    if (entries.length === 0) {
      throw new Error('Empty ZIP archive in .geneious file')
    }
    // Pick the first XML file, or just the first file
    const xmlEntry = entries.find(([name]) => name.endsWith('.xml')) || entries[0]
    xmlString = new TextDecoder().decode(xmlEntry[1])
  } else {
    // Plain XML fallback
    xmlString = new TextDecoder().decode(bytes)
  }

  return parseGeneiousXml(xmlString)
}

/**
 * Check if bytes start with the ZIP magic number (PK\x03\x04).
 */
function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50  // P
    && bytes[1] === 0x4B  // K
    && bytes[2] === 0x03
    && bytes[3] === 0x04
}

/**
 * Parse the Geneious XML document.
 */
function parseGeneiousXml(xml: string): DocumentState {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const root = doc.documentElement

  // Extract sequence
  const charSeqEl = findElement(root, 'charSequence')
  if (!charSeqEl?.textContent) {
    throw new Error('No charSequence element found in Geneious file')
  }
  const sequence = charSeqEl.textContent.replace(/\s/g, '').toUpperCase()

  // Extract name
  const nameEl = findElement(root, 'name')
  const name = nameEl?.textContent?.trim() || 'Untitled'

  // Extract description (document-level, not annotation-level)
  // Look for a <description> that is a direct child of the root or top-level container,
  // not nested inside an <annotation> element.
  let description: string | undefined
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i]
    if ((child.tagName === 'description' || child.localName === 'description') && child.textContent?.trim()) {
      description = child.textContent.trim()
      break
    }
  }

  // Extract topology
  const circularEl = findElement(root, 'isCircular')
  const topology: Topology = circularEl?.textContent?.trim() === 'true' ? 'circular' : 'linear'

  // Extract annotations
  const annotations: AnnotationData[] = []
  extractAnnotations(root, annotations)

  return {
    name,
    description,
    sequence: new Sequence(sequence, topology),
    annotations: annotations.map(d => new Annotation(d)),
  }
}

/**
 * Recursively find the first element with the given tag name,
 * searching depth-first through the entire document tree.
 */
function findElement(root: Element, tagName: string): Element | null {
  if (root.tagName === tagName || root.localName === tagName) return root
  for (let i = 0; i < root.children.length; i++) {
    const found = findElement(root.children[i], tagName)
    if (found) return found
  }
  return null
}

/**
 * Find all elements with the given tag name (depth-first).
 */
function findAllElements(root: Element, tagName: string): Element[] {
  const results: Element[] = []
  function walk(el: Element) {
    if (el.tagName === tagName || el.localName === tagName) {
      results.push(el)
    }
    for (let i = 0; i < el.children.length; i++) {
      walk(el.children[i])
    }
  }
  walk(root)
  return results
}

/**
 * Extract annotation elements from the Geneious XML.
 *
 * Geneious stores annotations as <annotation> elements containing:
 *   <description> - feature name
 *   <type> - feature type (CDS, promoter, etc.)
 *   <interval> - location with minimumIndex, maximumIndex, direction
 */
function extractAnnotations(root: Element, annotations: AnnotationData[]): void {
  const annElements = findAllElements(root, 'annotation')

  for (const annEl of annElements) {
    const descEl = findElement(annEl, 'description')
    const typeEl = findElement(annEl, 'type')

    const annName = descEl?.textContent?.trim() || 'feature'
    const annType = typeEl?.textContent?.trim() || 'misc_feature'

    // Collect all intervals for this annotation
    const intervals = findAllElements(annEl, 'interval')
    if (intervals.length === 0) continue

    let minStart = Infinity
    let maxEnd = -Infinity
    let strand: Strand = 0

    for (const interval of intervals) {
      const minIdx = findElement(interval, 'minimumIndex')
      const maxIdx = findElement(interval, 'maximumIndex')
      const dirEl = findElement(interval, 'direction')

      if (!minIdx?.textContent || !maxIdx?.textContent) continue

      const s = parseInt(minIdx.textContent.trim(), 10)
      const e = parseInt(maxIdx.textContent.trim(), 10)

      if (s < minStart) minStart = s
      if (e > maxEnd) maxEnd = e

      const dir = dirEl?.textContent?.trim()
      if (dir === 'leftToRight') strand = 1
      else if (dir === 'rightToLeft') strand = -1
    }

    if (minStart === Infinity || maxEnd === -Infinity) continue

    // Geneious uses 1-based inclusive ranges → convert to 0-based half-open
    const start = minStart - 1
    const end = maxEnd

    // Extract color if present
    let color: string | undefined
    const colorEl = findElement(annEl, 'color')
    if (colorEl?.textContent) {
      color = colorEl.textContent.trim()
    }

    // Extract qualifiers
    const qualifiers: Record<string, string[]> = {}
    const qualEls = findAllElements(annEl, 'qualifier')
    for (const qEl of qualEls) {
      const qName = findElement(qEl, 'name')?.textContent?.trim()
      const qValue = findElement(qEl, 'value')?.textContent?.trim()
      if (qName && qValue) {
        if (!qualifiers[qName]) qualifiers[qName] = []
        qualifiers[qName].push(qValue)
      }
    }

    annotations.push({
      id: nextId(),
      name: annName,
      type: annType,
      start,
      end,
      strand,
      color,
      qualifiers,
    })
  }
}
