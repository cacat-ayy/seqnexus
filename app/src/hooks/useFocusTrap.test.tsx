import { describe, it, expect } from 'vitest'
import { useRef, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useFocusTrap } from './useFocusTrap'

function Dialog({ open, children }: { open: boolean; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, open)
  if (!open) return null
  return (
    <div ref={ref} tabIndex={-1} data-testid="dialog">
      {children ?? (
        <>
          <button>first</button>
          <button>middle</button>
          <button>last</button>
        </>
      )}
    </div>
  )
}

function Harness({ initiallyOpen = false, children }: { initiallyOpen?: boolean; children?: React.ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <>
      <button onClick={() => setOpen(true)}>opener</button>
      <button>outside</button>
      <Dialog open={open}>{children}</Dialog>
    </>
  )
}

describe('useFocusTrap', () => {
  it('moves focus into the dialog when it opens', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByText('opener'))
    expect(screen.getByTestId('dialog')).toHaveFocus()
  })

  it('wraps forward from the last element to the first', async () => {
    const user = userEvent.setup()
    render(<Harness initiallyOpen />)

    screen.getByText('last').focus()
    await user.tab()
    expect(screen.getByText('first')).toHaveFocus()
  })

  it('wraps backward from the first element to the last', async () => {
    const user = userEvent.setup()
    render(<Harness initiallyOpen />)

    screen.getByText('first').focus()
    await user.tab({ shift: true })
    expect(screen.getByText('last')).toHaveFocus()
  })

  it('keeps Tab inside the dialog rather than reaching page controls', async () => {
    const user = userEvent.setup()
    render(<Harness initiallyOpen />)

    const inside = ['first', 'middle', 'last']
    screen.getByText('first').focus()
    // A full cycle plus one must never land on anything outside.
    for (let i = 0; i < 6; i++) {
      await user.tab()
      expect(inside).toContain(document.activeElement?.textContent)
    }
  })

  it('restores focus to the opener when the dialog closes', async () => {
    const user = userEvent.setup()

    function Closable() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>opener</button>
          <Dialog open={open}>
            <button onClick={() => setOpen(false)}>close</button>
          </Dialog>
        </>
      )
    }

    render(<Closable />)
    const opener = screen.getByText('opener')

    opener.focus()
    await user.click(opener)
    expect(screen.getByTestId('dialog')).toHaveFocus()

    await user.click(screen.getByText('close'))
    expect(opener).toHaveFocus()
  })

  it('does not steal focus if something inside is already focused', async () => {
    function PreFocused() {
      const ref = useRef<HTMLDivElement>(null)
      useFocusTrap(ref, true)
      return (
        <div ref={ref} tabIndex={-1} data-testid="dialog">
          <input autoFocus data-testid="field" />
        </div>
      )
    }
    render(<PreFocused />)
    expect(screen.getByTestId('field')).toHaveFocus()
  })

  it('holds focus on the dialog when it contains nothing focusable', async () => {
    const user = userEvent.setup()
    render(
      <Harness initiallyOpen>
        <p>nothing to focus here</p>
      </Harness>,
    )

    const dialog = screen.getByTestId('dialog')
    expect(dialog).toHaveFocus()
    await user.tab()
    expect(dialog).toHaveFocus()
  })

  it('skips disabled controls when cycling', async () => {
    const user = userEvent.setup()
    render(
      <Harness initiallyOpen>
        <button>first</button>
        <button disabled>skipped</button>
        <button>last</button>
      </Harness>,
    )

    screen.getByText('first').focus()
    await user.tab()
    expect(screen.getByText('last')).toHaveFocus()
  })

  it('only the innermost of two stacked dialogs traps focus', async () => {
    const user = userEvent.setup()

    function Nested() {
      const outer = useRef<HTMLDivElement>(null)
      const inner = useRef<HTMLDivElement>(null)
      useFocusTrap(outer, true)
      useFocusTrap(inner, true)
      return (
        <div ref={outer} tabIndex={-1}>
          <button>outer-btn</button>
          <div ref={inner} tabIndex={-1} data-testid="inner">
            <button>inner-a</button>
            <button>inner-b</button>
          </div>
        </div>
      )
    }

    render(<Nested />)
    screen.getByText('inner-b').focus()
    await user.tab()
    // Cycles within the inner dialog, not out to outer-btn.
    expect(screen.getByText('inner-a')).toHaveFocus()
  })
})
