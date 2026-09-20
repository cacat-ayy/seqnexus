import { describe, it, expect } from 'vitest'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { topoClone } from './topo'

function makeDoc(
  name: string,
  bases: string,
  topology: 'linear' | 'circular' = 'linear',
  annotations: Annotation[] = [],
): DocumentState {
  return { name, sequence: new Sequence(bases, topology), annotations }
}

// A vector with a TOPO site (CCCTT)
function makeTopoVector(prefix = 'AAAAAAAAAA', suffix = 'TTTTTTTTTT', topology: 'linear' | 'circular' = 'circular'): DocumentState {
  return makeDoc('pCR-TOPO', prefix + 'CCCTT' + suffix, topology)
}

// A Directional TOPO vector with CCCTT + GTGG
function makeDirectionalVector(): DocumentState {
  return makeDoc('pENTR-D-TOPO', 'AAAAAAAAAA' + 'CCCTT' + 'GTGG' + 'TTTTTTTTTT', 'circular')
}

// ---------------------------------------------------------------------------
// TOPO-TA
// ---------------------------------------------------------------------------

describe('topoClone TA', () => {
  it('produces both orientations for TA-compatible insert', () => {
    // Insert with 3' A-overhangs: starts with T (complement of A on antisense 3' end), ends with A
    const insert = makeDoc('pcr-product', 'TATGCCCGGGA')
    const vector = makeTopoVector()

    const result = topoClone({ variant: 'TA', insert: { doc: insert }, vector: { doc: vector } })

    expect(result.products).toHaveLength(2)
    const fwd = result.products.find(p => p.description.includes('forward'))
    const rev = result.products.find(p => p.description.includes('reverse'))
    expect(fwd).toBeDefined()
    expect(rev).toBeDefined()
    // Neither should be flagged as expected (random orientation)
    expect(fwd!.isExpected).toBe(false)
    expect(rev!.isExpected).toBe(false)
  })

  it('validates 3\' A-overhangs', () => {
    const goodInsert = makeDoc('good', 'TATGCCCGGGA') // T...A → valid
    const badInsert = makeDoc('bad', 'GATGCCCGGGG') // G...G → informational note
    const vector = makeTopoVector()

    const goodResult = topoClone({ variant: 'TA', insert: { doc: goodInsert }, vector: { doc: vector } })
    expect(goodResult.insertValidation.valid).toBe(true)
    expect(goodResult.insertValidation.message).toContain('A-overhang')

    // Without A-overhangs: still valid (Taq adds them during PCR) but with a note
    const badResult = topoClone({ variant: 'TA', insert: { doc: badInsert }, vector: { doc: vector } })
    expect(badResult.insertValidation.valid).toBe(true)
    expect(badResult.insertValidation.message).toContain('Taq')
  })

  it('warns when no TOPO site found on vector', () => {
    const insert = makeDoc('pcr', 'TATGCCCGGGA')
    const vector = makeDoc('bad-vector', 'AAAAAATTTTTT', 'circular') // no CCCTT

    const result = topoClone({ variant: 'TA', insert: { doc: insert }, vector: { doc: vector } })

    expect(result.products).toHaveLength(0)
    expect(result.topoSite).toBeNull()
    expect(result.warnings.some(w => w.includes('CCCTT'))).toBe(true)
  })

  it('inserts at the TOPO site position', () => {
    const insert = makeDoc('pcr', 'TATGA')
    const vector = makeTopoVector('GGGG', 'CCCC')

    const result = topoClone({ variant: 'TA', insert: { doc: insert }, vector: { doc: vector } })

    expect(result.topoSite).toBeDefined()
    expect(result.topoSite!.start).toBe(4) // GGGG then CCCTT starts at 4
    // Forward product: vector-left + insert + vector-right
    const fwd = result.products.find(p => p.description.includes('forward'))
    expect(fwd).toBeDefined()
    expect(fwd!.sequence).toBe('GGGG' + 'CCCTT' + 'TATGA' + 'CCCC')
  })

  it('transfers annotations from insert and vector', () => {
    const insertAnn = new Annotation({ id: 'gfp', name: 'GFP', type: 'CDS', start: 1, end: 4, strand: 1 })
    const vectorAnn = new Annotation({ id: 'amp', name: 'AmpR', type: 'CDS', start: 0, end: 3, strand: 1 })
    const insert = makeDoc('pcr', 'TATGA', 'linear', [insertAnn])
    const vector = makeDoc('vec', 'GGGG' + 'CCCTT' + 'CCCC', 'circular', [vectorAnn])

    const result = topoClone({ variant: 'TA', insert: { doc: insert }, vector: { doc: vector } })

    const fwd = result.products.find(p => p.description.includes('forward'))
    expect(fwd).toBeDefined()
    expect(fwd!.annotations.some(a => a.name === 'GFP')).toBe(true)
    expect(fwd!.annotations.some(a => a.name === 'AmpR')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// TOPO-Blunt
// ---------------------------------------------------------------------------

describe('topoClone Blunt', () => {
  it('produces both orientations for blunt-ended insert', () => {
    const insert = makeDoc('pcr', 'GATGCCCGGGG') // no A-overhangs
    const vector = makeTopoVector()

    const result = topoClone({ variant: 'Blunt', insert: { doc: insert }, vector: { doc: vector } })

    expect(result.products).toHaveLength(2)
    expect(result.insertValidation.valid).toBe(true)
  })

  it('suggests TA when insert has A-overhangs', () => {
    const insert = makeDoc('pcr', 'TATGCCCGGGA') // has A-overhangs
    const vector = makeTopoVector()

    const result = topoClone({ variant: 'Blunt', insert: { doc: insert }, vector: { doc: vector } })

    expect(result.insertValidation.message).toContain('TOPO-TA')
  })
})

// ---------------------------------------------------------------------------
// Directional TOPO
// ---------------------------------------------------------------------------

describe('topoClone Directional', () => {
  it('produces single forward orientation', () => {
    const insert = makeDoc('pcr', 'CACCATGCCCGGG') // starts with CACC
    const vector = makeDirectionalVector()

    const result = topoClone({ variant: 'Directional', insert: { doc: insert }, vector: { doc: vector } })

    expect(result.products).toHaveLength(1)
    expect(result.products[0].isExpected).toBe(true)
    expect(result.products[0].description).toContain('forward')
  })

  it('validates 5\' CACC overhang', () => {
    const goodInsert = makeDoc('good', 'CACCATGCCCGGG')
    const badInsert = makeDoc('bad', 'ATGCCCGGG') // no CACC
    const vector = makeDirectionalVector()

    const goodResult = topoClone({ variant: 'Directional', insert: { doc: goodInsert }, vector: { doc: vector } })
    expect(goodResult.insertValidation.valid).toBe(true)

    const badResult = topoClone({ variant: 'Directional', insert: { doc: badInsert }, vector: { doc: vector } })
    expect(badResult.insertValidation.valid).toBe(false)
    expect(badResult.warnings.some(w => w.includes('CACC'))).toBe(true)
  })

  it('warns when vector lacks GTGG overhang', () => {
    const insert = makeDoc('pcr', 'CACCATGCCCGGG')
    const vector = makeTopoVector() // has CCCTT but no GTGG after it

    const result = topoClone({ variant: 'Directional', insert: { doc: insert }, vector: { doc: vector } })

    expect(result.warnings.some(w => w.includes('GTGG'))).toBe(true)
  })

  it('trims CACC from insert in forward product', () => {
    const insert = makeDoc('pcr', 'CACCATG')
    const vector = makeDoc('vec', 'GGGG' + 'CCCTT' + 'GTGG' + 'CCCC', 'circular')

    const result = topoClone({ variant: 'Directional', insert: { doc: insert }, vector: { doc: vector } })

    const product = result.products[0]
    // CACC should be trimmed from the insert
    expect(product.sequence).toContain('ATG')
    expect(product.sequence).not.toContain('CACCATG')
  })
})
