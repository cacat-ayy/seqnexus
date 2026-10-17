/**
 * Gateway geometry: where two att sites cross over, which way a real vector
 * carries them, and what the junction reads in the product.
 *
 * The arrangement used here is the one deposited vectors have, checked
 * against Addgene's pENTR1A (#17398) and pDest-527 (#11518): the two sites of
 * a pair point towards each other, so one of them lies on the bottom strand.
 */
import { describe, it, expect } from 'vitest'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { reverseComplement } from '../models/complement'
import { ATT_SITES, SPACER_LENGTH, findAttSites, spacerOffsetOf } from './gateway-sites'
import { crossoverOf, facing, readBetween, readOutside } from './gateway-segments'
import { gatewayClone } from './gateway'

const site = (name: string) => ATT_SITES.find(s => s.name === name)!
const core = (name: string) => site(name).core
/** The arm a site carries before its spacer, and the one after it. */
const beforeSpacer = (name: string) => core(name).slice(0, spacerOffsetOf(site(name)))
const afterSpacer = (name: string) => core(name).slice(spacerOffsetOf(site(name)) + SPACER_LENGTH)

function filler(n: number, seed = 1): string {
  let x = (seed | 0) || 1
  let out = ''
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x |= 0
    x ^= x >>> 17
    x ^= x << 5; x |= 0
    out += 'ACGT'[(x >>> 8) & 3]
  }
  return out
}

const doc = (
  name: string,
  bases: string,
  topology: 'linear' | 'circular' = 'circular',
  annotations: Annotation[] = [],
): DocumentState => ({ name, sequence: new Sequence(bases, topology), annotations })

/** An entry clone the way they are really built: attL1 in, attL2 back out. */
const entryClone = (cassette: string, pre = filler(200, 3), post = filler(200, 5)) =>
  pre + core('attL1') + cassette + reverseComplement(core('attL2')) + post

/** A destination vector: attR1 in, attR2 back out, stuffer between them. */
const destination = (stuffer: string, pre = filler(400, 31), post = filler(400, 41)) =>
  pre + core('attR1') + stuffer + reverseComplement(core('attR2')) + post

const sitesOf = (bases: string, type: 'attL' | 'attR') => {
  const found = findAttSites(bases, [type])
  return {
    one: found.find(m => m.site.number === 1)!,
    two: found.find(m => m.site.number === 2)!,
  }
}

describe('a pair of att sites in a real vector', () => {
  it('points towards each other, so one sits on the bottom strand', () => {
    const bases = entryClone(filler(400, 7))
    const { one, two } = sitesOf(bases, 'attL')
    expect(one.reverseStrand).toBe(false)
    expect(two.reverseStrand).toBe(true)
    expect(facing(one, two)).toBe(true)
  })

  it('is rejected when both sites point the same way', () => {
    const bases = filler(200, 3) + core('attL1') + filler(400, 7) + core('attL2') + filler(200, 5)
    const { one, two } = sitesOf(bases, 'attL')
    expect(facing(one, two)).toBe(false)
  })

  it('crosses over inside the spacer', () => {
    const bases = entryClone(filler(400, 7))
    const { one, two } = sitesOf(bases, 'attL')
    const first = crossoverOf(one)
    const second = crossoverOf(two)
    expect(first.length).toBe(SPACER_LENGTH)
    expect(bases.slice(first.at, first.at + SPACER_LENGTH)).toBe(first.spacer)
    // The second site reads backwards, so its spacer shows as the complement.
    expect(bases.slice(second.at, second.at + SPACER_LENGTH)).toBe(reverseComplement(second.spacer))
  })
})

