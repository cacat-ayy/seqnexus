/**
 * Tests for the annotation list matching algorithm.
 * Re-implements core logic from the worker for direct testing.
 */

import { describe, it, expect } from 'vitest'

const COMPLEMENT: Record<string, string> = {
  A: 'T', T: 'A', G: 'C', C: 'G', N: 'N',
}

function reverseComplement(seq: string): string {
  const len = seq.length
  const result = new Array<string>(len)
  for (let i = 0; i < len; i++) {
    result[len - 1 - i] = COMPLEMENT[seq[i]] ?? 'N'
  }
  return result.join('')
}

function percentIdentity(a: string, b: string): number {
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) matches++
  }
  return (matches / a.length) * 100
}

interface AnnotationMatch {
  refName: string
  start: number
  end: number
  strand: 1 | -1
  similarity: number
}

interface Ref {
  name: string
  sequence: string
}

function searchExact(doc: string, ref: Ref, minSimilarity: number): AnnotationMatch[] {
  const docUpper = doc.toUpperCase()
  const refUpper = ref.sequence.toUpperCase()
  const refLen = refUpper.length
  const rcRef = reverseComplement(refUpper)
  const matches: AnnotationMatch[] = []

  for (let i = 0; i <= docUpper.length - refLen; i++) {
    const sub = docUpper.slice(i, i + refLen)
    const fwdSim = percentIdentity(refUpper, sub)
    if (fwdSim >= minSimilarity) {
      matches.push({ refName: ref.name, start: i, end: i + refLen, strand: 1, similarity: Math.round(fwdSim * 10) / 10 })
    }
    const revSim = percentIdentity(rcRef, sub)
    if (revSim >= minSimilarity) {
      matches.push({ refName: ref.name, start: i, end: i + refLen, strand: -1, similarity: Math.round(revSim * 10) / 10 })
    }
  }

  return matches
}

function filterBestMatch(matches: AnnotationMatch[]): AnnotationMatch[] {
  if (matches.length <= 1) return matches
  matches.sort((a, b) => a.start - b.start)
  const best: AnnotationMatch[] = []
  let current = matches[0]
  for (let i = 1; i < matches.length; i++) {
    const m = matches[i]
    const overlapStart = Math.max(current.start, m.start)
    const overlapEnd = Math.min(current.end, m.end)
    const overlapLen = Math.max(0, overlapEnd - overlapStart)
    const minLen = Math.min(current.end - current.start, m.end - m.start)
    if (overlapLen >= minLen * 0.75) {
      if (m.similarity > current.similarity) current = m
    } else {
      best.push(current)
      current = m
    }
  }
  best.push(current)
  return best
}

describe('Annotation list matcher', () => {
  it('finds exact match on forward strand', () => {
    const doc = 'AAAAAATGCGATCGAAAAA'
    const ref = { name: 'test', sequence: 'ATGCGATCGA' }
    const matches = searchExact(doc, ref, 100)
    const fwd = matches.filter(m => m.strand === 1)
    expect(fwd.length).toBe(1)
    expect(fwd[0].start).toBe(5)
    expect(fwd[0].end).toBe(15)
    expect(fwd[0].similarity).toBe(100)
  })

  it('finds exact match on reverse strand', () => {
    const fwdSeq = 'ATGCGATCGA'
    const rc = reverseComplement(fwdSeq)
    const doc = 'AAAAA' + rc + 'AAAAA'
    const ref = { name: 'test', sequence: fwdSeq }
    const matches = searchExact(doc, ref, 100)
    const rev = matches.filter(m => m.strand === -1)
    expect(rev.length).toBe(1)
    expect(rev[0].start).toBe(5)
    expect(rev[0].similarity).toBe(100)
  })

  it('finds approximate matches above threshold', () => {
    const doc = 'ATGCGATCGA'
    // 1 mismatch out of 10 = 90% identity
    const ref = { name: 'test', sequence: 'ATGCGNTCGA' }
    const matches = searchExact(doc, ref, 80)
    expect(matches.filter(m => m.strand === 1).length).toBe(1)
    expect(matches[0].similarity).toBe(90)
  })

  it('rejects matches below threshold', () => {
    const doc = 'ATGCGATCGA'
    const ref = { name: 'test', sequence: 'NNNNNNNNNN' }
    const matches = searchExact(doc, ref, 80)
    expect(matches.length).toBe(0)
  })

  it('finds no matches for empty reference', () => {
    const doc = 'ATGCGATCGA'
    const ref = { name: 'test', sequence: '' }
    const matches = searchExact(doc, ref, 80)
    expect(matches.length).toBe(0)
  })

  it('finds multiple matches', () => {
    const doc = 'ATGCATGCATGC'
    const ref = { name: 'test', sequence: 'ATGC' }
    const matches = searchExact(doc, ref, 100)
    const fwd = matches.filter(m => m.strand === 1)
    expect(fwd.length).toBe(3)
  })
})

describe('Best match filtering', () => {
  it('keeps only best overlapping match', () => {
    const matches: AnnotationMatch[] = [
      { refName: 'a', start: 10, end: 20, strand: 1, similarity: 90 },
      { refName: 'a', start: 11, end: 21, strand: 1, similarity: 95 },
    ]
    const best = filterBestMatch(matches)
    expect(best.length).toBe(1)
    expect(best[0].similarity).toBe(95)
  })

  it('keeps non-overlapping matches', () => {
    const matches: AnnotationMatch[] = [
      { refName: 'a', start: 10, end: 20, strand: 1, similarity: 90 },
      { refName: 'a', start: 100, end: 110, strand: 1, similarity: 85 },
    ]
    const best = filterBestMatch(matches)
    expect(best.length).toBe(2)
  })
})
