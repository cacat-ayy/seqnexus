/**
 * A design is the saved thing and running it is always fresh, so these tests
 * go through `runDesign` the way the workspace will: build a design, run it,
 * and check the product and the explanation when there is none.
 */
import { describe, it, expect } from 'vitest'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { reverseComplement } from '../models/complement'
import {
  emptyDesign,
  partFromDoc,
  sanitizeDesign,
  partMatchesSource,
  sequenceHash,
  type CloningDesign,
  type DesignPart,
} from './design'
import { productDocument, productKey, runDesign, selectedProduct } from './run'
import { rotateAssembly } from './product'
import { PUC19_SEQUENCE } from '../demo'

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

const pad = (n: number) => 'AT'.repeat(Math.ceil(n / 2)).slice(0, n)

const doc = (
  name: string,
  bases: string,
  topology: 'linear' | 'circular' = 'linear',
  annotations: Annotation[] = [],
): DocumentState => ({ name, sequence: new Sequence(bases, topology), annotations })

const design = (over: Partial<CloningDesign>): CloningDesign => ({ ...emptyDesign(), ...over })

const part = (d: DocumentState, role: 'vector' | 'insert'): DesignPart =>
  ({ ...partFromDoc(d, { role }), role })

describe('restriction cloning through a design', () => {
  const vectorBases = pad(600) + 'GAATTC' + pad(20) + 'GGATCC' + pad(600)
  const core = 'AAAT'.repeat(100)
  const insertBases = pad(10) + 'GAATTC' + core + 'GGATCC' + pad(10)

  const base = design({
    method: 'restriction',
    enzymes: ['EcoRI', 'BamHI'],
    parts: [part(doc('pVec', vectorBases, 'circular'), 'vector'), part(doc('ins', insertBases), 'insert')],
  })

  it('gives the construct, with the backbone and the insert in it', () => {
    const result = runDesign(base)
    const product = selectedProduct(base, result.products)!
    expect(result.problems).toEqual([])
    expect(product.topology).toBe('circular')
    expect(product.usesAll).toBe(true)
    expect(product.sequence).toContain(core)
  })

  it('keeps the backbone of the vector, not the little piece between the sites', () => {
    const result = runDesign(base)
    const product = selectedProduct(base, result.products)!
    expect(product.size).toBeGreaterThan(vectorBases.length)
  })

  it('shows only the purified product by default, and the off-targets without', () => {
    const purified = runDesign(base)
    const everything = runDesign({ ...base, purify: false })
    expect(purified.products.length).toBeLessThan(everything.products.length)
    // The real product is there either way.
    expect(everything.products.some(p => p.sequence.includes(core) && p.topology === 'circular')).toBe(true)
  })

  it('says what is wrong when the enzymes do not cut a part', () => {
    const result = runDesign({ ...base, enzymes: ['XhoI'] })
    expect(result.products).toEqual([])
    expect(result.problems.join(' ')).toContain('does not cut')
  })

  it('asks for an enzyme when none is chosen', () => {
    expect(runDesign({ ...base, enzymes: [] }).problems.join(' ')).toContain('Choose the enzymes')
  })

  it('cuts each part with its own enzymes: BglII ends go into BamHI ends', () => {
    // AGATCT and GGATCC leave the same GATC overhang.
    const bgl = pad(10) + 'GAATTC' + core + 'AGATCT' + pad(10)
    const vector = { ...base.parts[0], enzymes: ['EcoRI', 'BamHI'] }
    const insert = { ...part(doc('bgl', bgl), 'insert'), enzymes: ['EcoRI', 'BglII'] }
    const d = design({ method: 'restriction', enzymes: [], parts: [vector, insert] })
    const result = runDesign(d)
    expect(result.problems).toEqual([])
    const product = selectedProduct(d, result.products)!
    expect(product.usesAll).toBe(true)
    expect(product.topology).toBe('circular')
    expect(product.sequence).toContain(core)
  })

  it('cuts a part with no enzymes of its own with the design’s', () => {
    const d = { ...base, parts: [{ ...base.parts[0], enzymes: ['EcoRI', 'BamHI'] }, base.parts[1]] }
    expect(selectedProduct(d, runDesign(d).products)?.usesAll).toBe(true)
  })

  it('names the part that still needs its sites picked', () => {
    const d = { ...base, enzymes: [], parts: [{ ...base.parts[0], enzymes: ['EcoRI'] }, base.parts[1]] }
    expect(runDesign(d).problems).toEqual(['Click the sites to cut ins at on its map.'])
  })

  it('takes the insert out of a donor plasmid, not the donor’s backbone', () => {
    const donorBackbone = filler(1500, 7).replace(/GAATTC|GGATCC/g, 'AAAAAA')
    const donor = part(doc('pDonor', 'GAATTC' + core + 'GGATCC' + donorBackbone, 'circular'), 'insert')
    const d = { ...base, parts: [base.parts[0], donor] }
    const product = selectedProduct(d, runDesign(d).products)!
    expect(product.usesAll).toBe(true)
    expect(product.sequence).toContain(core)
    expect(product.size).toBeLessThan(vectorBases.length + core.length + 20)
  })

  it('reports the fragments so the parts list can show them', () => {
    expect(runDesign(base).fragments.length).toBeGreaterThan(2)
  })
})

