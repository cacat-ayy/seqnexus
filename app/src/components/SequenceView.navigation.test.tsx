/**
 * Keyboard navigation in the sequence view: Ctrl+←/→ block jumps and
 * PageUp/PageDown screenfuls.
 *
 * jsdom has no layout, so the container is given a size; the view lays its
 * rows out from that the same way it does in a browser.
 */
import { render, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import SequenceView from './SequenceView'
import { useEditorStore } from '../store'

const store = () => useEditorStore.getState()
const caret = () => store().selection.caret
const sel = () => [store().selection.anchor, store().selection.caret]
const key = (k: string, opts: Partial<KeyboardEventInit> = {}) =>
  act(() => { fireEvent.keyDown(document.body, { key: k, ...opts }) })

let restoreSize: (() => void)[] = []

beforeEach(() => {
  for (const prop of ['clientWidth', 'clientHeight'] as const) {
    const value = prop === 'clientWidth' ? 1200 : 600
    Object.defineProperty(HTMLDivElement.prototype, prop, { configurable: true, get: () => value })
    restoreSize.push(() => Reflect.deleteProperty(HTMLDivElement.prototype, prop))
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    new Proxy({}, { get: () => () => ({ width: 0 }) }) as unknown as CanvasRenderingContext2D,
  )
  for (const t of store().tabs) store().closeTab(t.id)
  store().openDocument('pNav', 'ACGT'.repeat(2000))
  act(() => { store().setSelection({ anchor: 4, caret: 4 }) })
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const r of restoreSize) r()
  restoreSize = []
})

describe('Ctrl+arrow block jumps', () => {
  it('moves to the next and previous 10 bp boundary', () => {
    render(<SequenceView />)
    key('ArrowRight', { ctrlKey: true })
    expect(caret()).toBe(10)
    key('ArrowRight', { ctrlKey: true })
    expect(caret()).toBe(20)
    act(() => { store().setCaret(23) })
    key('ArrowLeft', { ctrlKey: true })
    expect(caret()).toBe(20)
    key('ArrowLeft', { ctrlKey: true })
    expect(caret()).toBe(10)
  })

  it('stops at the ends of the sequence', () => {
    render(<SequenceView />)
    act(() => { store().setCaret(3) })
    key('ArrowLeft', { ctrlKey: true })
    expect(caret()).toBe(0)
    act(() => { store().setCaret(7995) })
    key('ArrowRight', { ctrlKey: true })
    expect(caret()).toBe(8000)
  })

  it('extends the selection with Shift', () => {
    render(<SequenceView />)
    key('ArrowRight', { ctrlKey: true, shiftKey: true })
    key('ArrowRight', { ctrlKey: true, shiftKey: true })
    expect(sel()).toEqual([4, 20])
  })

  it('starts from the side of a selection it heads towards', () => {
    render(<SequenceView />)
    act(() => { store().setSelection({ anchor: 13, caret: 27 }) })
    key('ArrowRight', { ctrlKey: true })
    expect(sel()).toEqual([30, 30])
    act(() => { store().setSelection({ anchor: 13, caret: 27 }) })
    key('ArrowLeft', { ctrlKey: true })
    expect(sel()).toEqual([10, 10])
  })
})

describe('PageUp / PageDown', () => {
  /** Bases per row, read off the view by stepping one row down. */
  function rowStep(): number {
    const before = caret()
    key('ArrowDown')
    const step = caret() - before
    key('ArrowUp')
    return step
  }

  it('moves whole rows, keeping the column, and comes back', () => {
    render(<SequenceView />)
    const bpr = rowStep()
    expect(bpr).toBeGreaterThan(10)
    key('PageDown')
    const down = caret()
    expect(down).toBeGreaterThan(4 + bpr)
    expect((down - 4) % bpr).toBe(0)
    key('PageUp')
    expect(caret()).toBe(4)
  })

  it('goes to the ends from the first and last rows', () => {
    render(<SequenceView />)
    key('PageUp')
    expect(caret()).toBe(0)
    for (let i = 0; i < 500 && caret() < 8000; i++) key('PageDown')
    expect(caret()).toBe(8000)
  })

  it('extends the selection with Shift', () => {
    render(<SequenceView />)
    key('PageDown', { shiftKey: true })
    const [anchor, c] = sel()
    expect(anchor).toBe(4)
    expect(c).toBeGreaterThan(4)
  })
})
