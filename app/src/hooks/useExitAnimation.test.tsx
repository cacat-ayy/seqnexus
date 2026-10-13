import { describe, it, expect } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useExitAnimation } from './useExitAnimation'

type Hook = ReturnType<typeof useExitAnimation>

function Probe({ open, grab }: { open: boolean; grab: (h: Hook) => void }) {
  const h = useExitAnimation(open)
  grab(h)
  if (!h.visible) return null
  return <div data-testid="panel" className={h.closing ? 'closing' : ''} onAnimationEnd={h.onAnimationEnd} />
}

describe('useExitAnimation', () => {
  it('hides after the exit animation', () => {
    let hook: Hook | null = null
    const { rerender } = render(<Probe open grab={h => { hook = h }} />)
    rerender(<Probe open={false} grab={h => { hook = h }} />)
    const el = screen.getByTestId('panel')
    act(() => hook!.onAnimationEnd({ target: el, currentTarget: el } as unknown as React.AnimationEvent))
    expect(screen.queryByTestId('panel')).toBeNull()
  })

  // Reopened just as the exit animation ended: the handler from the closing
  // render used to hide the panel while it was open, for good.
  it('stays shown when the end of an exit animation arrives after it was opened again', () => {
    let hook: Hook | null = null
    const { rerender } = render(<Probe open grab={h => { hook = h }} />)
    rerender(<Probe open={false} grab={h => { hook = h }} />)
    const stale = hook!.onAnimationEnd
    rerender(<Probe open grab={h => { hook = h }} />)
    const el = screen.getByTestId('panel')
    act(() => stale({ target: el, currentTarget: el } as unknown as React.AnimationEvent))
    expect(screen.getByTestId('panel')).toBeTruthy()
  })
})
