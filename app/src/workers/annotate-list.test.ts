/**
 * Tests for the annotation list matcher, through the module the worker runs.
 */

import { describe, it, expect } from 'vitest'
import { scanForReferences, keepBest, type ReferenceAnnotation, type AnnotationMatch } from '../features/annotate-scan'
import { reverseComplement } from '../models/complement'

const ref = (sequence: string, name = 'test'): ReferenceAnnotation => ({ name, type: 'misc_feature', sequence })
const scan = (doc: string, refs: ReferenceAnnotation[], minSimilarity: number, bestMatchOnly = false) =>
  scanForReferences({ documentBases: doc, references: refs, minSimilarity, bestMatchOnly })

describe('scanForReferences', () => {
  it('finds an exact match on the forward strand', () => {
    const matches = scan('AAAAAATGCGATCGAAAAA', [ref('ATGCGATCGA')], 100)
    expect(matches).toEqual([expect.objectContaining({ refName: 'test', start: 5, end: 15, strand: 1, similarity: 100 })])
  })

  it('finds an exact match on the reverse strand', () => {
    const fwd = 'ATGCGATCGA'
    const matches = scan('AAAAA' + reverseComplement(fwd) + 'AAAAA', [ref(fwd)], 100)
    expect(matches).toEqual([expect.objectContaining({ start: 5, end: 15, strand: -1, similarity: 100 })])
  })

  it('finds approximate matches above the threshold, and not below it', () => {
    // One mismatch in 20 bases: 95%.
    const doc = 'CCCCC' + 'ATGCGATCGATTAGCCGTAC' + 'CCCCC'
    const near = 'ATGCGATCGACTAGCCGTAC'
    expect(scan(doc, [ref(near)], 90)).toEqual([expect.objectContaining({ start: 5, end: 25, strand: 1, similarity: 95 })])
    expect(scan(doc, [ref(near)], 96)).toEqual([])
  })

  it('finds nothing for an empty reference or one longer than the document', () => {
    expect(scan('ATGCGATCGA', [ref('')], 80)).toEqual([])
    expect(scan('ATGC', [ref('ATGCGATCGA')], 80)).toEqual([])
  })

  it('reports every copy of a repeated reference, sorted by position', () => {
    const matches = scan('ATGCGATCGA' + 'TTTTTTTTTT' + 'ATGCGATCGA', [ref('ATGCGATCGA')], 100)
    expect(matches.map(m => m.start)).toEqual([0, 20])
  })

  it('keeps one match per stretch when asked for the best', () => {
    // AGGT, whose reverse complement (ACCT) the repeat does not contain, so only the forward strand matches.
    const doc = 'AGGT'.repeat(8)
    const all = scan(doc, [ref('AGGT'.repeat(4))], 100)
    expect(all.map(m => m.start)).toEqual([0, 4, 8, 12, 16])
    const best = scan(doc, [ref('AGGT'.repeat(4))], 100, true)
    expect(best.map(m => m.start)).toEqual([0, 8, 16])
  })

  it('keeps one match per stretch across the versions of one group, preferring the longer', () => {
    const long = 'ATGCGATCGATTAGCCGTACGGTACCTTAG'
    const short = long.slice(5, 25)
    const doc = 'CCCCC' + long + 'CCCCC'
    const versions = [ref(long, 'el'), { ...ref(short, 'el (short)'), group: 'el' }]
    expect(scan(doc, versions, 100, true).map(m => m.refName)).toEqual(['el'])
    // Without the group they are two elements, and both are proposed.
    expect(scan(doc, [ref(long, 'el'), ref(short, 'other')], 100, true).map(m => m.refName)).toEqual(['el', 'other'])
    // Alone, the short version is still found.
    expect(scan('CCCCC' + short + 'CCCCC', versions, 100, true).map(m => m.refName)).toEqual(['el (short)'])
  })

  it('carries the reference name, type and colour into the match', () => {
    const [m] = scan('GGGGATGCGATCGAGGGG', [{ name: 'ori', type: 'rep_origin', sequence: 'ATGCGATCGA', color: '#123456' }], 100)
    expect(m).toMatchObject({ refName: 'ori', refType: 'rep_origin', color: '#123456' })
  })
})

