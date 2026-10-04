/**
 * The two things Gateway kept getting wrong: att sites cloned the other way
 * round, and a cassette or backbone that runs across the origin of a plasmid.
 * Both are ordinary, and both used to give an empty or inverted product.
 */
import { describe, it, expect } from 'vitest'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { reverseComplement } from '../models/complement'
import { ATT_SITES, findAttSites } from './gateway-sites'
import { betweenSites, outsideSites, sitesAgree } from './gateway-segments'
import { gatewayClone } from './gateway'

const core = (name: string) => ATT_SITES.find(s => s.name === name)!.core

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

describe('reading the cassette between two att sites', () => {
  const cassette = filler(400, 7)

  it('reads it straight off when the sites point forwards', () => {
    const bases = filler(200, 3) + core('attL1') + cassette + core('attL2') + filler(200, 5)
    const source = doc('entry', bases)
    const [one, two] = ['attL1', 'attL2'].map(
      name => findAttSites(bases, ['attL']).find(m => m.site.name === name)!,
    )
    expect(betweenSites(source, one, two).bases).toBe(cassette)
    expect(betweenSites(source, one, two).reversed).toBe(false)
  })

  it('turns it round when the sites point backwards', () => {
    // The whole att1-cassette-att2 stretch cloned in reverse, as entry clones
    // often are. The cassette still has to come out reading att1 to att2.
    const forward = core('attL1') + cassette + core('attL2')
    const bases = filler(200, 3) + reverseComplement(forward) + filler(200, 5)
    const source = doc('entry', bases)
    const sites = findAttSites(bases, ['attL'])
    const one = sites.find(m => m.site.name === 'attL1')!
    const two = sites.find(m => m.site.name === 'attL2')!
    expect(one.reverseStrand).toBe(true)

    const segment = betweenSites(source, one, two)
    expect(segment.reversed).toBe(true)
    expect(segment.bases).toBe(cassette)
  })

  it('reads a cassette that runs across the origin', () => {
    // attL1 near the end of the plasmid, attL2 just after the origin.
    const bases = core('attL2') + filler(300, 11) + core('attL1') + cassette.slice(0, 120)
    const rotated = bases.slice(bases.length - 120) + bases.slice(0, bases.length - 120)
    const source = doc('entry', rotated)
    const sites = findAttSites(rotated, ['attL'])
    const one = sites.find(m => m.site.name === 'attL1')!
    const two = sites.find(m => m.site.name === 'attL2')!

    const segment = betweenSites(source, one, two)
    expect(segment.bases).toHaveLength(120)
    expect(segment.bases).toBe(cassette.slice(0, 120))
  })

  it('turns the features round with the cassette', () => {
    const forward = core('attL1') + cassette + core('attL2')
    const bases = filler(200, 3) + reverseComplement(forward) + filler(200, 5)
    // A gene on the cassette, as it reads on the top strand of this clone.
    const geneStart = 200 + core('attL2').length
    const source = doc('entry', bases, 'circular', [
      new Annotation({ id: 'g', name: 'gene', type: 'CDS', start: geneStart, end: geneStart + 90, strand: 1 }),
    ])
    const sites = findAttSites(bases, ['attL'])
    const segment = betweenSites(
      source,
      sites.find(m => m.site.name === 'attL1')!,
      sites.find(m => m.site.name === 'attL2')!,
    )
    const gene = segment.annotations.find(a => a.name === 'gene')!
    expect(gene.strand).toBe(-1)
    // It was at the far end of the reversed cassette, so it comes out at the near end.
    expect(gene.start).toBe(segment.bases.length - 90)
  })
})

describe('reading the backbone outside two att sites', () => {
  it('runs from the second site round to the first', () => {
    const left = filler(250, 13)
    const right = filler(150, 17)
    const bases = left + core('attR1') + filler(300, 19) + core('attR2') + right
    const source = doc('dest', bases)
    const sites = findAttSites(bases, ['attR'])
    const segment = outsideSites(
      source,
      sites.find(m => m.site.name === 'attR1')!,
      sites.find(m => m.site.name === 'attR2')!,
    )
    // Across the origin: everything after attR2, then everything before attR1.
    expect(segment.bases).toBe(right + left)
  })
})

describe('sitesAgree', () => {
  it('rejects a pair of att sites facing opposite ways', () => {
    const bases = filler(100, 3) + core('attL1') + filler(200, 7) + reverseComplement(core('attL2')) + filler(100, 9)
    const sites = findAttSites(bases, ['attL'])
    const one = sites.find(m => m.site.name === 'attL1')!
    const two = sites.find(m => m.site.name === 'attL2')!
    expect(sitesAgree(one, two)).toBe(false)
  })
})

describe('an LR reaction with a reversed entry clone', () => {
  const insert = filler(500, 23)

  it('puts the cassette in the right way round', () => {
    const entryForward = core('attL1') + insert + core('attL2')
    const entry = doc('pENTR', filler(300, 3) + reverseComplement(entryForward) + filler(300, 5))
    const dest = doc('pDEST', filler(400, 31) + core('attR1') + filler(600, 37) + core('attR2') + filler(400, 41))

    const result = gatewayClone({ reaction: 'LR', sources: [{ doc: entry }, { doc: dest }] })
    const expressed = result.products.find(p => p.isExpected)!
    expect(expressed).toBeDefined()
    // The insert reads forwards in the product, not reverse complemented.
    expect(expressed.sequence).toContain(insert)
    expect(expressed.sequence).not.toContain(reverseComplement(insert))
  })

  it('warns when the entry clone has its att sites facing opposite ways', () => {
    const entry = doc(
      'pENTR',
      filler(200, 3) + core('attL1') + insert + reverseComplement(core('attL2')) + filler(200, 5),
    )
    const dest = doc('pDEST', filler(400, 31) + core('attR1') + filler(600, 37) + core('attR2') + filler(400, 41))
    const result = gatewayClone({ reaction: 'LR', sources: [{ doc: entry }, { doc: dest }] })
    expect(result.warnings.join(' ')).toContain('face opposite ways')
  })
})
