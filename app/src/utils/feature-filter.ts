/**
 * The feature panel's filter: plain words plus a few `key:value` terms.
 *
 *   lacZ                 name, type or any qualifier value contains "lacz"
 *   "lac operon"         a quoted phrase is one word
 *   type:CDS  t:cds      the feature key contains "cds" (several: any of them)
 *   len>500  len<=1k     the span, in bases or residues; k means thousand
 *   len:100-500          a span within the range, both ends included
 *   strand:-             forward (+, fwd), reverse (-, rev) or none (0, none)
 *
 * Every term must match. A term that does not parse (len>abc, strand:up) is
 * read as a plain word, so a typo narrows the list to nothing rather than
 * being silently dropped.
 */

import type { Annotation, Strand } from '../models/Annotation'
import { annotationLength } from './annotation-sequence'

export interface FeatureQuery {
  /** Lower-case words, each matched against name, type and qualifiers. */
  words: string[]
  /** Lower-case fragments of the feature key; a feature matches any one. */
  types: string[]
  strand: Strand | null
  minLen: number | null
  maxLen: number | null
}

const STRANDS: Record<string, Strand> = {
  '+': 1, fwd: 1, forward: 1, '1': 1, '+1': 1,
  '-': -1, '−': -1, rev: -1, reverse: -1, '-1': -1,
  '0': 0, none: 0, '.': 0,
}

/** "500", "1.5k", "2kb", "300bp"; null for anything else. */
function parseCount(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(k|kb|bp|aa)?$/i.exec(s.trim())
  if (!m) return null
  const n = parseFloat(m[1]) * (/^k/i.test(m[2] ?? '') ? 1000 : 1)
  return Math.round(n)
}

/** Split on spaces, keeping "quoted phrases" whole. */
function tokens(q: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(q)) !== null) {
    const t = m[1] ?? m[2]
    if (t) out.push(t)
  }
  return out
}

export function parseFeatureQuery(q: string): FeatureQuery {
  const query: FeatureQuery = { words: [], types: [], strand: null, minLen: null, maxLen: null }
  for (const tok of tokens(q)) {
    const lower = tok.toLowerCase()

    const type = /^(?:type|t):(.+)$/.exec(lower)
    if (type) { query.types.push(type[1]); continue }

    const strand = /^strand:(.+)$/.exec(lower)
    if (strand && strand[1] in STRANDS) { query.strand = STRANDS[strand[1]]; continue }

    const range = /^(?:len|length):(.+?)-(.+)$/.exec(lower)
    if (range) {
      const lo = parseCount(range[1])
      const hi = parseCount(range[2])
      if (lo !== null && hi !== null) {
        query.minLen = Math.min(lo, hi)
        query.maxLen = Math.max(lo, hi)
        continue
      }
    }

    const cmp = /^(?:len|length)(>=|<=|>|<|=|:)(.+)$/.exec(lower)
    if (cmp) {
      const n = parseCount(cmp[2])
      if (n !== null) {
        if (cmp[1] === '>') query.minLen = n + 1
        else if (cmp[1] === '>=') query.minLen = n
        else if (cmp[1] === '<') query.maxLen = n - 1
        else if (cmp[1] === '<=') query.maxLen = n
        else { query.minLen = n; query.maxLen = n }
        continue
      }
    }

    query.words.push(lower)
  }
  return query
}

/** True when the query has nothing in it, so every feature matches. */
export function isEmptyQuery(q: FeatureQuery): boolean {
  return q.words.length === 0 && q.types.length === 0 && q.strand === null && q.minLen === null && q.maxLen === null
}

export function matchesFeatureQuery(ann: Annotation, q: FeatureQuery, seqLen: number): boolean {
  if (q.types.length > 0) {
    const type = ann.type.toLowerCase()
    if (!q.types.some(t => type.includes(t))) return false
  }
  if (q.strand !== null && ann.strand !== q.strand) return false
  if (q.minLen !== null || q.maxLen !== null) {
    const len = annotationLength(ann, seqLen)
    if (q.minLen !== null && len < q.minLen) return false
    if (q.maxLen !== null && len > q.maxLen) return false
  }
  for (const w of q.words) {
    const hit = ann.name.toLowerCase().includes(w)
      || ann.type.toLowerCase().includes(w)
      || Object.values(ann.qualifiers).some(vals => vals.some(v => v.toLowerCase().includes(w)))
    if (!hit) return false
  }
  return true
}
