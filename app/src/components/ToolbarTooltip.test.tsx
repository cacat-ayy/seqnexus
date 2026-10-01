import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRef } from 'react'
import { ToolbarTooltip, tip } from './ToolbarTooltip'

function Bar({ disabled = false }: { disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <>
      <div ref={ref} data-testid="bar">
        <button disabled={disabled} {...tip({ label: 'Primers', shortcut: 'Ctrl+P', desc: 'Design primers', why: 'Open a sequence to use this' })}>
          P
        </button>
        <button {...tip({ label: 'Align' })}>A</button>
      </div>
      <ToolbarTooltip container={ref} />
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
})
