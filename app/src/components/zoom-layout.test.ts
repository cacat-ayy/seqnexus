import { describe, it, expect } from 'vitest'
import {
  getLayout, RowLayoutMap, rowHeightForLanes, cellWidth, getRenderMode, MAX_ZOOM, LETTERS_FROM,
  DOT_MIN_CELL, LETTER_MIN_CELL,
} from './zoom-layout'

describe('RowLayoutMap base <-> y', () => {
  const L = getLayout(10, 1000, false, 10_000)
  const bpr = L.basesPerRow
  const rows = 20
  const seqLen = rows * bpr

  /** Rows 0-9 bare, rows 10-19 with the maximum annotation lanes. */
  const uneven = () => {
    const rl = new RowLayoutMap(rows)
    for (let r = 10; r < rows; r++) rl.lanes[r] = L.maxAnnotationRows
    rl.build(L)
    return rl
  }

  it('maps the top of a row to its first base', () => {
    const rl = uneven()
    expect(rl.baseAtY(rl.rowY(12), bpr, seqLen)).toBe(12 * bpr)
  })

  it('round-trips through yAtBase', () => {
    const rl = uneven()
    for (const base of [0, bpr / 2, 3 * bpr + 7, 11.5 * bpr, 19 * bpr + 1]) {
      expect(rl.baseAtY(rl.yAtBase(base, bpr), bpr, seqLen)).toBeCloseTo(base, 6)
    }
  })

  it('differs from the scroll fraction when rows are uneven', () => {
    const rl = uneven()
    // The bare first half of the rows is less than half the height, so
    // halfway down the scroll is already past halfway through the bases.
    expect(rowHeightForLanes(L, L.maxAnnotationRows)).toBeGreaterThan(rowHeightForLanes(L, 0))
    const midBase = rl.baseAtY(rl.totalHeight / 2, bpr, seqLen)
    expect(midBase).toBeGreaterThan(seqLen / 2)
  })

  it('clamps past the end', () => {
    const rl = uneven()
    expect(rl.baseAtY(rl.totalHeight + 500, bpr, seqLen)).toBe(seqLen)
    expect(rl.yAtBase(-5, bpr)).toBe(0)
  })
})

describe('RowLayoutMap translation rows', () => {
  // Letters zoom, where translations are drawn, with two rows reserved.
  const L = getLayout(14, 1000, false, 10_000, { translationRows: 2 })
  const transH = L.translationRowH + L.translationGap

  it('reserves the full translation band on every row by default', () => {
    const rl = new RowLayoutMap(3)
    rl.build(L)
    expect(rl.rowH(0)).toBe(rowHeightForLanes(L, 0))
    expect(rl.rowH(0)).toBe(rowHeightForLanes(L, 0, 0) + 2 * transH)
  })

  it('sizes each row to its own coding features when set per row', () => {
    const rl = new RowLayoutMap(3)
    rl.perRowTranslations = true
    rl.translations[1] = 1
    rl.translations[2] = 5 // more than the layout allows: clamped
    rl.build(L)
    expect(rl.rowH(0)).toBe(rowHeightForLanes(L, 0, 0))
    expect(rl.rowH(1)).toBe(rowHeightForLanes(L, 0, 0) + transH)
    expect(rl.rowH(2)).toBe(rowHeightForLanes(L, 0, 0) + 2 * transH)
    expect(rl.translationRowsAt(2, L)).toBe(2)
    expect(rl.totalHeight).toBe(rl.rowY(2) + rl.rowH(2))
  })

  it('keeps the uniform path when every row has the same counts', () => {
    const rl = new RowLayoutMap(4)
    rl.perRowTranslations = true
    rl.translations.fill(1)
    rl.build(L)
    expect(rl.totalHeight).toBe(4 * (rowHeightForLanes(L, 0, 0) + transH))
    expect(rl.rowAtY(rl.rowY(3) + 1)).toBe(3)
  })
})

describe('the zoom scale', () => {
  const levels = Array.from({ length: MAX_ZOOM + 1 }, (_, z) => z)
  const widths = [320, 800, 1300, 2400]

  it('shows fewer bases per row at every step in, whatever the pane width', () => {
    for (const w of widths) {
      const bpr = levels.map(z => getLayout(z, w, false, 5_000_000).basesPerRow)
      for (let z = 1; z <= MAX_ZOOM; z++) expect(bpr[z]).toBeLessThan(bpr[z - 1])
    }
  })

  it('never gives a base less width than its level asks for', () => {
    for (const w of widths) {
      for (const z of levels) {
        expect(getLayout(z, w, false, 10_000).bpWidth).toBeGreaterThanOrEqual(cellWidth(z) - 1e-9)
      }
    }
  })

  it('picks the mode from the width of a base, so dots mode always has room for its dots', () => {
    for (const z of levels) {
      const mode = getRenderMode(z)
      const cell = cellWidth(z)
      if (mode === 'letters') expect(cell).toBeGreaterThanOrEqual(LETTER_MIN_CELL)
      else if (mode === 'dots') expect(cell).toBeGreaterThanOrEqual(DOT_MIN_CELL)
      else expect(cell).toBeLessThan(DOT_MIN_CELL)
    }
    expect(getRenderMode(LETTERS_FROM)).toBe('letters')
    expect(getRenderMode(LETTERS_FROM - 1)).not.toBe('letters')
  })

  it('starts zoomed-out rows on round positions', () => {
    for (const w of widths) {
      for (const z of levels.filter(l => getRenderMode(l) !== 'letters')) {
        const bpr = getLayout(z, w, false, 5_000_000).basesPerRow
        const digits = String(bpr).replace(/0+$/, '')
        expect(digits.length).toBeLessThanOrEqual(2)
      }
    }
  })

  it('keeps 14px letters at the default level and grows them with the zoom', () => {
    const at = (z: number) => getLayout(z, 1000, false, 1000, { showComplement: false })
    expect(at(14).letterFont).toBe(14)
    expect(at(14).letterH).toBe(16)
    for (let z = LETTERS_FROM + 1; z <= MAX_ZOOM; z++) {
      expect(at(z).letterFont).toBeGreaterThanOrEqual(at(z - 1).letterFont)
      expect(at(z).seqLineHeight).toBe(at(z).letterH)
    }
    expect(at(MAX_ZOOM).letterFont).toBeGreaterThan(at(14).letterFont)
    // Both strands, with the gap between them.
    const both = getLayout(MAX_ZOOM, 1000, false, 1000, { showComplement: true })
    expect(both.seqLineHeight).toBe(both.letterH * 2 + both.strandGap)
  })
})