describe('Golden Gate through a design', () => {
  const A = 'AATG'
  const B = 'GCTT'
  const vectorBases = pad(400) + A + 'T' + 'GAGACC' + pad(30) + 'GGTCTC' + 'A' + B + pad(400)
  const partCore = 'AAAT'.repeat(60)
  const partBases = pad(10) + 'GGTCTC' + 'A' + A + partCore + B + 'T' + 'GAGACC' + pad(10)

  const base = design({
    method: 'golden-gate',
    typeIIS: 'BsaI',
    parts: [part(doc('pDest', vectorBases, 'circular'), 'vector'), part(doc('part1', partBases), 'insert')],
  })

  it('assembles, and keeps no enzyme site in the product', () => {
    const result = runDesign(base)
    const product = selectedProduct(base, result.products)!
    expect(product.topology).toBe('circular')
    expect(product.recut).toEqual([])
    expect(product.sequence).toContain(partCore)
  })

  it('scores the overhangs in play', () => {
    const result = runDesign(base)
    expect(result.fidelity).toBeDefined()
    expect(result.fidelity!.score).toBeGreaterThan(0.9)
    expect(result.fidelity!.notes).toEqual([])
  })
})

describe('seamless assembly through a design', () => {
  const vector = filler(1500, 7)
  const at = 600
  const arm = 25
  const payload = filler(400, 23)
  const insert = vector.slice(at - arm, at) + payload + vector.slice(at, at + arm)

  const base = design({
    method: 'homology',
    kit: 'hifi',
    parts: [part(doc('pVec', vector, 'circular'), 'vector'), part(doc('ins', insert), 'insert')],
  })

  it('opens the plasmid and puts the payload in', () => {
    const result = runDesign(base)
    const product = selectedProduct(base, result.products)!
    expect(product.size).toBe(vector.length + payload.length)
    expect(product.sequence + product.sequence).toContain(payload)
  })

  it('explains the lack of homology rather than failing silently', () => {
    const stranger = design({
      method: 'homology',
      parts: [part(doc('a', filler(600, 2)), 'insert'), part(doc('b', filler(600, 99)), 'insert')],
    })
    const result = runDesign(stranger)
    expect(result.products).toEqual([])
    expect(result.problems.join(' ')).toContain('No homology')
  })

  it('takes a region of a sequence as the part', () => {
    const source = doc('src', filler(400, 3) + insert + filler(400, 5))
    const region = { start: 400, end: 400 + insert.length }
    const result = runDesign(design({
      method: 'homology',
      parts: [
        part(doc('pVec', vector, 'circular'), 'vector'),
        { ...partFromDoc(source, { role: 'insert', region }), role: 'insert' },
      ],
    }))
    expect(selectedProduct(base, result.products)!.size).toBe(vector.length + payload.length)
  })

  it('pins a part to one orientation when told to', () => {
    const flipped = part(doc('ins', reverseComplement(insert)), 'insert')
    const free = runDesign(design({
      method: 'homology',
      parts: [part(doc('pVec', vector, 'circular'), 'vector'), flipped],
    }))
    expect(free.products.some(p => p.usesAll)).toBe(true)

    const pinned = runDesign(design({
      method: 'homology',
      parts: [
        part(doc('pVec', vector, 'circular'), 'vector'),
        { ...flipped, orientation: 'forward' },
      ],
    }))
    expect(pinned.products.some(p => p.usesAll)).toBe(false)
  })
})

