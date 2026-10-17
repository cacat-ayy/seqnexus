/**
 * Cutting a real plasmid, where the awkward cases live: a cut whose overhang
 * straddles the origin, two enzymes breaking the same strand in the same
 * place, and two cuts so close that the piece between them has no base pairs
 * holding it together.
 *
 * The expected fragment sets here were checked against Biopython's
 * Restriction module and pydna, which cut the same molecules independently.
 */

import { describe, it, expect } from 'vitest'
import { Sequence } from '../models/Sequence'
import type { DocumentState } from '../models/Document'
import { getEnzyme } from '../enzymes/db'
import { digest } from './cut'
import { extentOf, coreOf } from './fragment'

function doc(name: string, bases: string, topology: 'linear' | 'circular' = 'circular'): DocumentState {
  return { name, sequence: new Sequence(bases, topology), annotations: [] }
}

const DraIII = getEnzyme('DraIII')!   // CACNNNGTG, 3' overhang of 3
const SphI = getEnzyme('SphI')!       // GCATGC, 3' overhang of 4
const EcoRI = getEnzyme('EcoRI')!
const HaeIII = getEnzyme('HaeIII')!   // GGCC, blunt
const MroNI = getEnzyme('MroNI')!     // GCCGGC, 5' overhang of 4

/** A filler with no sites of the enzymes used here. */
function filler(n: number, seed = 1): string {
  let x = seed | 0
  let out = ''
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x |= 0
    x ^= x >>> 17
    x ^= x << 5; x |= 0
    out += 'ACGT'[Math.abs(x) % 4]
  }
  return out
}

describe('a cut whose overhang straddles the origin', () => {
  // DraIII cuts CACNNNGTG as CACNNN^GTG on the top strand and three bases
  // back on the bottom, so a site placed across base 0 leaves one cut
  // position near the end of the sequence and the other just after it.
  const site = 'CAC' + 'TTT' + 'GTG'
  // rotate the plasmid so the top-strand break falls exactly at the origin
  const body = filler(300, 7) + 'GCATGC' + filler(300, 11)
  const bases = site.slice(6) + body + site.slice(0, 6)

  it('still cuts at the other sites', () => {
    const { fragments, warnings } = digest(doc('p', bases), [DraIII, SphI])
    // two cuts round a circle leave two fragments, as Biopython and pydna say
    expect(fragments).toHaveLength(2)
    expect(warnings.filter(w => w.includes('overlap'))).toHaveLength(0)
    // pydna reports both pieces as 311 bp of duplex
    expect(fragments.map(extentOf).sort((a, b) => a - b)).toEqual([311, 311])
  })

  it('leaves the wrapped cut its own ends', () => {
    const { fragments } = digest(doc('p', bases), [DraIII, SphI])
    const kinds = fragments.flatMap(f => [f.left!.kind, f.right!.kind])
    expect(new Set(kinds)).toEqual(new Set(['three_prime']))
    const spans = fragments.flatMap(f => [f.left!.span.length, f.right!.span.length]).sort()
    // DraIII leaves three bases, SphI four, and each appears at two ends
    expect(spans).toEqual([3, 3, 4, 4])
  })

  it('tiles the plasmid exactly', () => {
    const { fragments } = digest(doc('p', bases), [DraIII, SphI])
    expect(fragments.reduce((n, f) => n + f.top.length, 0)).toBe(bases.length)
  })
})

describe('two enzymes that break the top strand in the same place', () => {
  // HaeIII cuts GG^CC and MroNI cuts G^CCGGC. Written one after the other
  // they share a top-strand break while their bottom-strand breaks differ,
  // and only one of them can cut a given molecule, since either break
  // destroys the other's site.
  const bases = filler(200, 3) + 'GGCCGGC' + filler(200, 23) + 'GAATTC' + filler(200, 41)

  it('does not invent a fragment longer than the plasmid', () => {
    const { fragments } = digest(doc('p', bases), [HaeIII, MroNI, EcoRI])
    for (const f of fragments) {
      expect(extentOf(f)).toBeLessThanOrEqual(bases.length + 8)
    }
  })

  it('still tiles the plasmid exactly once', () => {
    const { fragments } = digest(doc('p', bases), [HaeIII, MroNI, EcoRI])
    expect(fragments.reduce((n, f) => n + f.top.length, 0)).toBe(bases.length)
  })

  it('says that the two sites cannot both cut', () => {
    const { warnings } = digest(doc('p', bases), [HaeIII, MroNI, EcoRI])
    expect(warnings.some(w => w.includes('cannot both cut'))).toBe(true)
  })
})

describe('two cuts closer together than their overhangs', () => {
  // Two MroNI sites four bases apart: the bottom-strand break of the first
  // lands on the top-strand break of the second, so the stretch between them
  // comes away as a single strand rather than a fragment with two ends.
  const bases = filler(200, 5) + 'GCCGGCCGGC' + filler(200, 29)

  it('does not offer a piece with no base pairs in it', () => {
    const { fragments } = digest(doc('p', bases), [MroNI])
    for (const f of fragments) {
      expect(coreOf(f).length).toBeGreaterThan(0)
    }
  })

  it('leaves the neighbouring pieces their proper ends', () => {
    const { fragments } = digest(doc('p', bases), [MroNI])
    expect(fragments.length).toBeGreaterThan(0)
    for (const f of fragments) {
      expect(f.left!.span.length).toBe(4)
      expect(f.right!.span.length).toBe(4)
    }
  })
})
