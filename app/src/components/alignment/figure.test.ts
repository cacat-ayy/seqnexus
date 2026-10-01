import { describe, it, expect } from 'vitest'
import { makeDoc } from '../../msa/model'
import { DEFAULT_VIEW } from '../../msa/view'
import { buildPaintModel } from './layout'
import { buildFigure, figureCells, MAX_FIGURE_CELLS, type FigureOptions } from './figure'

const doc = makeDoc([
  { name: 'Homo <sapiens>', seq: 'ATGGCCAAG-TTGCATGCATGC' },
  { name: 'Mus', seq: 'ATGGCCAAGCTTGCATGCATGC' },
], { method: 'manual', at: 0 })

const base: FigureOptions = {
  rowIds: null, c0: 0, c1: 22, perLine: 10,
  tracks: { ruler: true, logo: true, identity: true, consensus: true },
  numbers: true, fontSize: 10,
}

describe('alignment figures', () => {
  it('builds a wrapped SVG with names, residues and line-end numbers', () => {
    const fig = buildFigure(buildPaintModel(doc, DEFAULT_VIEW), { ...base, title: 'Fig. 1' })
    expect(fig.svg.startsWith('<svg')).toBe(true)
    expect(fig.svg).toContain('Homo &lt;sapiens&gt;') // escaped
    expect(fig.svg).toContain('Fig. 1')
    // 22 columns at 10 per line: three blocks, so each name appears three times.
    expect(fig.svg.match(/>Mus</g)).toHaveLength(3)
    // Line-end numbers for Homo: 10, 19 (one gap in the second block), 21.
    expect(fig.svg).toMatch(/class="num"[^>]*>10</)
    expect(fig.svg).toMatch(/class="num"[^>]*>19</)
    expect(fig.svg).toMatch(/class="num"[^>]*>21</)
    expect(fig.width).toBeGreaterThan(0)
    expect(fig.height).toBeGreaterThan(0)
  })

  it('draws matches as dots when the view does', () => {
    const fig = buildFigure(buildPaintModel(doc, { ...DEFAULT_VIEW, dots: true }), { ...base, perLine: 0, tracks: { ruler: false, logo: false, identity: false, consensus: false } })
    expect(fig.svg).toContain('.')
    expect(fig.svg.match(/<text x="[^"]+" y="[^"]+" fill="[^"]+">\.+</g)?.length).toBeGreaterThan(0)
  })

  it('can show only the selected rows and columns', () => {
    const pm = buildPaintModel(doc, DEFAULT_VIEW)
    const opts = { ...base, rowIds: [doc.rows[1].id], c0: 5, c1: 15 }
    const fig = buildFigure(pm, opts)
    expect(fig.svg).not.toContain('Homo')
    expect(figureCells(pm, opts)).toBe(10)
    expect(figureCells(pm, { ...base, c1: MAX_FIGURE_CELLS })).toBeGreaterThan(MAX_FIGURE_CELLS)
  })
})
