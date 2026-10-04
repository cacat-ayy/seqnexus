/**
 * The oligos have to actually work: amplifying the parts with them and
 * assembling the products must give back the construct that was designed.
 * So each case here designs primers, builds the PCR products they would
 * give, and runs the real assembly engine over the result.
 */
import { describe, it, expect } from 'vitest'
import { reverseComplement } from '../models/complement'
import { getEnzyme } from '../enzymes/db'
import { designAssemblyOligos, designTypeIISOligos, type OligoTarget } from './oligos'
import { homologyAssemble, type HomologyPart } from './homology'
import { digest } from './cut'
import { assemble } from './assemble'
import { Sequence } from '../models/Sequence'
import type { DocumentState } from '../models/Document'

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

/** The product a primer pair gives on its template. */
function pcr(target: OligoTarget, pair: { forward: { sequence: string; anneal: string }; reverse: { sequence: string; anneal: string } }): string {
  const body = target.end > target.start
    ? target.template.slice(target.start, target.end)
    : target.template.slice(target.start) + target.template.slice(0, target.end)
  const fwdTail = pair.forward.sequence.slice(0, pair.forward.sequence.length - pair.forward.anneal.length)
  const revTail = pair.reverse.sequence.slice(0, pair.reverse.sequence.length - pair.reverse.anneal.length)
  return fwdTail + body + reverseComplement(revTail)
}

const part = (id: string, bases: string, topology: 'linear' | 'circular' = 'linear'): HomologyPart =>
  ({ id, name: id, bases, topology, annotations: [] })

describe('oligos for a seamless assembly', () => {
  // Three parts cut out of three different sequences, to be joined in a ring.
  const sources = [filler(900, 3), filler(1000, 11), filler(1100, 29)]
  const targets: OligoTarget[] = [
    { name: 'A', template: sources[0], topology: 'linear', start: 100, end: 600 },
    { name: 'B', template: sources[1], topology: 'linear', start: 200, end: 800 },
    { name: 'C', template: sources[2], topology: 'linear', start: 50, end: 700 },
  ]

  it('designs a pair per part, each carrying a tail', () => {
    const pairs = designAssemblyOligos(targets, { kit: 'hifi' })
    expect(pairs).toHaveLength(3)
    for (const pair of pairs) {
      expect(pair.forward.tail.length).toBeGreaterThan(0)
      expect(pair.reverse.tail.length).toBeGreaterThan(0)
      expect(pair.forward.anneal.length).toBeGreaterThanOrEqual(18)
      expect(pair.forward.tm).toBeGreaterThan(50)
      expect(pair.forward.sequence).toBe(pair.forward.tail + pair.forward.anneal)
      // A binding part that lands a few degrees cool is worth saying; being
      // unable to place one at all is not the same thing.
      expect(pair.warnings.join(' ')).not.toContain('No forward binding part')
      expect(pair.warnings.join(' ')).not.toContain('No reverse binding part')
    }
  })

  it('gives products that assemble into the intended circle', () => {
    const pairs = designAssemblyOligos(targets, { kit: 'hifi' })
    const products = targets.map((target, i) => pcr(target, pairs[i]))
    const result = homologyAssemble(products.map((bases, i) => part(targets[i].name, bases)), { kit: 'hifi' })

    const wanted = result.products.filter(p => p.usesAll && p.topology === 'circular')
    expect(wanted).toHaveLength(1)
    // Each part's own stretch survives in the product.
    for (const target of targets) {
      const body = target.template.slice(target.start, target.end)
      expect(wanted[0].sequence + wanted[0].sequence).toContain(body)
    }
  })

  it('makes the shared stretch as long as the kit asks for', () => {
    const pairs = designAssemblyOligos(targets, { kit: 'hifi', overlap: 30 })
    const products = targets.map((target, i) => pcr(target, pairs[i]))
    const result = homologyAssemble(products.map((bases, i) => part(targets[i].name, bases)), { kit: 'hifi' })
    const [wanted] = result.products.filter(p => p.usesAll && p.topology === 'circular')
    expect(wanted.junctions.every(j => j.overlap!.length >= 30)).toBe(true)
  })

  it('inserts into a circular vector, reading its arms across the origin', () => {
    const vector = filler(2000, 41)
    const insertSource = filler(800, 53)
    const ring: OligoTarget[] = [
      // The backbone, amplified right round the plasmid from one point.
      { name: 'backbone', template: vector, topology: 'circular', start: 500, end: 500 },
      { name: 'insert', template: insertSource, topology: 'linear', start: 100, end: 600 },
    ]
    const pairs = designAssemblyOligos(ring, { kit: 'hifi' })
    expect(pairs.every(p => p.warnings.length === 0)).toBe(true)
    expect(pairs[1].forward.tail).toBe(vector.slice(500 - 13, 500))
  })

  it('warns when a junction would melt below what Gibson needs', () => {
    const cool = filler(300, 7) + 'AT'.repeat(60) + filler(300, 9)
    const pairs = designAssemblyOligos(
      [
        { name: 'A', template: cool, topology: 'linear', start: 100, end: 340 },
        { name: 'B', template: cool, topology: 'linear', start: 340, end: 600 },
      ],
      { kit: 'gibson' },
    )
    expect(pairs.some(p => p.warnings.some(w => w.includes('°C')))).toBe(true)
  })
})

