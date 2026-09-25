import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRef } from 'react'
import DisplayPopover from './DisplayPopover'
import { useEditorStore } from '../store'
import { COLOR_SCHEMES } from '../utils/base-colors'

const store = () => useEditorStore.getState()

function show() {
  const triggerRef = createRef<HTMLElement>()
  render(<DisplayPopover open onClose={vi.fn()} triggerRef={triggerRef} />)
}

describe('DisplayPopover', () => {
  beforeEach(() => {
    localStorage.clear()
    store().setColorScheme('nucleotide')
    if (!store().showComplement) store().toggleComplement()
    if (!store().showAnnotationTracks) store().toggleAnnotationTracks()
  })

  it('renders nothing when closed', () => {
    const triggerRef = createRef<HTMLElement>()
    render(<DisplayPopover open={false} onClose={vi.fn()} triggerRef={triggerRef} />)
    expect(document.querySelector('.dp-popover')).toBeNull()
  })

  it('offers every colour scheme', () => {
    show()
    for (const s of COLOR_SCHEMES) expect(screen.getByText(s.label)).toBeTruthy()
  })

  it('marks exactly one scheme as chosen', () => {
    show()
    // Scoped to the scheme list: the Letters/Background selector is also a
    // radiogroup, and its checked button would otherwise be counted here.
    const schemes = [...document.querySelectorAll('.dp-scheme-list [role="radio"]')]
    const checked = schemes.filter(r => r.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(checked[0].textContent).toContain('Nucleotide')
  })

  it('selecting a scheme updates the store', () => {
    show()
    act(() => { screen.getByText('Clustal').closest('button')!.click() })
    expect(store().colorScheme).toBe('clustal')
  })

  it('previews each scheme with its own colours, not the label', () => {
    show()
    // The swatch is the only way to tell GC-vs-AT from Purine-vs-Pyrimidine
    // at a glance, so it must actually be colourised.
    const swatches = document.querySelectorAll('.dp-swatch')
    expect(swatches).toHaveLength(COLOR_SCHEMES.length)
    const nucleotide = screen.getByText('Nucleotide').closest('button')!
    const letters = nucleotide.querySelectorAll<HTMLElement>('.dp-swatch span')
    expect(letters).toHaveLength(4)
    expect(new Set([...letters].map(l => l.style.color)).size).toBe(4)
  })

  it('toggles the complement strand', () => {
    show()
    const box = screen.getByLabelText('Complement strand', { selector: 'input' })
    expect((box as HTMLInputElement).checked).toBe(true)
    act(() => { box.click() })
    expect(store().showComplement).toBe(false)
  })

  it('toggles the annotation tracks', () => {
    show()
    const box = screen.getByLabelText('Annotation tracks', { selector: 'input' })
    act(() => { box.click() })
    expect(store().showAnnotationTracks).toBe(false)
  })

  it('says the settings are global, since its neighbours are per-document', () => {
    show()
    expect(screen.getByText(/Applies to all sequences/i)).toBeTruthy()
  })
})

describe('colour target', () => {
  beforeEach(() => {
    localStorage.clear()
    store().setColorScheme('nucleotide')
    store().setColorTarget('letters')
  })

  it('offers Letters and Background', () => {
    show()
    expect(screen.getByRole('radio', { name: 'Letters' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Background' })).toBeTruthy()
  })

  it('switching to Background updates the store', () => {
    show()
    act(() => { screen.getByRole('radio', { name: 'Background' }).click() })
    expect(store().colorTarget).toBe('background')
  })

  it('previews as tinted letters in Letters mode', () => {
    show()
    const swatch = screen.getByText('Nucleotide').closest('button')!.querySelector('.dp-swatch')!
    expect(swatch.classList.contains('filled')).toBe(false)
    const a = swatch.querySelector<HTMLElement>('span')!
    expect(a.style.background).toBe('')
    expect(a.style.color).not.toBe('')
  })

  it('previews as filled cells in Background mode', () => {
    store().setColorTarget('background')
    show()
    const swatch = screen.getByText('Nucleotide').closest('button')!.querySelector('.dp-swatch')!
    expect(swatch.classList.contains('filled')).toBe(true)
    const a = swatch.querySelector<HTMLElement>('span')!
    // The fill carries the base colour and the glyph flips to something legible.
    expect(a.style.background).not.toBe('')
    expect(['rgb(0, 0, 0)', 'rgb(255, 255, 255)']).toContain(a.style.color)
  })

  it('never fills for the None scheme — there is no colour to fill with', () => {
    store().setColorTarget('background')
    show()
    const swatch = screen.getByText('None').closest('button')!.querySelector('.dp-swatch')!
    expect(swatch.classList.contains('filled')).toBe(false)
  })

  it('disables the target buttons while None is selected', () => {
    store().setColorScheme('none')
    show()
    expect(screen.getByRole('radio', { name: 'Background' })).toBeDisabled()
  })
})
