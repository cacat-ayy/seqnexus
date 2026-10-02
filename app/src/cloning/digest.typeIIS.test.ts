/**
 * Type IIS enzymes cut outside their recognition site, so near an end of the
 * sequence the cut can fall past the origin (circular) or off the molecule
 * (linear). Cut positions used to be left unwrapped: a circular digest gave
 * the wrong overhang, and a linear one invented a fragment from nothing.
 */
import { describe, it, expect } from 'vitest'
import { Sequence } from '../models/Sequence'
import type { DocumentState } from '../models/Document'
import { getEnzyme } from '../enzymes/db'
import { findCutSites, computeFragments } from '../enzymes/finder'
import { digestFragments, partialDigestFragments } from './digest'

const BsaI = getEnzyme('BsaI')!
// No G or C, so no BsaI site in either orientation.
const filler = (n: number) => 'AT'.repeat(n).slice(0, n)
const doc = (bases: string, topology: 'linear' | 'circular'): DocumentState =>
  ({ name: 'p', sequence: new Sequence(bases, topology), annotations: [] })

describe('Type IIS cuts on a circular sequence', () => {
  // BsaI GGTCTC(N1)/(N5): a site at the very end cuts 1 and 5 bases past the origin.
  const bases = 'TACGGA' + filler(188) + 'GGTCTC'

  it('wraps the cut positions into the sequence', () => {
    const [site] = findCutSites(bases, BsaI, 'circular')
    expect([site.fwdCut, site.revCut]).toEqual([1, 5])
    expect(site.offEnd).toBeUndefined()
  })

  it('gives the full 4-base overhang across the origin', () => {
    const { fragments } = digestFragments(doc(bases, 'circular'), [BsaI])
    expect(fragments).toHaveLength(1)
    expect(fragments[0].sequence).toHaveLength(200)
    expect(fragments[0].overhang5).toBe('ACGG')
    expect(fragments[0].overhang5Type).toBe('five_prime')
    expect(fragments[0].overhang3).toBe('ACGG')
  })

  it('handles a reverse-strand site just after the origin', () => {
    // GAGACC at 0 is BsaI on the bottom strand: it cuts 5 and 1 bases before it.
    const rev = 'GAGACC' + filler(190) + 'TGCA'
    const [site] = findCutSites(rev, BsaI, 'circular')
    expect([site.fwdCut, site.revCut]).toEqual([195, 199])
    const { fragments } = digestFragments(doc(rev, 'circular'), [BsaI])
    expect(fragments[0].overhang5).toBe(rev.slice(195, 199))
  })

  it('agrees with partial digests', () => {
    const { fragmentSets } = partialDigestFragments(doc(bases, 'circular'), [BsaI])
    const cut = fragmentSets.find(set => set[0].overhang5 !== '')!
    expect(cut[0].overhang5).toBe('ACGG')
  })
})

describe('Type IIS cuts on a linear sequence', () => {
  // A bottom-strand site at the very start would cut at -5 and -1: off the molecule.
  const bases = 'GAGACC' + filler(300)

  it('keeps the site but marks that it does not cut', () => {
    const sites = findCutSites(bases, BsaI, 'linear')
    expect(sites).toHaveLength(1)
    expect(sites[0].offEnd).toBe(true)
  })

  it('leaves the molecule uncut instead of inventing a fragment', () => {
    const { fragments } = digestFragments(doc(bases, 'linear'), [BsaI])
    expect(fragments.map(f => f.sequence.length)).toEqual([306])
    expect(computeFragments(306, findCutSites(bases, BsaI, 'linear'), 'linear')).toEqual([306])
  })

  it('still cuts at a site whose cut falls inside the molecule', () => {
    const inside = filler(50) + 'GGTCTC' + filler(50)
    const { fragments } = digestFragments(doc(inside, 'linear'), [BsaI])
    expect(fragments.map(f => f.sequence.length)).toEqual([57, 49])
  })
})
