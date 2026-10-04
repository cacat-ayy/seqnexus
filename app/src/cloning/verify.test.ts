/**
 * A construct is confirmed at its seams, so the plan is one read across each.
 * What matters is that the seam lands in the readable middle of the trace,
 * not in the first fifty bases, and that a junction nobody can read is said
 * out loud rather than skipped.
 */
import { describe, it, expect } from 'vitest'
import { Sequence } from '../models/Sequence'
import type { DocumentState } from '../models/Document'
import { emptyDesign, partFromDoc, type CloningDesign, type DesignPart } from './design'
import { runDesign, selectedProduct } from './run'
import { planJunctionReads } from './verify'

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

const doc = (name: string, bases: string, topology: 'linear' | 'circular' = 'linear'): DocumentState =>
  ({ name, sequence: new Sequence(bases, topology), annotations: [] })

const part = (name: string, bases: string, role: 'vector' | 'insert', topology: 'linear' | 'circular' = 'linear'): DesignPart =>
  ({ ...partFromDoc(doc(name, bases, topology), { role }), role })

const VECTOR = filler(2400, 7)
const AT = 900
const ARM = 25
const PAYLOAD = filler(700, 23)
const INSERT = VECTOR.slice(AT - ARM, AT) + PAYLOAD + VECTOR.slice(AT, AT + ARM)

const design: CloningDesign = {
  ...emptyDesign('homology'),
  kit: 'hifi',
  parts: [part('pVec', VECTOR, 'vector', 'circular'), part('ins', INSERT, 'insert')],
}

const built = () => {
  const result = runDesign(design)
  return selectedProduct(design, result.products)!
}

describe('planning the reads that confirm a construct', () => {
  it('places one primer per junction', () => {
    const product = built()
    const plan = planJunctionReads(product)
    expect(product.junctions.length).toBeGreaterThan(0)
    expect(plan.reads).toHaveLength(product.junctions.length)
    expect(plan.uncovered).toEqual([])
  })

  it('reads across the seam rather than up to it', () => {
    const product = built()
    for (const read of planJunctionReads(product).reads) {
      const { start, end } = read.primer.read
      const size = product.sequence.length
      const to = end > start ? end : end + size
      const seam = read.at >= start ? read.at : read.at + size
      expect(seam).toBeGreaterThan(start)
      expect(seam).toBeLessThan(to)
    }
  })

  it('leaves room before the seam, so it does not land in the unreadable start', () => {
    const product = built()
    for (const read of planJunctionReads(product).reads) {
      const size = product.sequence.length
      const seam = read.at >= read.primer.read.start ? read.at : read.at + size
      expect(seam - read.primer.read.start).toBeGreaterThan(20)
    }
  })

  it('gives each read a name that says which junction it is for', () => {
    const plan = planJunctionReads(built())
    expect(plan.reads[0].name).toContain('junction 1')
  })

  it('gives primers that actually anneal to the construct', () => {
    const product = built()
    for (const read of planJunctionReads(product).reads) {
      const doubled = product.sequence + product.sequence
      expect(doubled).toContain(read.primer.sequence)
      expect(read.primer.tm).toBeGreaterThan(45)
    }
  })

  it('says so when there is nothing to check', () => {
    const lone = runDesign({ ...design, parts: [design.parts[0]] })
    const product = selectedProduct(design, lone.products)
    if (product) {
      const plan = planJunctionReads(product)
      if (product.junctions.length === 0) {
        expect(plan.warnings.join(' ')).toContain('no junctions')
      }
    }
  })
})
