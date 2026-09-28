import { render, act, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import PlasmidMap from './PlasmidMap'
import { useEditorStore } from '../store'

const store = () => useEditorStore.getState()

function openPlasmid() {
  for (const tab of store().tabs) store().closeTab(tab.id)
  const id = store().openDocument('pTest', 'ATGCGATCGA'.repeat(200), 'circular')
  act(() => {
    store().addAnnotation({
      id: 'f1', name: 'ampR', type: 'CDS',
      start: 100, end: 900, strand: 1, color: '#4dabf7',
    })
  })
  return id
}

describe('PlasmidMap', () => {
  beforeEach(() => {
    openPlasmid()
  })

  it('renders a canvas', () => {
    const { container } = render(<PlasmidMap />)
    expect(container.querySelector('canvas')).not.toBeNull()
  })

  it('offers PNG and SVG export', async () => {
    render(<PlasmidMap />)
    const trigger = screen.getByRole('button', { name: 'Export map image' })
    await act(async () => { trigger.click() })
    expect(screen.getByRole('menuitem', { name: /PNG/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /SVG/ })).toBeInTheDocument()
  })

  it('hides the zoom reset until the view is actually zoomed', () => {
    render(<PlasmidMap />)
    // A reset that is always visible is noise; one that appears only when
    // there is something to reset is the affordance.
    expect(screen.queryByRole('button', { name: 'Reset zoom to fit' })).toBeNull()
  })

  it('binds each canvas listener once, not once per hover', () => {
    // The old component listed its draw callback in the effect's deps, so
    // every hover tore down and re-added five listeners and the resize
    // observer. This is the regression test for that.
    const addSpy = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener')
    render(<PlasmidMap />)
    const afterMount = addSpy.mock.calls.length

    for (const id of ['f1', null, 'f1', null]) {
      act(() => { store().setHoveredAnnotation(id) })
    }

    expect(addSpy.mock.calls.length).toBe(afterMount)
    addSpy.mockRestore()
  })

  it('does not rebuild the canvas backing store on every paint', async () => {
    // jsdom reports every element as zero-sized, so give the container a size
    // or the component never paints and this asserts nothing.
    const sized = (prop: 'clientWidth' | 'clientHeight') =>
      vi.spyOn(HTMLDivElement.prototype, prop, 'get').mockReturnValue(500)
    const w = sized('clientWidth')
    const h = sized('clientHeight')

    const { container } = render(<PlasmidMap />)
    const canvas = container.querySelector('canvas') as HTMLCanvasElement

    let stored = 0
    const widthSpy = vi.fn((v: number) => { stored = v })
    // Assigning width reallocates and clears the buffer, so it must only
    // happen when the pixel size genuinely changes.
    Object.defineProperty(canvas, 'width', {
      get: () => stored,
      set: widthSpy,
      configurable: true,
    })

    const frame = () => act(async () => {
      await new Promise(r => requestAnimationFrame(() => r(null)))
    })

    act(() => { store().setHoveredAnnotation('f1') })
    await frame()
    expect(widthSpy).toHaveBeenCalled() // it did paint

    const afterFirst = widthSpy.mock.calls.length
    for (const id of [null, 'f1', null]) {
      act(() => { store().setHoveredAnnotation(id) })
      await frame()
    }
    expect(widthSpy.mock.calls.length).toBe(afterFirst)

    w.mockRestore()
    h.mockRestore()
  })
})