describe('reading the stretch between two crossovers', () => {
  const cassette = filler(400, 7)

  it('runs from one spacer to the other, arms included', () => {
    const bases = entryClone(cassette)
    const { one, two } = sitesOf(bases, 'attL')
    const segment = readBetween(doc('entry', bases), crossoverOf(one), crossoverOf(two))
    expect(segment.reversed).toBe(false)
    expect(segment.bases).toBe(
      afterSpacer('attL1') + cassette + reverseComplement(afterSpacer('attL2')),
    )
  })

  it('gives the same stretch when the whole clone is the other way round', () => {
    const forward = entryClone(cassette, '', '')
    const bases = filler(200, 13) + reverseComplement(forward) + filler(200, 17)
    const { one, two } = sitesOf(bases, 'attL')
    expect(one.reverseStrand).toBe(true)
    const segment = readBetween(doc('entry', bases), crossoverOf(one), crossoverOf(two))
    expect(segment.reversed).toBe(true)
    expect(segment.bases).toBe(
      afterSpacer('attL1') + cassette + reverseComplement(afterSpacer('attL2')),
    )
  })

  it('reads a cassette that runs across the origin', () => {
    const short = cassette.slice(0, 120)
    const bases = entryClone(short, '', '')
    // rotate so that the cassette straddles base 0
    const shift = bases.indexOf(short) + 40
    const rotated = bases.slice(shift) + bases.slice(0, shift)
    const { one, two } = sitesOf(rotated, 'attL')
    const segment = readBetween(doc('entry', rotated), crossoverOf(one), crossoverOf(two))
    expect(segment.bases).toBe(
      afterSpacer('attL1') + short + reverseComplement(afterSpacer('attL2')),
    )
  })

  it('turns the features round with the cassette', () => {
    const forward = entryClone(cassette, '', '')
    const bases = filler(200, 13) + reverseComplement(forward) + filler(200, 17)
    // a gene on the cassette, as it reads on the top strand of this clone
    const geneStart = bases.indexOf(reverseComplement(cassette)) + 30
    const source = doc('entry', bases, 'circular', [
      new Annotation({ id: 'g', name: 'gene', type: 'CDS', start: geneStart, end: geneStart + 90, strand: 1 }),
    ])
    const { one, two } = sitesOf(bases, 'attL')
    const segment = readBetween(source, crossoverOf(one), crossoverOf(two))
    const gene = segment.annotations.find(a => a.name === 'gene')!
    expect(gene.strand).toBe(-1)
    expect(segment.bases.slice(gene.start, gene.end)).toBe(
      reverseComplement(bases.slice(geneStart, geneStart + 90)),
    )
  })
})

describe('reading the backbone outside two crossovers', () => {
  it('runs from the second site round to the first', () => {
    const left = filler(250, 13)
    const right = filler(150, 17)
    const bases = destination(filler(300, 19), left, right)
    const { one, two } = sitesOf(bases, 'attR')
    const segment = readOutside(doc('dest', bases), crossoverOf(one), crossoverOf(two))
    // across the origin: attR2's own arm, everything after it, then
    // everything before attR1, then attR1's arm up to its spacer
    expect(segment.bases).toBe(
      reverseComplement(beforeSpacer('attR2')) + right + left + beforeSpacer('attR1'),
    )
  })
})

describe('an LR reaction', () => {
  const insert = filler(500, 23)
  const stuffer = filler(600, 37)
  const entry = doc('pENTR', entryClone(insert))
  const dest = doc('pDEST', destination(stuffer))

  it('puts the cassette in the right way round', () => {
    const result = gatewayClone({ reaction: 'LR', sources: [{ doc: entry }, { doc: dest }] })
    const expressed = result.products.find(p => p.isExpected)!
    expect(expressed).toBeDefined()
    expect(expressed.sequence).toContain(insert)
    expect(expressed.sequence).not.toContain(reverseComplement(insert))
  })

  it('builds each junction from the two parents and the spacer they share', () => {
    const result = gatewayClone({ reaction: 'LR', sources: [{ doc: entry }, { doc: dest }] })
    const expressed = result.products.find(p => p.isExpected)!
    // attB1 is the destination's arm, the att1 spacer, then the entry clone's
    // arm. Nothing else may appear there: the product used to carry a stored
    // attB core instead, which differs from the parents' own bases.
    const attB1 = beforeSpacer('attR1') + 'GTACAAA' + afterSpacer('attL1')
    const attB2 = reverseComplement(afterSpacer('attL2')) + reverseComplement('GTACAAG')
      + reverseComplement(beforeSpacer('attR2'))
    const doubled = expressed.sequence + expressed.sequence
    expect(doubled).toContain(attB1)
    expect(doubled).toContain(attB2)
  })

  it('leaves the stuffer behind as the byproduct', () => {
    const result = gatewayClone({ reaction: 'LR', sources: [{ doc: entry }, { doc: dest }] })
    const byproduct = result.products.find(p => !p.isExpected)!
    expect(byproduct.sequence).toContain(stuffer)
    expect(byproduct.topology).toBe('circular')
  })

  it('swaps the destination stuffer for the cassette, base for base', () => {
    const result = gatewayClone({ reaction: 'LR', sources: [{ doc: entry }, { doc: dest }] })
    const expressed = result.products.find(p => p.isExpected)!
    // what the destination gives up, and what the entry clone puts in its place
    const given = afterSpacer('attR1').length + stuffer.length + afterSpacer('attR2').length
    const taken = afterSpacer('attL1').length + insert.length + afterSpacer('attL2').length
    expect(expressed.size).toBe(dest.sequence.bases.length - given + taken)
  })

  it('warns when the entry clone has both att sites pointing the same way', () => {
    const sameWay = doc(
      'pENTR',
      filler(200, 3) + core('attL1') + insert + core('attL2') + filler(200, 5),
    )
    const result = gatewayClone({ reaction: 'LR', sources: [{ doc: sameWay }, { doc: dest }] })
    expect(result.warnings.join(' ')).toContain('point the same way')
  })
})
