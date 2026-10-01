import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Minimap from './Minimap'
import { createViewportSource } from './viewport'
import { featureTrack } from './tracks/features'
import type { MinimapTrack } from './types'

// jsdom has no PointerEvent, so fireEvent.pointer* would drop clientX/Y.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    pointerId: number
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
    }
  }
  window.PointerEvent = PointerEventShim as unknown as typeof PointerEvent
}
HTMLElement.prototype.setPointerCapture ??= () => {}

// jsdom has no layout: give the bar a width and its canvas a position.
const WIDTH = 422 // a 400px bar after the 4px left and 18px right padding
let widthSpy: ReturnType<typeof vi.spyOn>
let rectSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(WIDTH)
  rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    { left: 0, top: 0, right: WIDTH, bottom: 60, width: WIDTH, height: 60, x: 0, y: 0, toJSON: () => ({}) },
  )
})

afterEach(() => {
  widthSpy.mockRestore()
  rectSpy.mockRestore()
})

/** x for a position on the 1000-unit test bar. */
const xOf = (pos: number) => 4 + (pos / 1000) * 400

function setup(tracks: MinimapTrack[] = [], extra: Partial<React.ComponentProps<typeof Minimap>> = {}) {
  const viewport = createViewportSource({ start: 0, end: 100 })
  const onNavigate = vi.fn((start: number) => viewport.set({ start, end: start + 100 }))
  const utils = render(
    <Minimap kind="sequence" length={1000} tracks={tracks} viewport={viewport} onNavigate={onNavigate} ariaLabel="Overview" {...extra} />,
  )
  const overlay = utils.container.querySelector('.minimap-overlay') as HTMLCanvasElement
  return { ...utils, viewport, onNavigate, overlay }
}

describe('Minimap', () => {
  it('centres the viewport where you press outside it, then drags', () => {
    const { overlay, onNavigate } = setup()
    fireEvent.pointerDown(overlay, { button: 0, clientX: xOf(500), clientY: 30, pointerId: 1 })
    expect(onNavigate).toHaveBeenLastCalledWith(450)
    fireEvent.pointerMove(overlay, { clientX: xOf(700), clientY: 30, pointerId: 1 })
    expect(onNavigate).toHaveBeenLastCalledWith(650)
    fireEvent.pointerUp(overlay, { pointerId: 1 })
    onNavigate.mockClear()
    fireEvent.pointerMove(overlay, { clientX: xOf(100), clientY: 30, pointerId: 1 })
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('drags the viewport by its grab point without jumping', () => {
    const { overlay, onNavigate } = setup()
    fireEvent.pointerDown(overlay, { button: 0, clientX: xOf(20), clientY: 30, pointerId: 1 })
    expect(onNavigate).not.toHaveBeenCalled()
    fireEvent.pointerMove(overlay, { clientX: xOf(320), clientY: 30, pointerId: 1 })
    expect(onNavigate).toHaveBeenLastCalledWith(300)
  })

  it('remembers being collapsed per kind of view', () => {
    const first = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse overview' }))
    expect(first.container.querySelector('.minimap.collapsed')).not.toBeNull()
    first.unmount()
    const again = setup()
    expect(again.container.querySelector('.minimap.collapsed')).not.toBeNull()
    again.unmount()
    const other = setup([], { kind: 'alignment' })
    expect(other.container.querySelector('.minimap.collapsed')).toBeNull()
  })

  it('still navigates while collapsed', () => {
    localStorage.setItem('seqnexus_minimap_collapsed_sequence', '1')
    const { overlay, onNavigate } = setup()
    fireEvent.pointerDown(overlay, { button: 0, clientX: xOf(800), clientY: 4, pointerId: 1 })
    expect(onNavigate).toHaveBeenLastCalledWith(750)
  })

  it('names the feature under the pointer and reports it to the host', () => {
    const onHoverItem = vi.fn()
    const track = featureTrack({
      features: [{ id: 'lac', name: 'lacZ', type: 'CDS', start: 400, end: 600, strand: 1, color: '#3b82f6' }],
      formatRange: (s, e) => `${s + 1}–${e}`,
    })
    const { overlay } = setup([track], { onHoverItem })
    // Forward lane 0 sits just above the backbone: ruler (2 + 14) + 10px.
    fireEvent.pointerMove(overlay, { clientX: xOf(500), clientY: 2 + 14 + 12, pointerId: 1 })
    expect(screen.getByRole('status').textContent).toContain('lacZ')
    expect(screen.getByRole('status').textContent).toContain('CDS · 401–600')
    expect(onHoverItem).toHaveBeenLastCalledWith('lac')
    fireEvent.pointerLeave(overlay)
    expect(onHoverItem).toHaveBeenLastCalledWith(null)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
