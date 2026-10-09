import { describe, it, expect } from 'vitest'
import { emptyDesign, newPartId, type DesignPart } from './design'
import { pickSite, pieceAt, siteHint } from './picking'
import { runDesign } from './run'
import { keptFragment } from './outcome'

const fill = (n: number) => 'ACGT'.repeat(Math.ceil(n / 4)).slice(0, n)
const put = (s: string, at: number, site: string) => s.slice(0, at) + site + s.slice(at + site.length)

const vector = (enzymes?: string[]): DesignPart => ({
  id: newPartId(),
  name: 'pV',
  role: 'vector',
  bases: put(put(fill(3000), 100, 'GAATTC'), 140, 'GGATCC'),
  topology: 'circular',
  annotations: [],
  orientation: 'auto',
  ...(enzymes ? { enzymes } : {}),
})

const design = (part: DesignPart, enzymes: string[] = []) =>
  ({ ...emptyDesign('restriction'), enzymes, parts: [part] })

describe('clicking sites on a part’s map', () => {
  it('cuts at the first site, then at a second as well', () => {
    const p = vector()
    const first = pickSite(p, design(p), ['EcoRI'], false)
    expect(first).toEqual(['EcoRI'])
    const q = { ...p, enzymes: first }
    expect(pickSite(q, design(q), ['BamHI'], false)).toEqual(['EcoRI', 'BamHI'])
  })

  it('starts again from a third site, unless Shift is held', () => {
    const p = vector(['EcoRI', 'BamHI'])
    expect(pickSite(p, design(p), ['PstI'], false)).toEqual(['PstI'])
    expect(pickSite(p, design(p), ['PstI'], true)).toEqual(['EcoRI', 'BamHI', 'PstI'])
  })

  it('stops cutting at a chosen site, down to none at all', () => {
    const p = vector(['EcoRI'])
    expect(pickSite(p, design(p), ['EcoRI'], false)).toEqual([])
  })

  it('starts from the design’s enzymes when the part has none of its own', () => {
    const p = vector()
    expect(pickSite(p, design(p, ['EcoRI', 'BamHI']), ['BamHI'], false)).toEqual(['EcoRI'])
  })

  it('treats a site shared by two enzymes as chosen if either is', () => {
    const p = vector(['XmaI'])
    expect(pickSite(p, design(p), ['SmaI', 'XmaI'], false)).toEqual([])
  })

  it('says what a click will do', () => {
    const p = vector(['EcoRI'])
    expect(siteHint(p, design(p), ['EcoRI'])).toBe('Click to stop cutting here')
    expect(siteHint(p, design(p), ['BamHI'])).toBe('Click to cut here too')
    const q = vector(['EcoRI', 'BamHI'])
    expect(siteHint(q, design(q), ['PstI'])).toContain('instead')
  })
})

describe('clicking a piece of a part’s map', () => {
  it('chooses the piece under the pointer, and the run uses it', () => {
    const p = vector(['EcoRI', 'BamHI'])
    const d = design(p)
    const { fragments } = runDesign(d)
    // Between the two sites is the short piece; the vector keeps the long one.
    expect(keptFragment(p, fragments)!.top.length).toBeGreaterThan(2000)
    const keep = pieceAt(p.id, fragments, 120, 3000)!
    const short = keptFragment({ ...p, keep }, fragments)!
    expect(short.top.length).toBeLessThan(100)
    // Round the origin is the long piece again.
    const back = pieceAt(p.id, fragments, 2900, 3000)!
    expect(keptFragment({ ...p, keep: back }, fragments)!.top.length).toBeGreaterThan(2000)
  })

  it('has nothing to choose when the part was cut once', () => {
    const p = vector(['EcoRI'])
    expect(pieceAt(p.id, runDesign(design(p)).fragments, 500, 3000)).toBeNull()
  })
})
