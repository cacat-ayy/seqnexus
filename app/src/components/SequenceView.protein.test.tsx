/**
 * What the sequence view draws for a protein: residues on one strand,
 * coloured by the residue scheme, with no complement and no translation
 * whatever the DNA preferences say.
 */
import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import SequenceView from './SequenceView'
import { useEditorStore } from '../store'
import { residueColorFor } from '../utils/residue-colors'

const store = () => useEditorStore.getState()

const RESIDUES = 'MKVLAAGIVGLLLAAQPAMA'

interface DrawnText { text: string; x: number; y: number; fill: string }
let drawn: DrawnText[] = []

function recordingContext() {
  const target: Record<string, unknown> = {
    fillStyle: '#000000',
    font: '',
    fillText: (text: string, x: number, y: number) => {
      drawn.push({ text, x, y, fill: String(target.fillStyle) })
    },
    measureText: (t: string) => ({ width: t.length * 6 }),
  }
  return new Proxy(target, {
    get: (obj, prop: string) => prop in obj ? obj[prop] : () => {},
    set: (obj, prop, value) => { obj[prop as string] = value; return true },
  })
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

/** Single letters drawn at the letters zoom: residues, and nothing else that is one letter. */
const letters = () => drawn.filter(d => /^[A-Z*]$/.test(d.text))

describe('protein rendering', () => {
  beforeEach(() => {
    drawn = []
    sizeSpies = []
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pep', RESIDUES, 'linear', undefined, 'new', 'protein')
    act(() => {
      const s = store()
      // DNA preferences that must not apply to a protein.
      if (!s.showComplement) s.toggleComplement()
      if (!s.showTranslation) s.toggleTranslation()
      s.setTranslationFrame('f1')
      s.setProteinColorScheme('polarity')
      s.setColorTarget('letters')
      s.setZoom(20)
    })
    sizeContainer()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(recordingContext() as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    for (const undo of sizeSpies) undo()
  })

  it('draws each residue once: no complement strand, no translation row', async () => {
    render(<SequenceView />)
    await frames()
    const seen = letters()
    expect(seen.map(d => d.text).join('')).toBe(RESIDUES)
    // All on one line.
    expect(new Set(seen.map(d => d.y)).size).toBe(1)
  })

  it('colours residues by the chosen residue scheme', async () => {
    render(<SequenceView />)
    await frames()
    const k = letters().find(d => d.text === 'K')!
    const d = letters().find(d => d.text === 'D' || d.text === 'A')!
    expect(k.fill.toLowerCase()).toBe(residueColorFor('polarity', 'K', '').toLowerCase())
    expect(d.fill.toLowerCase()).toBe(residueColorFor('polarity', d.text, '').toLowerCase())

    drawn = []
    act(() => { store().setProteinColorScheme('none') })
    await frames()
    const plain = letters()
    expect(new Set(plain.map(x => x.fill)).size).toBe(1)
  })

  it('takes typed residues that are not bases', async () => {
    render(<SequenceView />)
    await frames()
    act(() => { store().setCaret(0) })
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' })) })
    expect(store().doc.sequence.bases.startsWith('Q' + RESIDUES.slice(0, 3))).toBe(true)
    // Not a residue: refused, as a base that is not a residue would be.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '#' })) })
    expect(store().doc.sequence.length).toBe(RESIDUES.length + 1)
  })
})