describe('choosing and opening a product', () => {
  const vector = filler(1200, 11)
  const at = 500
  const payload = filler(300, 13)
  const insert = vector.slice(at - 25, at) + payload + vector.slice(at, at + 25)
  const vectorDoc = doc('pVec', vector, 'circular', [
    new Annotation({ id: 'amp', name: 'AmpR', type: 'CDS', start: 60, end: 400, strand: 1 }),
  ])
  const base = design({
    method: 'homology',
    parts: [part(vectorDoc, 'vector'), part(doc('ins', insert), 'insert')],
  })

  it('remembers which product was chosen across a re-run', () => {
    const first = runDesign(base)
    const chosen = first.products[first.products.length - 1]
    const withChoice = { ...base, selected: productKey(chosen) }
    const second = runDesign(withChoice)
    expect(selectedProduct(withChoice, second.products)!.sequence).toBe(chosen.sequence)
  })

  it('falls back to the best product when the chosen one is gone', () => {
    const stale = { ...base, selected: 'circular:NOTHINGLIKETHIS' }
    const result = runDesign(stale)
    expect(selectedProduct(stale, result.products)).toBe(result.products[0])
  })

  it('opens as a document that says where it came from', () => {
    const result = runDesign(base)
    const state = productDocument(base, selectedProduct(base, result.products)!)
    expect(state.sequence.topology).toBe('circular')
    expect(state.metadata?.origin).toBe('cloning')
    expect(state.description).toContain('pVec')
    expect(state.annotations.some(a => a.name === 'AmpR')).toBe(true)
  })

  it('carries the backbone methylation onto the product', () => {
    const methylated = doc('pVec', vector, 'circular')
    methylated.metadata = { damMethylated: true }
    const withMeth = design({
      method: 'homology',
      parts: [part(methylated, 'vector'), part(doc('ins', insert), 'insert')],
    })
    const result = runDesign(withMeth)
    const state = productDocument(withMeth, selectedProduct(withMeth, result.products)!)
    expect(state.metadata?.damMethylated).toBe(true)
  })
})

describe('a design read back from storage', () => {
  it('survives a round trip through JSON', () => {
    const original = design({
      method: 'golden-gate',
      typeIIS: 'BsmBI',
      parts: [part(doc('v', filler(300, 3), 'circular'), 'vector')],
      selected: 'circular:ACGT',
    })
    const back = sanitizeDesign(JSON.parse(JSON.stringify(original)))!
    expect(back.method).toBe('golden-gate')
    expect(back.typeIIS).toBe('BsmBI')
    expect(back.parts).toHaveLength(1)
    expect(back.parts[0].topology).toBe('circular')
    expect(back.selected).toBe('circular:ACGT')
  })

  it('keeps the sites picked on each part', () => {
    const original = design({
      method: 'restriction',
      parts: [{ ...part(doc('v', filler(300, 3), 'circular'), 'vector'), enzymes: ['BamHI', 'EagI'] }],
    })
    const back = sanitizeDesign(JSON.parse(JSON.stringify(original)))!
    expect(back.parts[0].enzymes).toEqual(['BamHI', 'EagI'])
    expect(sanitizeDesign({ parts: [{ name: 'x', bases: 'ACGT', enzymes: [1, 2] }] })!.parts[0].enzymes).toBeUndefined()
  })

  it('throws nothing away but what it cannot read', () => {
    const back = sanitizeDesign({
      method: 'nonsense',
      kit: 'nonsense',
      parts: [{ name: 'ok', bases: 'ACGT' }, { name: 'no bases' }, 'rubbish'],
    })!
    expect(back.method).toBe('homology')
    expect(back.kit).toBe('hifi')
    expect(back.parts).toHaveLength(1)
    expect(back.parts[0].orientation).toBe('auto')
  })

  it('refuses something that is not a design at all', () => {
    expect(sanitizeDesign(null)).toBeNull()
    expect(sanitizeDesign('a design')).toBeNull()
  })
})

describe('spotting a source that has changed', () => {
  it('gives the same fingerprint for the same sequence and a different one otherwise', () => {
    expect(sequenceHash('ACGTACGT', 'circular')).toBe(sequenceHash('acgtacgt', 'circular'))
    expect(sequenceHash('ACGTACGT', 'circular')).not.toBe(sequenceHash('ACGTACGT', 'linear'))
    expect(sequenceHash('ACGTACGT', 'linear')).not.toBe(sequenceHash('ACGTACGA', 'linear'))
  })

  it('records the source and its fingerprint when a part is taken from a tab', () => {
    const taken = partFromDoc(doc('src', 'ACGTACGTAA'), { sourceId: 'tab_1' })
    expect(taken.source).toEqual({ id: 'tab_1', hash: sequenceHash('ACGTACGTAA', 'linear') })
  })
})