/** Deterministic random DNA, so a failure reproduces. */
function randomDna(n: number, seed: number): string {
  let s = seed >>> 0 || 1
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0
    out.push('ACGT'[s & 3])
  }
  return out.join('')
}

/** `count` substitutions at random positions of `seq`, never to the same base. */
function mutate(seq: string, count: number, seed: number): string {
  const a = seq.split('')
  const order = randomDna(seq.length * 4, seed)
  const used = new Set<number>()
  let i = 0
  while (used.size < count) {
    const p = (order.charCodeAt(i) * 7919 + order.charCodeAt(i + 1) * 104729 + i * 31) % seq.length
    i += 2
    if (used.has(p)) continue
    used.add(p)
    a[p] = 'ACGT'[('ACGT'.indexOf(a[p]) + 1 + (i % 3)) % 4]
  }
  return a.join('')
}

describe('sensitivity at the threshold', () => {
  // A copy at identity p shares about p^k of its k-mers, and k grows with the
  // document (6, 8, 10), so the seed bar has to follow p^k, not p.
  const element = randomDna(1000, 7)
  const copy = mutate(element, 130, 11) // 87%

  for (const [label, flank] of [['5 kb', 2000], ['50 kb', 24500], ['200 kb', 99500]] as const) {
    it(`finds a copy at 87% identity in a ${label} document`, () => {
      const doc = randomDna(flank, 21) + copy + randomDna(flank, 23)
      const hits = scan(doc, [ref(element)], 85, true)
      expect(hits).toEqual([expect.objectContaining({ start: flank, end: flank + 1000, similarity: 87 })])
    })
  }
})

describe('circular documents', () => {
  const element = randomDna(300, 31)
  // The element straddles the origin: its second half starts the sequence.
  const doc = element.slice(150) + randomDna(2000, 33) + element.slice(0, 150)

  it('finds an element across the origin, as a span that wraps', () => {
    const hits = scanForReferences({ documentBases: doc, references: [ref(element)], minSimilarity: 85, bestMatchOnly: true, circular: true })
    expect(hits).toEqual([expect.objectContaining({ start: doc.length - 150, end: 150, strand: 1, similarity: 100 })])
  })

  it('finds it on the reverse strand too', () => {
    const rc = reverseComplement(doc)
    const hits = scanForReferences({ documentBases: rc, references: [ref(element)], minSimilarity: 85, bestMatchOnly: true, circular: true })
    expect(hits).toEqual([expect.objectContaining({ start: rc.length - 150, end: 150, strand: -1 })])
  })

  it('does not look across the end of a linear document', () => {
    expect(scan(doc, [ref(element)], 85, true)).toEqual([])
  })

  it('reports an element inside the sequence once, not again from the repeated start', () => {
    const inside = randomDna(500, 35) + element + randomDna(500, 37)
    const hits = scanForReferences({ documentBases: inside, references: [ref(element)], minSimilarity: 85, bestMatchOnly: true, circular: true })
    expect(hits.map(h => [h.start, h.end])).toEqual([[500, 800]])
  })
})

describe('short references', () => {
  const nine = 'TTAACTTTA'

  it('matches a reference under 20 bp exactly', () => {
    const doc = randomDna(100, 41) + 'TTAACTTTC' + randomDna(100, 43)
    // One mismatch in nine bases is 88.9%, above 85%, and still not that element.
    expect(scan(doc, [ref(nine)], 85, true)).toEqual([])
    const exact = randomDna(100, 41) + nine + randomDna(100, 43)
    expect(scan(exact, [ref(nine)], 85, true)).toEqual([expect.objectContaining({ start: 100, similarity: 100 })])
  })

  it('does not search a reference random sequence of this size would contain anyway', () => {
    // A 9-mer is expected about 7.6 times in a megabase on two strands.
    const big = randomDna(1_000_000, 45)
    expect(scan(big, [ref(nine)], 85, true)).toEqual([])
    // A 25 bp reference is no such risk, and is still found.
    const element = randomDna(25, 47)
    const doc = big.slice(0, 500_000) + element + big.slice(500_000)
    expect(scan(doc, [ref(element)], 85, true)).toEqual([expect.objectContaining({ start: 500_000 })])
  })
})