describe('oligos for a Type IIS assembly', () => {
  const BsaI = getEnzyme('BsaI')!
  // Sources with no BsaI site of their own, so the only sites are the ones
  // the primers add.
  const clean = (n: number, seed: number) =>
    filler(n, seed).replace(/GGTCTC/g, 'GGTCTA').replace(/GAGACC/g, 'GAGACT')
  const sources = [clean(800, 61), clean(900, 67)]
  const overhangs = ['AATG', 'GCTT']
  const targets: OligoTarget[] = [
    { name: 'part1', template: sources[0], topology: 'linear', start: 100, end: 500 },
    { name: 'part2', template: sources[1], topology: 'linear', start: 200, end: 700 },
  ]

  it('puts the site, a spacer and the overhang on each primer', () => {
    const pairs = designTypeIISOligos(targets, { enzyme: BsaI, overhangs })
    expect(pairs).toHaveLength(2)
    expect(pairs[0].forward.tail).toBe('GGTCTC' + 'A' + 'AATG')
    // The reverse primer is read along the bottom strand, so the site comes
    // out the right way round there too, ahead of the overhang's complement.
    expect(pairs[0].reverse.tail).toBe('GGTCTC' + 'T' + reverseComplement('GCTT'))
  })

  it('gives products whose digest leaves the designed overhangs', () => {
    const pairs = designTypeIISOligos(targets, { enzyme: BsaI, overhangs })
    const products = targets.map((target, i) => pcr(target, pairs[i]))

    const fragments = products.flatMap((bases, i) => {
      const doc: DocumentState = {
        name: targets[i].name,
        sequence: new Sequence(bases, 'linear'),
        annotations: [],
      }
      return digest(doc, [BsaI], { idPrefix: targets[i].name }).fragments
    })

    // The piece of each product between the two cuts carries the part.
    const bodies = fragments.filter(f => f.left?.span && f.right?.span)
    expect(bodies).toHaveLength(2)
    expect(bodies[0].left!.span).toBe('AATG')
    expect(bodies[0].right!.span).toBe(reverseComplement('GCTT'))
    expect(bodies[1].left!.span).toBe('GCTT')
    expect(bodies[1].right!.span).toBe(reverseComplement('AATG'))
  })

  it('assembles those pieces into one circle with no site left in it', () => {
    const pairs = designTypeIISOligos(targets, { enzyme: BsaI, overhangs })
    const products = targets.map((target, i) => pcr(target, pairs[i]))
    const fragments = products.flatMap((bases, i) =>
      digest(
        { name: targets[i].name, sequence: new Sequence(bases, 'linear'), annotations: [] },
        [BsaI],
        { idPrefix: targets[i].name },
      ).fragments,
    )

    const bodies = fragments.filter(f => f.left?.span && f.right?.span)
    const assemblies = assemble(bodies, {
      required: new Set(bodies.map((_, i) => i)),
      recutEnzymes: [BsaI],
    })
    const wanted = assemblies.filter(a => a.usesAll && a.topology === 'circular' && a.recut.length === 0)
    expect(wanted).toHaveLength(1)
    expect(wanted[0].sequence).not.toContain('GGTCTC')
    expect(wanted[0].sequence).not.toContain('GAGACC')
  })

  it('warns about a part that carries the enzyme site inside it', () => {
    const withSite = filler(200, 71) + 'GGTCTC' + filler(200, 73)
    const pairs = designTypeIISOligos(
      [{ name: 'bad', template: withSite, topology: 'linear', start: 50, end: 350 }],
      { enzyme: BsaI, overhangs: ['AATG'] },
    )
    expect(pairs[0].warnings.join(' ')).toContain('internal BsaI site')
  })
})
