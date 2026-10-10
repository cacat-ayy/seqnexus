import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useBackdropDismiss } from './useBackdropDismiss'

function Dialog({ onClose }: { onClose: () => void }) {
  const backdrop = useBackdropDismiss(onClose)
  return (
    <div data-testid="backdrop" {...backdrop}>
      <div role="dialog">
        <input aria-label="name" defaultValue="some text" />
      </div>
    </div>
  )
}

describe('useBackdropDismiss', () => {
  afterEach(cleanup)

  it('closes on a click that starts and ends on the backdrop', () => {
    const onClose = vi.fn()
    render(<Dialog onClose={onClose} />)
    const backdrop = screen.getByTestId('backdrop')
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays open when a text selection started in a field ends on the backdrop', () => {
    const onClose = vi.fn()
    render(<Dialog onClose={onClose} />)
    // The browser sends the click to the element holding both ends: the backdrop.
    fireEvent.mouseDown(screen.getByLabelText('name'))
    fireEvent.click(screen.getByTestId('backdrop'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open for a press on the backdrop released inside the dialog', () => {
    const onClose = vi.fn()
    render(<Dialog onClose={onClose} />)
    fireEvent.mouseDown(screen.getByTestId('backdrop'))
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