describe('ambiguity codes', () => {
  it('lets a code in the reference accept any base it stands for', () => {
    // An estrogen response element: AGGTCAnnnTGACCT.
    const ere = 'AGGTCANNNTGACCT'
    const doc = randomDna(60, 51) + 'AGGTCAGCTTGACCT' + randomDna(60, 53)
    expect(scan(doc, [ref(ere)], 85, true)).toEqual([expect.objectContaining({ start: 60, end: 75, similarity: 100 })])
    const purine = 'ATGCGATCGARTAGCCGTACGG'
    const withA = 'CC' + 'ATGCGATCGAATAGCCGTACGG' + 'CC'
    const withC = 'CC' + 'ATGCGATCGACTAGCCGTACGG' + 'CC'
    expect(scan(withA, [ref(purine)], 100)).toHaveLength(1)
    expect(scan(withC, [ref(purine)], 100)).toEqual([])
  })

  it('does not let an unknown base in the document count as a match', () => {
    const element = randomDna(40, 55)
    const withN = element.slice(0, 20) + 'N' + element.slice(21)
    const doc = 'GGGG' + withN + 'GGGG'
    expect(scan(doc, [ref(element)], 100)).toEqual([])
    expect(scan(doc, [ref(element)], 95)).toEqual([expect.objectContaining({ similarity: 97.5 })])
  })
})

describe('truncated copies', () => {
  const element = randomDna(800, 61)

  it('reports a copy with its end missing as the part that is there', () => {
    // 720 of 800 bases, then unrelated sequence: 92.5% or so over the whole
    // reference, so it passes the threshold, but the copy ends at 1720.
    const doc = randomDna(1000, 63) + element.slice(0, 720) + randomDna(1000, 65)
    const [hit] = scan(doc, [ref(element)], 85, true)
    expect(hit).toMatchObject({ start: 1000, coverage: 90 })
    expect(hit.end).toBeGreaterThanOrEqual(1718)
    expect(hit.end).toBeLessThanOrEqual(1722)
  })

  it('reports a copy with its start missing the same way', () => {
    const doc = randomDna(1000, 67) + element.slice(80) + randomDna(1000, 69)
    const [hit] = scan(doc, [ref(element)], 85, true)
    expect(hit.end).toBe(1720)
    expect(hit.start).toBeGreaterThanOrEqual(998)
    expect(hit.start).toBeLessThanOrEqual(1002)
    expect(hit.coverage).toBeCloseTo(90, 0)
  })

  it('leaves a whole copy whole, even with a mismatch near an end', () => {
    const near = element.slice(0, 797) + (element[797] === 'A' ? 'C' : 'A') + element.slice(798)
    const doc = randomDna(500, 71) + near + randomDna(500, 73)
    const [hit] = scan(doc, [ref(element)], 85, true)
    expect(hit).toMatchObject({ start: 500, end: 1300 })
    expect(hit.coverage).toBeUndefined()
  })
})

describe('keepBest', () => {
  const m = (start: number, end: number, similarity: number): AnnotationMatch =>
    ({ refName: 'x', refType: 'misc_feature', start, end, strand: 1, similarity })

  it('does not let a chain of overlaps swallow hits that do not overlap each other', () => {
    // A overlaps B by 75%, B overlaps C by 75%, A and C only by half, and
    // similarity rises along the chain. A running best went A, then B, then
    // C, and A was lost though nothing kept covers it.
    const kept = keepBest([m(0, 100, 90), m(25, 125, 95), m(50, 150, 99)])
    expect(kept.map(x => x.start).sort((a, b) => a - b)).toEqual([0, 50])
    // When the middle one is best it covers both neighbours, and is all that stays.
    expect(keepBest([m(0, 100, 90), m(25, 125, 100), m(50, 150, 95)]).map(x => x.start)).toEqual([25])
  })

  it('prefers the more similar, then the longer', () => {
    expect(keepBest([m(0, 100, 95), m(0, 100, 99)]).map(x => x.similarity)).toEqual([99])
    expect(keepBest([m(10, 90, 99), m(0, 100, 99)]).map(x => x.end - x.start)).toEqual([100])
  })
})
