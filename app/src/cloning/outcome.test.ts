import { describe, it, expect } from 'vitest'
import { emptyDesign, newPartId, type CloningDesign, type DesignPart } from './design'
import { runDesign } from './run'
import { findFixes, isIntended, productLabel, whyNoConstruct } from './outcome'

// No common cloning enzyme's site occurs in (ACGT)n, so the sites below are
// the only ones there are.
const fill = (n: number) => 'ACGT'.repeat(Math.ceil(n / 4)).slice(0, n)
const put = (s: string, at: number, site: string) => s.slice(0, at) + site + s.slice(at + site.length)

const part = (name: string, bases: string, role: 'vector' | 'insert'): DesignPart => ({
  id: newPartId(),
  name,
  role,
  bases,
  topology: role === 'vector' ? 'circular' : 'linear',
  annotations: [],
  orientation: 'auto',
})

// EcoRI and BamHI in the vector's MCS; the insert has them near each end.
const VECTOR = part('pV', put(put(fill(3000), 100, 'GAATTC'), 140, 'GGATCC'), 'vector')
const INSERT = part('ins', put(put(fill(800), 10, 'GAATTC'), 780, 'GGATCC'), 'insert')

const design = (enzymes: string[], parts = [VECTOR, INSERT]): CloningDesign =>
  ({ ...emptyDesign('restriction'), parts, enzymes })

describe('the outcome of a design', () => {
  it('names the construct and offers no fixes when it forms', () => {
    const d = design(['EcoRI', 'BamHI'])
    const products = runDesign(d).products
    expect(products.some(isIntended)).toBe(true)
    expect(productLabel(products.find(isIntended)!, d)).toBe('The construct')
    expect(findFixes(d)).toEqual([])
  })

  it('says what a by-product is rather than repeating its name', () => {
    // EcoRI alone opens the vector with two matching ends.
    const d = design(['EcoRI', 'PstI'])
    const labels = runDesign(d).products.map(p => productLabel(p, d))
    expect(labels).toContain('pV closed on itself')
    expect(labels).not.toContain('The construct')
  })

  it('suggests the smallest change that makes the construct, and it works', () => {
    // PstI cuts nothing, so the insert never gets a second sticky end.
    const d = design(['EcoRI', 'PstI'])
    const fixes = findFixes(d)
    expect(fixes.map(f => f.label)).toContain('Add BamHI')
    for (const fix of fixes) {
      if (fix.apply === 'oligos') continue
      expect(runDesign(fix.apply(d)).products.some(isIntended)).toBe(true)
    }
  })

  it('only offers fixes that were tried, and caps them', () => {
    expect(findFixes(design(['EcoRI', 'PstI']), 2).length).toBeLessThanOrEqual(2)
  })

  it('replaces sites picked on a map when it suggests a different digest', () => {
    // The vector is cut on its own with EcoRI + PstI, which leaves it
    // nothing to take the insert's BamHI end; adding to the design's list
    // would not reach it.
    const d = design(['EcoRI', 'BamHI'], [{ ...VECTOR, enzymes: ['EcoRI', 'PstI'] }, INSERT])
    const fixes = findFixes(d)
    expect(fixes.length).toBeGreaterThan(0)
    expect(fixes.map(f => f.label).some(l => l.startsWith('Add '))).toBe(false)
    for (const fix of fixes) {
      if (fix.apply === 'oligos') continue
      expect(runDesign(fix.apply(d)).products.some(isIntended)).toBe(true)
    }
  })

  it('does not guess with only one part', () => {
    expect(findFixes(design(['EcoRI'], [VECTOR]))).toEqual([])
  })
})

describe('why the construct does not form', () => {
  it('names a line whose free ends do not fit', () => {
    // PstI cuts nothing: the insert joins the vector by its EcoRI end and
    // keeps its own blunt end on the other side.
    const d = design(['EcoRI', 'PstI'])
    expect(whyNoConstruct(runDesign(d).products, d)).toEqual([
      'Every part joins in a line, but the two ends left over do not fit each other, so it never closes.',
    ])
  })

  it('names the part whose ends join no other part', () => {
    // The third part is cut with PstI and XbaI, which fit neither vector end.
    const odd = { ...part('odd', put(put(fill(800), 10, 'CTGCAG'), 780, 'TCTAGA'), 'insert'), enzymes: ['PstI', 'XbaI'] }
    const d = design(['EcoRI', 'BamHI'], [VECTOR, INSERT, odd])
    const result = runDesign(d)
    expect(result.products.some(isIntended)).toBe(false)
    expect(whyNoConstruct(result.products, d)).toEqual(['The ends of odd join no other part.'])
  })

  it('says so when no two parts fit, even though each closes on itself', () => {
    // The vector opened by EcoRI alone, the insert cut by PstI near one end.
    const vector = { ...VECTOR, enzymes: ['EcoRI'] }
    const insert = { ...part('pst', put(fill(800), 10, 'CTGCAG'), 'insert'), enzymes: ['PstI'] }
    const d = design([], [vector, insert])
    const result = runDesign(d)
    expect(result.products.length).toBeGreaterThan(0)
    expect(whyNoConstruct(result.products, d)).toEqual([
      'No two parts have ends that fit each other, so each only joins itself.',
    ])
  })
})
