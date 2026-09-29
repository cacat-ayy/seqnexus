/**
 * What the sequence view draws for a translation.
 *
 * jsdom has no layout and no canvas, so the container is given a size and the
 * context records what it is told to draw. That is enough to check the thing
 * that matters: which residues end up on screen, in which frame, spelled how.
 */
import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import SequenceView from './SequenceView'
import { useEditorStore } from '../store'
import { DEFAULT_DISPLAY_SETTINGS } from '../utils/display-settings'

const store = () => useEditorStore.getState()

/** ATG AAA TTT TAA repeated: M K F * in frame 1. */
const BASES = 'ATGAAATTTTAA'.repeat(8)

interface DrawnText { text: string; x: number; y: number; fill: string }

let drawn: DrawnText[] = []

function recordingContext() {
  const state: Record<string, unknown> = {
    fillStyle: '#000000',
    font: '',
    measureText: (t: string) => ({ width: t.length * 6 }),
  }
  const target: Record<string, unknown> = {
    ...state,
    fillText: (text: string, x: number, y: number) => {
      drawn.push({ text, x, y, fill: String(target.fillStyle) })
    },
    measureText: (t: string) => ({ width: t.length * 6 }),
  }
  return new Proxy(target, {
    get: (obj, prop: string) => prop in obj ? obj[prop] : () => {},
    set: (obj, prop: string, value) => { obj[prop] = value; return true },
  })
}

/** Residue glyphs only: the ruler and the bases are drawn with fillText too. */
function residues(): string[] {
  return drawn
    .filter(d => /^([A-Z*?]|[A-Z][a-z]{2}|Stop)$/.test(d.text))
    .filter(d => !'ACGT'.includes(d.text))
    .map(d => d.text)
}

async function frames(n = 2) {
  for (let i = 0; i < n; i++) {
    await act(async () => { await new Promise(r => requestAnimationFrame(() => r(null))) })
  }
}

let sizeSpies: (() => void)[] = []

function sizeContainer() {
  for (const prop of ['clientWidth', 'clientHeight'] as const) {
    const value = prop === 'clientWidth' ? 1200 : 800
    Object.defineProperty(HTMLDivElement.prototype, prop, { configurable: true, get: () => value })
    sizeSpies.push(() => Reflect.deleteProperty(HTMLDivElement.prototype, prop))
  }
}

describe('translation rendering', () => {
  beforeEach(() => {
    drawn = []
    sizeSpies = []
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pTrans', BASES)
    act(() => {
      const s = store()
      if (!s.showTranslation) s.toggleTranslation()
      s.setTranslationFrame(DEFAULT_DISPLAY_SETTINGS.translationFrame)
      s.setTranslationCode(1)
      s.setAminoAcidStyle('none')
      if (s.threeLetterAminoAcids) s.toggleThreeLetterAminoAcids()
    })
    sizeContainer()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(recordingContext() as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    for (const undo of sizeSpies) undo()
  })

  it('draws nothing for a frame when the translation is switched off', async () => {
    act(() => { store().toggleTranslation() })
    render(<SequenceView />)
    await frames()
    expect(residues()).toEqual([])
  })

  it('translates frame 1 across the sequence', async () => {
    act(() => { store().setTranslationFrame('f1') })
    render(<SequenceView />)
    await frames()

    const seen = residues().join('')
    expect(seen.length).toBeGreaterThan(0)
    // ATG AAA TTT TAA, over and over.
    expect(seen).toContain('MKF*')
  })

  it('reads a reverse frame off the other strand', async () => {
    act(() => { store().setTranslationFrame('r1') })
    render(<SequenceView />)
    await frames()

    // Reverse complement of ATGAAATTTTAA is TTAAAATTTCAT: L K F H in frame.
    const seen = residues().join('')
    expect(seen.length).toBeGreaterThan(0)
    expect(seen).not.toContain('MKF*')
  })

  it('follows the chosen genetic code', async () => {
    act(() => { store().setTranslationFrame('f1') })
    render(<SequenceView />)
    await frames()
    expect(residues().join('')).toContain('*')

    // Table 6 reads TAA as glutamine, so the stops disappear.
    drawn = []
    act(() => { store().setTranslationCode(6) })
    await frames()
    const seen = residues().join('')
    expect(seen).toContain('MKFQ')
    expect(seen).not.toContain('*')
  })

  it('spells residues with three letters when asked', async () => {
    act(() => { store().setTranslationFrame('f1') })
    render(<SequenceView />)
    await frames()
    expect(residues()).toContain('M')

    drawn = []
    act(() => { store().toggleThreeLetterAminoAcids() })
    await frames()
    const seen = residues()
    expect(seen).toContain('Met')
    expect(seen).toContain('Stop')
    expect(seen).not.toContain('M')
  })

  it('colours residues by the chosen palette, and always marks a stop', async () => {
    act(() => { store().setTranslationFrame('f1') })
    render(<SequenceView />)
    await frames()

    const stop = drawn.find(d => d.text === '*')!
    const met = drawn.find(d => d.text === 'M')!
    // Plain style: only the stop is coloured.
    expect(stop.fill).not.toBe(met.fill)

    drawn = []
    act(() => { store().setAminoAcidStyle('clustal') })
    await frames()
    const lysine = drawn.find(d => d.text === 'K')!
    const phenylalanine = drawn.find(d => d.text === 'F')!
    expect(lysine.fill).not.toBe(phenylalanine.fill)
  })

  it('draws one row per frame', async () => {
    /** Distinct baselines residues were drawn on, within the first text row. */
    const baselines = () => {
      const ys = drawn
        .filter(d => /^[A-Z*?]$/.test(d.text) && !'ACGT'.includes(d.text))
        .map(d => Math.round(d.y))
      if (ys.length === 0) return 0
      const firstRowTop = Math.min(...ys)
      return new Set(ys.filter(y => y < firstRowTop + 100)).size
    }

    act(() => { store().setTranslationFrame('f1') })
    render(<SequenceView />)
    await frames()
    const one = baselines()

    drawn = []
    act(() => { store().setTranslationFrame('all') })
    await frames()
    const six = baselines()

    expect(one).toBe(1)
    expect(six).toBe(6)
  })
})
