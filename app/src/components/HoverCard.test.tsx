import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import HoverCard, { PinnedCardHost } from './HoverCard'

function setup() {
  return render(
    <>
      <HoverCard x={10} y={10} pinKey="ann:a1"><div>lacZ card</div></HoverCard>
      <PinnedCardHost />
    </>,
  )
}

const pinned = () => screen.queryByRole('dialog', { name: 'Pinned details' })

describe('HoverCard pinning', () => {
  afterEach(() => {
    // The pin outlives the card; clear it between tests.
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }) })
    cleanup()
  })

  it('pins a copy on a Shift tap, and hides the hover twin', () => {
    setup()
    fireEvent.keyDown(window, { key: 'Shift' })
    fireEvent.keyUp(window, { key: 'Shift' })
    expect(pinned()).toHaveTextContent('lacZ card')
    expect(screen.getAllByText('lacZ card')).toHaveLength(1)
  })

  it('does not pin when Shift was used with another key or a click', () => {
    setup()
    fireEvent.keyDown(window, { key: 'Shift' })
    fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyUp(window, { key: 'Shift' })
    expect(pinned()).toBeNull()
    fireEvent.keyDown(window, { key: 'Shift' })
    fireEvent.mouseDown(window)
    fireEvent.keyUp(window, { key: 'Shift' })
    expect(pinned()).toBeNull()
  })

  it('unpins on Escape, on its close button and on a click elsewhere', () => {
    setup()
    const pin = () => { fireEvent.keyDown(window, { key: 'Shift' }); fireEvent.keyUp(window, { key: 'Shift' }) }
    pin()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(pinned()).toBeNull()
    pin()
    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }))
    expect(pinned()).toBeNull()
    pin()
    fireEvent.mouseDown(document.body)
    expect(pinned()).toBeNull()
  })
})
