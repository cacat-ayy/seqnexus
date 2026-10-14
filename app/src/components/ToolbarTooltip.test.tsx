import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRef } from 'react'
import { ToolbarTooltip } from './ToolbarTooltip'
import { tip } from './toolbarTip'

function Bar({ disabled = false, placement }: { disabled?: boolean; placement?: 'below' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <>
      <div ref={ref} data-testid="bar">
        <button disabled={disabled} {...tip({ label: 'Primers', shortcut: 'Ctrl+P', desc: 'Design primers', why: 'Open a sequence to use this' })}>
          P
        </button>
        <button {...tip({ label: 'Align' })}>A</button>
      </div>
      <ToolbarTooltip container={ref} placement={placement} />
    </>
  )
}

// fireEvent.pointerOver builds a PointerEvent jsdom lacks; a MouseEvent under
// the same name reaches the same listener.
const hover = (el: Element) => fireEvent(el, new MouseEvent('pointerover', { bubbles: true }))

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('ToolbarTooltip', () => {
  it('names the button for assistive tech even with its text hidden', () => {
    render(<Bar />)
    expect(screen.getByRole('button', { name: 'Primers' })).toBeTruthy()
  })

  it('shows name, shortcut and description after a delay', () => {
    render(<Bar />)
    hover(screen.getByRole('button', { name: 'Primers' }))
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => { vi.advanceTimersByTime(500) })
    const t = screen.getByRole('tooltip')
    expect(t.textContent).toContain('Primers')
    expect(t.textContent).toContain('Ctrl+P')
    expect(t.textContent).toContain('Design primers')
    // Enabled, so there is nothing to explain.
    expect(t.textContent).not.toContain('Open a sequence')
  })

  it('says why a disabled button is disabled', () => {
    render(<Bar disabled />)
    hover(screen.getByRole('button', { name: 'Primers' }))
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByRole('tooltip').textContent).toContain('Open a sequence to use this')
  })

  it('moves straight to a neighbour once one tooltip is showing', () => {
    render(<Bar />)
    hover(screen.getByRole('button', { name: 'Primers' }))
    act(() => { vi.advanceTimersByTime(500) })
    hover(screen.getByRole('button', { name: 'Align' }))
    expect(screen.getByRole('tooltip').textContent).toContain('Align')
  })

  it('hides on click and stays hidden over the same button', () => {
    render(<Bar />)
    const btn = screen.getByRole('button', { name: 'Primers' })
    hover(btn)
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent(btn, new MouseEvent('pointerdown', { bubbles: true }))
    expect(screen.queryByRole('tooltip')).toBeNull()
    hover(btn.firstElementChild ?? btn)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('opens to the right of a button in a toolbar down the left', () => {
    render(<Bar placement="right" />)
    const btn = screen.getByRole('button', { name: 'Primers' })
    btn.getBoundingClientRect = () => ({ left: 8, right: 40, top: 200, bottom: 232, width: 32, height: 32, x: 8, y: 200, toJSON: () => ({}) }) as DOMRect
    hover(btn)
    act(() => { vi.advanceTimersByTime(500) })
    const t = screen.getByRole('tooltip')
    expect(t.classList.contains('tb-tooltip-right')).toBe(true)
    // Beside the button, not under it.
    expect(t.style.left).toBe('46px')
  })
})
