import { describe, it, expect } from 'vitest'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { infusionAssemble } from './infusion'

function makeDoc(
  name: string,
  bases: string,
  topology: 'linear' | 'circular' = 'linear',
  annotations: Annotation[] = [],
): DocumentState {
  return { name, sequence: new Sequence(bases, topology), annotations }
}

describe('infusionAssemble', () => {
  it('assembles two fragments with 15 bp overlap', () => {
    const overlap = 'ATGCATGCATGCATG' // 15bp
    const fragA = makeDoc('A', 'AAAAAAAAAA' + overlap)
    const fragB = makeDoc('B', overlap + 'TTTTTTTTTT')

    const result = infusionAssemble({
      fragments: [{ doc: fragA }, { doc: fragB }],
    })

    expect(result.products.length).toBeGreaterThanOrEqual(1)
    const product = result.products[0]
    expect(product.sequence).toBe('AAAAAAAAAA' + overlap + 'TTTTTTTTTT')
    expect(product.description).toContain('In-Fusion')
  })

  it('does not produce Tm warnings', () => {
    // AT-rich overlap that would trigger Tm warning in Gibson
    const overlap = 'AAAAAATTTTTTAAAAA' // 17bp, all AT → low Tm
    const fragA = makeDoc('A', 'GCGCGCGCGC' + overlap)
    const fragB = makeDoc('B', overlap + 'GCGCGCGCGC')

    const result = infusionAssemble({
      fragments: [{ doc: fragA }, { doc: fragB }],
    })

    // Should NOT have Tm warnings
    expect(result.warnings.every(w => !w.includes('Tm') && !w.includes('°C'))).toBe(true)
    expect(result.products.length).toBeGreaterThanOrEqual(1)
  })

  it('warns when overlap exceeds 25 bp', () => {
    const overlap = 'ATGCATGCATGCATGCATGCATGCATGCATGC' // 32bp
    const fragA = makeDoc('A', 'AAAAAAAAAA' + overlap)
    const fragB = makeDoc('B', overlap + 'TTTTTTTTTT')

    const result = infusionAssemble({
      fragments: [{ doc: fragA }, { doc: fragB }],
      maxOverlap: 40, // allow finding the overlap
    })

    expect(result.warnings.some(w => w.includes('15–25 bp'))).toBe(true)
  })

  it('warns when overlap is below 15 bp', () => {
    const overlap = 'ATGCATGCATGC' // 12bp
    const fragA = makeDoc('A', 'AAAAAAAAAA' + overlap)
    const fragB = makeDoc('B', overlap + 'TTTTTTTTTT')

    const result = infusionAssemble({
      fragments: [{ doc: fragA }, { doc: fragB }],
      minOverlap: 10, // allow finding the shorter overlap
    })

    expect(result.warnings.some(w => w.includes('In-Fusion requires ≥ 15 bp'))).toBe(true)
  })

  it('supports auto-ordering', () => {
    const oh1 = 'ATGCATGCATGCATGCATGC' // 20bp
    const oh2 = 'GGCCGGCCGGCCGGCCGGCC' // 20bp
    const oh3 = 'TTAATTAATTAATTAATTAA' // 20bp

    const fragA = makeDoc('A', 'AAAAAAAAAAAAAAA' + oh1)
    const fragB = makeDoc('B', oh1 + 'BBBBBBBBBBBBBBB' + oh2)
    const fragC = makeDoc('C', oh2 + 'CCCCCCCCCCCCCCC' + oh3)
    const fragD = makeDoc('D', oh3 + 'DDDDDDDDDDDDDDD')

    const result = infusionAssemble({
      fragments: [{ doc: fragC }, { doc: fragA }, { doc: fragD }, { doc: fragB }],
      maxOverlap: 25,
      autoOrder: true,
    })

    expect(result.products.length).toBeGreaterThanOrEqual(1)
    expect(result.warnings.some(w => w.includes('automatically reordered'))).toBe(true)
  })

  it('renames products from Gibson to In-Fusion', () => {
    const overlap = 'ATGCATGCATGCATGCATGC' // 20bp
    const fragA = makeDoc('A', 'AAAAAAAAAA' + overlap)
    const fragB = makeDoc('B', overlap + 'TTTTTTTTTT')

    const result = infusionAssemble({
      fragments: [{ doc: fragA }, { doc: fragB }],
    })

    for (const p of result.products) {
      expect(p.name).not.toContain('Gibson')
      expect(p.description).not.toContain('Gibson')
    }
  })
})
