/**
 * Whole cloning reactions, run the way someone would run them.
 *
 * Every case here is a design that must produce a product. The ones with
 * non-palindromic overhangs (a single sticky cut religated, and any Type IIS
 * assembly) used to produce nothing at all, so they are the point of the
 * suite. Filler is A/T only, which cannot contain any of the recognition
 * sites used, so the cuts are only where the test puts them.
 */
import { describe, it, expect } from 'vitest'
import { Sequence } from '../models/Sequence'
import type { DocumentState } from '../models/Document'
import { getEnzyme } from '../enzymes/db'
import { digest } from './cut'
import { assemble, canonical } from './assemble'
import { dephosphorylate, linearFragment, type Fragment } from './fragment'

const EcoRI = getEnzyme('EcoRI')!
const BamHI = getEnzyme('BamHI')!
const HinfI = getEnzyme('HinfI')!
const BsaI = getEnzyme('BsaI')!

const pad = (n: number) => 'AT'.repeat(Math.ceil(n / 2)).slice(0, n)
/** Filler that is not its own reverse complement, so flipping changes it. */
const asym = (n: number) => 'AAAT'.repeat(Math.ceil(n / 4)).slice(0, n)

const doc = (name: string, bases: string, topology: 'linear' | 'circular' = 'linear'): DocumentState =>
  ({ name, sequence: new Sequence(bases, topology), annotations: [] })

const expected = (products: ReturnType<typeof assemble>) =>
  products.filter(p => p.usesAll && p.topology === 'circular' && p.recut.length === 0)

describe('religating a single sticky cut', () => {
  // HinfI (G^ANT_C) leaves a 3-base overhang that is not its own complement.
  // Nothing about this is exotic: it is a plasmid cut once and closed again.
  const bases = pad(100) + 'GAATC' + pad(95)
  const { fragments } = digest(doc('p', bases, 'circular'), [HinfI])

  it('cuts the circle open into one piece', () => {
    expect(fragments).toHaveLength(1)
    expect(fragments[0].left!.span).toBe('AAT')
    expect(fragments[0].right!.span).toBe('ATT')
  })

  it('closes it again into the plasmid it came from', () => {
    const products = assemble(fragments)
    const circles = products.filter(p => p.topology === 'circular')
    expect(circles).toHaveLength(1)
    expect(circles[0].size).toBe(bases.length)
    expect(canonical(circles[0].sequence, true)).toBe(canonical(bases, true))
  })
})

describe('directional restriction cloning', () => {
  // The textbook reaction: cut vector and insert with the same two enzymes,
  // so the insert can only go in one way round.
  const vectorBases = pad(500) + 'GAATTC' + pad(20) + 'GGATCC' + pad(500)
  const insertCore = asym(300)
  const insertBases = pad(10) + 'GAATTC' + insertCore + 'GGATCC' + pad(10)

  const vector = digest(doc('pVec', vectorBases, 'circular'), [EcoRI, BamHI]).fragments
  const insert = digest(doc('ins', insertBases), [EcoRI, BamHI]).fragments
  const backbone = vector.reduce((a, b) => (a.top.length > b.top.length ? a : b))
  const middle = insert.find(f => f.top.includes(insertCore))!

  const all = [...vector, ...insert]
  const required = new Set([all.indexOf(backbone), all.indexOf(middle)])

  it('gives exactly one product made of the backbone and the insert', () => {
    // No recut check: ordinary restriction cloning rebuilds both sites at the
    // junctions, and the enzymes are long gone before the DNA goes anywhere.
    const products = assemble(all, { required })
    const wanted = expected(products)
    expect(wanted).toHaveLength(1)
    expect(wanted[0].size).toBe(backbone.top.length + middle.top.length)
    expect(wanted[0].sequence).toContain(insertCore)
  })

  it('does not let the insert into the vector backwards', () => {
    // Two different overhangs is what makes the cloning directional. Other
    // off-target circles can still contain a flipped insert (the excised
    // polylinker joined to it, for one), so this is about the real product.
    const wanted = expected(assemble(all, { required }))
    expect(wanted.every(p => p.parts.every(part => !part.reversed))).toBe(true)
  })

  it('also finds the vector closing on its own polylinker again', () => {
    const products = assemble(all)
    const religated = products.find(p => p.topology === 'circular' && p.size === vectorBases.length)
    expect(religated).toBeDefined()
  })

  it('reports each distinct product once instead of every path to it', () => {
    const products = assemble(all, { required })
    const keys = new Set(products.map(p => `${p.topology}:${canonical(p.sequence, p.topology === 'circular')}`))
    expect(keys.size).toBe(products.length)
  })
})

