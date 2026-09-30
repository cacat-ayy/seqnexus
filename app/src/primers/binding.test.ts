import { describe, it, expect } from 'vitest'
import { findBindingSites, annealedPart, type BindingSite } from './binding'
import { cleanOligo, type PrimerData } from './oligo'
import { reverseComplement } from '../models/complement'

/**
 * Deterministic pseudo-random template, so no test depends on luck. Xorshift
 * rather than a float LCG: `x * 1103515245` overflows 2^53 in JavaScript and
 * the resulting sequence repeats, which would give primers extra sites.
 */
function template(n: number, seed = 7): string {
  let x = seed | 0 || 1
  let s = ''
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5
    s += 'ACGT'[(x >>> 7) & 3]
  }
  return s
}

const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' }

/** Any base other than `b`, so a tail cannot pair by accident. */
const not = (b: string) => (b === 'A' ? 'C' : 'A')

function primer(sequence: string, over: Partial<PrimerData> = {}): PrimerData {
  return { id: 'p', name: 'p', sequence, role: 'primer', ...over }
}

function sitesOf(p: PrimerData, t: string, topology: 'linear' | 'circular' = 'linear'): BindingSite[] {
  return findBindingSites([p], t, topology).get(p.id)!
}

const T = template(2000)

describe('findBindingSites: plain primers', () => {
  it('finds a forward primer where it matches the top strand', () => {
    const [site, ...rest] = sitesOf(primer(T.slice(100, 120)), T)
    expect(rest).toEqual([])
    expect(site).toMatchObject({ start: 100, end: 120, strand: 1, tail5: '', tail3: '', mismatches: [] })
  })

  it('finds a reverse primer on the bottom strand', () => {
    const [site] = sitesOf(primer(reverseComplement(T.slice(300, 322))), T)
    expect(site).toMatchObject({ start: 300, end: 322, strand: -1, tail5: '', mismatches: [] })
  })

  it('reports an oligo that binds nowhere as an empty list', () => {
    const other = template(40, 99)
    expect(sitesOf(primer(other.slice(0, 22)), T)).toEqual([])
  })

  it('ignores oligos shorter than the seed', () => {
    expect(sitesOf(primer(T.slice(100, 108)), T)).toEqual([])
  })

  it('lists every site of a primer that binds twice', () => {
    const repeat = T.slice(500, 525)
    const t = T.slice(0, 1000) + repeat + T.slice(1000)
    const sites = sitesOf(primer(repeat), t)
    expect(sites.map(s => s.start)).toEqual([500, 1000])
  })
})

describe('findBindingSites: overhangs', () => {
  it('splits a forward primer into a 5\' tail and the annealed part', () => {
    const tail = 'GAATTC' + not(T[99])
    const [site] = sitesOf(primer(tail + T.slice(100, 120)), T)
    expect(site).toMatchObject({ start: 100, end: 120, strand: 1, tail5: tail, tail3: '' })
    expect(site.annealFrom).toBe(tail.length)
  })

  it('puts a reverse primer\'s 5\' tail downstream on the top strand', () => {
    // The oligo base next to the annealed part would pair with T[320]; make
    // sure it does not.
    const tail = 'GGATCC' + not(COMP[T[320]])
    const [site] = sitesOf(primer(tail + reverseComplement(T.slice(300, 320))), T)
    expect(site).toMatchObject({ start: 300, end: 320, strand: -1, tail5: tail, tail3: '' })
    expect(annealedPart(tail + reverseComplement(T.slice(300, 320)), site))
      .toBe(reverseComplement(T.slice(300, 320)))
  })

  it('keeps the tail of a primer hanging off the start of a linear template', () => {
    const [site] = sitesOf(primer('TTTTTTTTGC' + T.slice(0, 20)), T)
    expect(site).toMatchObject({ start: 0, end: 20, tail5: 'TTTTTTTTGC' })
  })

  it('gives a probe tails at both ends', () => {
    const five = 'CGCGATC' + not(T[199])
    const three = not(T[224]) + 'GATCGCG'
    const [site] = sitesOf(primer(five + T.slice(200, 224) + three, { role: 'probe' }), T)
    expect(site).toMatchObject({ start: 200, end: 224, tail5: five, tail3: three })
  })
})

describe('findBindingSites: mismatches', () => {
  it('keeps a substitution inside the annealed part', () => {
    const bases = T.slice(100, 140).split('')
    bases[20] = not(bases[20])
    const [site] = sitesOf(primer(bases.join('')), T)
    expect(site).toMatchObject({ start: 100, end: 140, mismatches: [20] })
  })

  it('reports mismatches in oligo coordinates on the bottom strand', () => {
    const oligo = reverseComplement(T.slice(100, 140)).split('')
    oligo[15] = not(oligo[15])
    const [site] = sitesOf(primer(oligo.join('')), T)
    expect(site).toMatchObject({ strand: -1, mismatches: [15] })
  })

  it('refuses a primer whose 3\' end does not pair, since it cannot extend', () => {
    const oligo = T.slice(100, 125).slice(0, -1) + not(T[124])
    expect(sitesOf(primer(oligo), T)).toEqual([])
  })

  it('accepts the same oligo as a probe, which is never extended', () => {
    const oligo = T.slice(100, 125).slice(0, -1) + not(T[124])
    expect(sitesOf(primer(oligo, { role: 'probe' }), T)).toHaveLength(1)
  })

  it('pairs an ambiguity code with any base it stands for', () => {
    const oligo = T.slice(100, 110) + 'N' + T.slice(111, 125)
    const [site] = sitesOf(primer(oligo), T)
    expect(site).toMatchObject({ start: 100, end: 125, mismatches: [] })
  })
})

describe('findBindingSites: circular templates', () => {
  const n = T.length

  it('finds one site across the origin, not two', () => {
    const sites = sitesOf(primer(T.slice(n - 8) + T.slice(0, 14)), T, 'circular')
    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({ start: n - 8, end: 14, strand: 1 })
  })

  it('finds a reverse primer across the origin', () => {
    const sites = sitesOf(primer(reverseComplement(T.slice(n - 12) + T.slice(0, 10))), T, 'circular')
    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({ start: n - 12, end: 10, strand: -1 })
  })

  it('does not wrap on a linear template', () => {
    expect(sitesOf(primer(T.slice(n - 8) + T.slice(0, 14)), T, 'linear')).toEqual([])
  })

  it('keeps a tail that would sit before position 0', () => {
    const tail = 'GAATTC' + not(T[n - 1])
    const sites = sitesOf(primer(tail + T.slice(0, 20)), T, 'circular')
    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({ start: 0, end: 20, tail5: tail })
  })
})

describe('cleanOligo', () => {
  it('strips order-sheet decoration and maps U to T', () => {
    expect(cleanOligo("5'-gaa ttc-3'")).toBe('GAATTC')
    expect(cleanOligo('AUGC')).toBe('ATGC')
  })

  it('keeps ambiguity codes', () => {
    expect(cleanOligo('ACGTNRY')).toBe('ACGTNRY')
  })

  it('rejects anything that is not an oligo', () => {
    expect(cleanOligo('ACGTX')).toBeNull()
    expect(cleanOligo('   ')).toBeNull()
  })
})
