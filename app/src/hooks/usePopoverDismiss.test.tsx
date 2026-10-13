/**
 * Escape on popovers: the top one closes, focus goes back to its button, and
 * the key does not reach whatever is underneath.
 */
import { render, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useRef, useState } from 'react'
import { usePopoverDismiss } from './usePopoverDismiss'

function Popover({ label, onClosed, children }: { label: string; onClosed?: () => void; children?: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  usePopoverDismiss(open, () => { setOpen(false); onClosed?.() }, popRef, btnRef)
  return (
    <div>
      <button ref={btnRef} onClick={() => setOpen(true)}>{label}</button>
      {open && <div ref={popRef} data-testid={`${label}-pop`}><input aria-label={`${label} field`} />{children}</div>}
    </div>
  )
}

afterEach(() => { document.body.innerHTML = '' })

describe('usePopoverDismiss', () => {
  it('closes on Escape and gives the focus back to the button that opened it', () => {
    const { queryByTestId, getByLabelText, getByText } = render(<Popover label="theme" />)
    getByLabelText('theme field').focus()
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }) })
    expect(queryByTestId('theme-pop')).toBeNull()
    expect(document.activeElement).toBe(getByText('theme'))
  })

  it('closes only the most recently opened one per press', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    // The inner one opens after the outer, as a menu inside a popover does.
    function Nested() {
      const [innerShown, setInnerShown] = useState(false)
      return (
        <Popover label="outer" onClosed={outer}>
          <button onClick={() => setInnerShown(true)}>more</button>
          {innerShown && <Popover label="inner" onClosed={inner} />}
        </Popover>
      )
    }
    const { queryByTestId, getByText } = render(<Nested />)
    act(() => { getByText('more').click() })
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }) })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
    expect(queryByTestId('outer-pop')).not.toBeNull()
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }) })
    expect(outer).toHaveBeenCalledTimes(1)
  })

  it('keeps the key from whatever is underneath', () => {
    const below = vi.fn()
    window.addEventListener('keydown', below)
    render(<Popover label="menu" />)
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }) })
    expect(below).not.toHaveBeenCalled()
    // With nothing open, Escape goes through again.
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }) })
    expect(below).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', below)
  })
})