describe('telling when a part no longer matches its source', () => {
  const bases = filler(600, 5)

  it('matches an untouched sequence', () => {
    const p = partFromDoc(doc('src', bases, 'circular'), { sourceId: 'tab_1' })
    expect(partMatchesSource(p, bases, 'circular')).toBe(true)
  })

  it('ignores a difference in case, which is not an edit', () => {
    const p = partFromDoc(doc('src', bases, 'circular'), { sourceId: 'tab_1' })
    expect(partMatchesSource(p, bases.toLowerCase(), 'circular')).toBe(true)
  })

  it('spots an edited base', () => {
    const p = partFromDoc(doc('src', bases), { sourceId: 'tab_1' })
    const edited = `${bases.slice(0, 100)}${bases[100] === 'A' ? 'C' : 'A'}${bases.slice(101)}`
    expect(partMatchesSource(p, edited, 'linear')).toBe(false)
  })

  it('spots a sequence that has been made circular since', () => {
    const p = partFromDoc(doc('src', bases), { sourceId: 'tab_1' })
    expect(partMatchesSource(p, bases, 'circular')).toBe(false)
  })

  it('checks only the region a part was taken from', () => {
    const region = { start: 100, end: 300 }
    const p = partFromDoc(doc('src', bases, 'circular'), { sourceId: 'tab_1', region })
    expect(partMatchesSource(p, bases, 'circular')).toBe(true)
    // An edit outside the region leaves the part alone.
    const elsewhere = `${bases.slice(0, 500)}${bases[500] === 'A' ? 'C' : 'A'}${bases.slice(501)}`
    expect(partMatchesSource(p, elsewhere, 'circular')).toBe(true)
    // One inside it does not.
    const inside = `${bases.slice(0, 200)}${bases[200] === 'A' ? 'C' : 'A'}${bases.slice(201)}`
    expect(partMatchesSource(p, inside, 'circular')).toBe(false)
  })
})

describe('a product numbered like its vector', () => {
  it('starts at the vector’s first base, as the vector does', () => {
    const insert = 'GAATTC' + 'AAAT'.repeat(60) + 'AAGCTT'
    const d = design({
      method: 'restriction',
      enzymes: ['EcoRI', 'HindIII'],
      parts: [
        part(doc('pUC19', PUC19_SEQUENCE, 'circular', [new Annotation({ id: 'amp', name: 'AmpR', type: 'CDS', start: 1625, end: 2486, strand: -1, color: '#f00' })]), 'vector'),
        part(doc('ins', 'CC' + insert + 'GG'), 'insert'),
      ],
    })
    const product = selectedProduct(d, runDesign(d).products)!
    expect(product.usesAll).toBe(true)
    // Everything before the EcoRI site keeps its numbering.
    expect(product.sequence.slice(0, 390)).toBe(PUC19_SEQUENCE.slice(0, 390))
    // AmpR, after the insertion, moves by what went in less what came out.
    const amp = product.annotations.find(a => a.name === 'AmpR')!
    const shift = product.size - PUC19_SEQUENCE.length
    expect(amp.start).toBe(1625 + shift)
    expect(amp.end).toBe(2486 + shift)
    // The junctions are where the sites are.
    for (const j of product.junctions) {
      const around = product.sequence.slice(j.at - 5, j.at + 5)
      expect(/GAATTC|AAGCTT/.test(around)).toBe(true)
    }
  })
})

describe('turning a circular product', () => {
  const base = {
    name: 'p', description: '', topology: 'circular' as const, size: 10, sequence: 'ABCDEFGHIJ',
    annotations: [{ id: 'f', name: 'f', type: 'misc_feature', start: 2, end: 6, strand: 1 as const, color: '#000' }],
    parts: [{ fragmentId: 'a', name: 'a', sourceName: 'a', reversed: false, start: 0, end: 6 },
      { fragmentId: 'b', name: 'b', sourceName: 'b', reversed: false, start: 6, end: 10 }],
    junctions: [{ leftPart: 0, rightPart: 1, at: 6 }, { leftPart: 1, rightPart: 0, at: 0 }],
    usesAll: true, nicked: false, recut: [], warnings: [],
  }

  it('moves the bases, the features, the parts and the junctions together', () => {
    const r = rotateAssembly(base, 4)
    expect(r.sequence).toBe('EFGHIJABCD')
    expect(r.annotations[0]).toMatchObject({ start: 8, end: 2 })
    expect(r.parts.map(p => [p.start, p.end])).toEqual([[6, 2], [2, 6]])
    expect(r.junctions.map(j => j.at)).toEqual([2, 6])
    expect(r.sequence.slice(r.junctions[0].at, r.junctions[0].at + 1)).toBe('G')
  })

  it('leaves a linear product alone', () => {
    expect(rotateAssembly({ ...base, topology: 'linear' }, 3)).toEqual({ ...base, topology: 'linear' })
  })
})