describe('Type IIS assembly', () => {
  // A destination vector and a part, each with the enzyme reading outwards so
  // the cuts fall in the piece that is kept. The overhangs are AATG and GCTT:
  // four bases, neither its own complement.
  const A = 'AATG'
  const B = 'GCTT'
  const vectorBases = pad(400) + A + 'T' + 'GAGACC' + pad(30) + 'GGTCTC' + 'A' + B + pad(400)
  const partCore = asym(200)
  const partBases = pad(10) + 'GGTCTC' + 'A' + A + partCore + B + 'T' + 'GAGACC' + pad(10)

  const vector = digest(doc('pDest', vectorBases, 'circular'), [BsaI]).fragments
  const part = digest(doc('part', partBases), [BsaI]).fragments
  const backbone = vector.reduce((a, b) => (a.top.length > b.top.length ? a : b))
  const insert = part.find(f => f.top.includes(partCore))!

  it('cuts clean four-base overhangs onto the pieces that are kept', () => {
    expect(backbone.left!.span).toBe(B)
    expect(backbone.right!.span).toBe('CATT') // complement of AATG
    expect(insert.left!.span).toBe(A)
    expect(insert.right!.span).toBe('AAGC') // complement of GCTT
  })

  const all = [...vector, ...part]
  const required = new Set([all.indexOf(backbone), all.indexOf(insert)])

  it('assembles the backbone and the part into one circle', () => {
    const products = assemble(all, { required, recutEnzymes: [BsaI] })
    const wanted = expected(products)
    expect(wanted).toHaveLength(1)
    expect(wanted[0].size).toBe(backbone.top.length + insert.top.length)
    expect(wanted[0].sequence).toContain(partCore)
  })

  it('leaves no enzyme site in the product, so the reaction keeps it', () => {
    const [wanted] = expected(assemble(all, { required, recutEnzymes: [BsaI] }))
    expect(wanted.sequence).not.toContain('GGTCTC')
    expect(wanted.sequence).not.toContain('GAGACC')
    expect(wanted.recut).toEqual([])
  })

  it('marks the re-formed vector as something the reaction cuts open again', () => {
    const products = assemble(all, { required, recutEnzymes: [BsaI] })
    const reformed = products.find(p => p.topology === 'circular' && p.size === vectorBases.length)
    expect(reformed).toBeDefined()
    expect(reformed!.recut).toEqual(['BsaI'])
  })
})

describe('an insert with the same overhang at both ends', () => {
  // Asymmetric filler on the vector too: a vector that reads the same on both
  // strands would make the two orientations the same molecule.
  const vectorBases = asym(400) + 'GAATTC' + asym(400)
  const insertCore = asym(100)
  const insertBases = pad(10) + 'GAATTC' + insertCore + 'GAATTC' + pad(10)

  const vector = digest(doc('pVec', vectorBases, 'circular'), [EcoRI]).fragments
  const insert = digest(doc('ins', insertBases), [EcoRI]).fragments
  const middle = insert.find(f => f.top.includes(insertCore))!
  const all = [vector[0], middle]

  it('goes in both ways round, and both products are reported', () => {
    const products = assemble(all, { required: new Set([0, 1]) })
    const wanted = expected(products)
    expect(wanted).toHaveLength(2)
    expect(wanted[0].size).toBe(wanted[1].size)
    expect(wanted.some(p => p.parts.some(part => part.reversed))).toBe(true)
  })
})

describe('dephosphorylated vector', () => {
  const vectorBases = pad(400) + 'GAATTC' + pad(400)
  const insertCore = asym(100)
  const insertBases = pad(10) + 'GAATTC' + insertCore + 'GAATTC' + pad(10)

  const cutVector = digest(doc('pVec', vectorBases, 'circular'), [EcoRI]).fragments[0]
  const insert = digest(doc('ins', insertBases), [EcoRI]).fragments
    .find(f => f.top.includes(insertCore))!

  it('cannot close on itself', () => {
    const products = assemble([dephosphorylate(cutVector)])
    expect(products.filter(p => p.topology === 'circular')).toHaveLength(0)
  })

  it('still takes an insert, leaving one nick at each junction', () => {
    const products = assemble([dephosphorylate(cutVector), insert], { required: new Set([0, 1]) })
    const wanted = expected(products)
    expect(wanted.length).toBeGreaterThan(0)
    expect(wanted[0].nicked).toBe(true)
    expect(wanted[0].junctions.every(j => j.sealed === 1)).toBe(true)
  })

  it('is told apart from the same reaction with phosphates left on', () => {
    const products = assemble([cutVector, insert], { required: new Set([0, 1]) })
    expect(expected(products)[0].nicked).toBe(false)
  })
})

describe('blunt ends', () => {
  const source = { name: 'b', start: 0, end: 0, circular: false }
  const left: Fragment = linearFragment('a', 'a', asym(200), { ...source, name: 'armA' })
  const right: Fragment = linearFragment('b', 'b', 'CCGGCCGG' + asym(92), { ...source, name: 'armB' })

  it('joins two blunt fragments into a circle', () => {
    const products = assemble([left, right], { required: new Set([0, 1]) })
    const wanted = expected(products)
    expect(wanted.length).toBeGreaterThan(0)
    expect(wanted[0].size).toBe(left.top.length + right.top.length)
  })

  it('does not join a blunt end to a sticky one', () => {
    const sticky = linearFragment('s', 's', 'AATT' + asym(96), source, {
      left: { span: 'AATT', kind: 'five_prime', phosphate: true },
      right: { span: 'AATT', kind: 'five_prime', phosphate: true },
    })
    const products = assemble([left, sticky], { required: new Set([0, 1]), allowSelfLigation: false })
    expect(products.filter(p => p.parts.length === 2)).toHaveLength(0)
  })
})

describe('self-ligation can be turned off', () => {
  const bases = pad(100) + 'GAATC' + pad(95)
  const { fragments } = digest(doc('p', bases, 'circular'), [HinfI])

  it('leaves no product when the only one would be the piece closing on itself', () => {
    expect(assemble(fragments, { allowSelfLigation: false })).toHaveLength(0)
  })
})

describe('canonical', () => {
  it('sees through rotation of a circle', () => {
    const s = 'ATGGCCTTAAGG'
    expect(canonical(s, true)).toBe(canonical(s.slice(5) + s.slice(0, 5), true))
  })

  it('sees through which strand a molecule is written on', () => {
    const s = 'ATGGCCTTAAGG'
    expect(canonical(s, false)).toBe(canonical('CCTTAAGGCCAT', false))
  })

  it('tells different molecules apart', () => {
    expect(canonical('ATGGCCTTAAGG', true)).not.toBe(canonical('ATGGCCTTAAGC', true))
  })
})
