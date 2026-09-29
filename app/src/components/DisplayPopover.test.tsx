import { render, screen, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRef } from 'react'
import DisplayPopover from './DisplayPopover'
import { useEditorStore } from '../store'
import { COLOR_SCHEMES } from '../utils/base-colors'
import { PLASMID_STYLES } from '../plasmid/styles'
import { GENETIC_CODES } from '../codon/genetic-codes'
import { AMINO_ACID_STYLES, TRANSLATION_FRAMES } from '../codon/translation-display'
import { loadDisplaySettings } from '../utils/display-settings'

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
    // Scoped to the scheme list: the amino acid palettes share several names
    // with the base ones, Clustal and MacClade among them.
    const labels = [...document.querySelectorAll('.dp-scheme-list .dp-scheme-label')]
      .map(el => el.textContent)
    for (const s of COLOR_SCHEMES) expect(labels).toContain(s.label)
  })

  it('marks exactly one scheme as chosen', () => {
    show()
    // Scoped to the scheme list: the Letters/Background selector is also a
    // radiogroup, and its checked button would otherwise be counted here.
    const schemes = [...document.querySelectorAll('[aria-labelledby="dp-scheme-label"] [role="radio"]')]
    const checked = schemes.filter(r => r.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(checked[0].textContent).toContain('Nucleotide')
  })

  it('selecting a scheme updates the store', () => {
    show()
    const clustal = [...document.querySelectorAll<HTMLButtonElement>('.dp-scheme-list .dp-scheme')]
      .find(b => b.textContent?.includes('Clustal'))!
    act(() => { clustal.click() })
    expect(store().colorScheme).toBe('clustal')
  })

  it('previews each scheme with its own colours, not the label', () => {
    show()
    // The swatch is the only way to tell GC-vs-AT from Purine-vs-Pyrimidine
    // at a glance, so it must actually be colourised.
    const swatches = document.querySelectorAll('[aria-labelledby="dp-scheme-label"] .dp-swatch')
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

describe('DisplayPopover: plasmid map', () => {
  beforeEach(() => {
    localStorage.clear()
    store().setPlasmidStyle('modern')
  })

  it('offers every predefined style', () => {
    show()
    for (const s of PLASMID_STYLES) expect(screen.getByText(s.label)).toBeTruthy()
  })

  it('marks exactly one style as chosen', () => {
    show()
    const styles = [...document.querySelectorAll('.dp-style-list [role="radio"]')]
    const checked = styles.filter(r => r.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(checked[0].textContent).toContain('Modern')
  })

  it('selecting a style updates the store', () => {
    show()
    act(() => { screen.getByText('Publication').closest('button')!.click() })
    expect(store().plasmidStyle).toBe('publication')
  })

  it('reserves the tick on every row, so choosing a style cannot resize the menu', () => {
    // The tick used to be rendered only on the active row, which made the
    // widest row change as the selection moved.
    show()
    const rows = [...document.querySelectorAll('.dp-style-list .dp-style')]
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) expect(row.querySelector('.dp-style-check')).not.toBeNull()
  })

  it('puts the name before the tick, not after it', () => {
    show()
    const active = document.querySelector('.dp-style.active')!
    // getAttribute, not .className: the tick is an SVG element, whose
    // className is an SVGAnimatedString rather than a string.
    const children = [...active.children].map(c => c.getAttribute('class') ?? '')
    expect(children[0]).toContain('dp-style-text')
    expect(children[children.length - 1]).toContain('dp-style-check')
  })

  it('toggles the GC ring and the colour key', () => {
    show()
    act(() => { screen.getByLabelText('GC content and skew ring').click() })
    expect(store().showGcRing).toBe(true)
    act(() => { screen.getByLabelText('Feature colour key').click() })
    expect(store().showPlasmidLegend).toBe(true)
  })
})

describe('translation', () => {
  beforeEach(() => {
    localStorage.clear()
    act(() => {
      const s = store()
      if (!s.showTranslation) s.toggleTranslation()
      s.setTranslationFrame('selection-or-annotation')
      s.setTranslationCode(1)
      s.setAminoAcidStyle('none')
      if (s.threeLetterAminoAcids) s.toggleThreeLetterAminoAcids()
    })
  })

  const field = (label: string): HTMLSelectElement => {
    const row = [...document.querySelectorAll('.dp-field')]
      .find(el => el.querySelector('.dp-field-label')?.textContent === label)
    if (!row) throw new Error(`no field "${label}"`)
    return row.querySelector('select')!
  }

  const aaTrigger = (): HTMLButtonElement => {
    const el = document.querySelector<HTMLButtonElement>('.dp-aa-trigger')
    if (!el) throw new Error('no palette dropdown')
    return el
  }

  const openAaMenu = () => {
    if (!document.querySelector('.dp-aa-menu')) act(() => { aaTrigger().click() })
  }

  const aaRows = (): HTMLButtonElement[] =>
    [...document.querySelectorAll<HTMLButtonElement>('.dp-aa-menu .dp-scheme')]

  const aaRow = (label: string): HTMLButtonElement => {
    const row = aaRows().find(el => el.querySelector('.dp-scheme-label')?.textContent === label)
    if (!row) throw new Error(`no palette "${label}"`)
    return row
  }

  const checkbox = (label: string): HTMLInputElement => {
    const row = [...document.querySelectorAll('.dp-check')]
      .find(el => el.textContent?.includes(label))
    if (!row) throw new Error(`no checkbox "${label}"`)
    return row.querySelector('input')!
  }

  it('shows amino acids by default, following the features', () => {
    show()
    expect(checkbox('Show amino acids').checked).toBe(true)
    expect(field('Frame').value).toBe('selection-or-annotation')
  })

  it('hides the options when the translation is off', () => {
    show()
    act(() => { checkbox('Show amino acids').click() })

    expect(store().showTranslation).toBe(false)
    expect(document.querySelectorAll('.dp-field')).toHaveLength(0)
    expect(document.querySelectorAll('[aria-labelledby="dp-aa-label"]')).toHaveLength(0)
  })

  it('offers every frame, grouped', () => {
    show()
    const options = [...field('Frame').querySelectorAll('option')].map(o => o.value)
    expect(options).toHaveLength(TRANSLATION_FRAMES.length)
    expect(options).toContain('all')
    expect(options).toContain('r23')
    expect(field('Frame').querySelectorAll('optgroup').length).toBeGreaterThan(1)
  })

  it('offers the same genetic codes as the optimizer', () => {
    show()
    const options = [...field('Genetic code').querySelectorAll('option')].map(o => Number(o.value))
    expect(options).toEqual(GENETIC_CODES.map(c => c.id))
  })

  it('offers every amino acid palette, previewed in its own colours', () => {
    show()
    // Closed by default: the trigger previews the current palette on its own.
    expect(document.querySelector('.dp-aa-menu')).toBeNull()
    expect(aaTrigger().querySelectorAll('.dp-swatch span')).toHaveLength(5)

    openAaMenu()
    const rows = aaRows()
    expect(rows.map(r => r.querySelector('.dp-scheme-label')?.textContent))
      .toEqual(AMINO_ACID_STYLES.map(s => s.label))

    // Each row previews the same residues, so the rows differ only by colour.
    for (const row of rows) {
      expect(row.querySelectorAll('.dp-swatch span')).toHaveLength(5)
    }

    // And the preview is actually colourised, not just the label.
    const clustal = rows.find(r => r.textContent?.includes('Clustal'))!
    const colours = [...clustal.querySelectorAll<HTMLElement>('.dp-swatch span')]
      .map(el => el.style.color)
    expect(new Set(colours).size).toBeGreaterThan(1)
    expect(colours).not.toContain('currentcolor')
  })

  it('writes each choice to the store', () => {
    show()
    act(() => { fireEvent.change(field('Frame'), { target: { value: 'all' } }) })
    expect(store().translationFrame).toBe('all')

    act(() => { fireEvent.change(field('Genetic code'), { target: { value: '2' } }) })
    expect(store().translationCodeId).toBe(2)

    openAaMenu()
    act(() => { aaRow('Clustal').click() })
    expect(store().aminoAcidStyle).toBe('clustal')
    expect(document.querySelector('.dp-aa-menu')).toBeNull()

    act(() => { checkbox('Three-letter codes').click() })
    expect(store().threeLetterAminoAcids).toBe(true)
  })

  it('closes the palette menu on a second click, on Escape and on an outside click', () => {
    show()
    openAaMenu()
    expect(document.querySelector('.dp-aa-menu')).toBeTruthy()

    act(() => { aaTrigger().click() })
    expect(document.querySelector('.dp-aa-menu')).toBeNull()

    openAaMenu()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('.dp-aa-menu')).toBeNull()

    openAaMenu()
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(document.querySelector('.dp-aa-menu')).toBeNull()
  })

  it('previews the chosen palette on the closed trigger', () => {
    show()
    openAaMenu()
    act(() => { aaRow('RasMol').click() })

    expect(aaTrigger().textContent).toContain('RasMol')
    const colours = [...aaTrigger().querySelectorAll<HTMLElement>('.dp-swatch span')]
      .map(el => el.style.color)
    expect(new Set(colours).size).toBeGreaterThan(1)
  })

  it('remembers the choices across a reload', () => {
    show()
    act(() => { fireEvent.change(field('Frame'), { target: { value: 'f2' } }) })
    expect(loadDisplaySettings().translationFrame).toBe('f2')
  })
})
