/**
 * Panel-bar toggle state.
 *
 * The ORFs / REs / Primers / Features switches carry their on-state purely
 * through an `active` class. That makes it possible to break the indicator
 * without breaking anything a type-check or a behavioural test would notice —
 * which is exactly what happened once: an edit dropped the `${...}` out of the
 * className template and the toggles silently stopped showing any state at all.
 */
import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import App from './App'
import { useEditorStore } from './store'

const store = () => useEditorStore.getState()

const TOGGLES = [
  ['Toggle feature sidebar', 'Features'],
  ['Toggle ORF display', 'ORFs'],
  ['Toggle restriction enzyme display', 'REs'],
  ['Toggle primer display', 'Primers'],
] as const

function toggle(title: string): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
  if (!el) throw new Error(`no toggle titled "${title}"`)
  return el
}

describe('panel bar toggles', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pToggle', 'ATGCGATCGATCGATCGTAA')
  })

  it('renders every toggle', () => {
    render(<App />)
    for (const [title] of TOGGLES) expect(toggle(title)).toBeTruthy()
  })

  it.each(TOGGLES)('%s reflects its on-state in both class and aria', (title) => {
    render(<App />)
    const btn = toggle(title)

    const startedActive = btn.classList.contains('active')
    expect(btn.getAttribute('aria-pressed')).toBe(String(startedActive))

    act(() => { btn.click() })
    expect(btn.classList.contains('active')).toBe(!startedActive)
    expect(btn.getAttribute('aria-pressed')).toBe(String(!startedActive))

    act(() => { btn.click() })
    expect(btn.classList.contains('active')).toBe(startedActive)
    expect(btn.getAttribute('aria-pressed')).toBe(String(startedActive))
  })

  it('keeps the class and aria state in step with each other', () => {
    // They are written independently in the JSX, so one can rot without the
    // other. Flip several and check they never disagree.
    render(<App />)
    for (const [title] of TOGGLES) {
      const btn = toggle(title)
      act(() => { btn.click() })
      expect(btn.classList.contains('active')).toBe(btn.getAttribute('aria-pressed') === 'true')
    }
  })

  it('toggles are independent — several can be on at once', () => {
    // If these were mutually exclusive the underline styling would have been
    // right; they are not, which is why they read as switches.
    render(<App />)
    const orfs = toggle('Toggle ORF display')
    const res = toggle('Toggle restriction enzyme display')

    act(() => { orfs.click() })
    act(() => { res.click() })

    expect(orfs.classList.contains('active')).toBe(true)
    expect(res.classList.contains('active')).toBe(true)
  })
})
