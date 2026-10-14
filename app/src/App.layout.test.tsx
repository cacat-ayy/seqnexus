/**
 * The toolbar's placement: along the top, or down the left as a rail of icons.
 * Switched from the Appearance popover, kept across reloads.
 */
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import App from './App'
import { useEditorStore } from './store'
import { STORAGE_KEYS } from './storage/keys'
import { useBlastStore, openDrawer as openBlastDrawer, closeDrawer as closeBlastDrawer } from './blast/session'

const store = () => useEditorStore.getState()
const root = () => document.querySelector<HTMLElement>('.app-root')!
const toolbar = () => document.querySelector<HTMLElement>('.toolbar')!

describe('toolbar placement', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pLayout', 'ATGCGATCGATCGATCGTAA')
  })
  afterEach(() => {
    act(() => store().setToolbarPlacement('top'))
    localStorage.removeItem(STORAGE_KEYS.layout)
  })

  it('runs along the top by default', () => {
    render(<App />)
    expect(root().dataset.toolbar).toBe('top')
    expect(toolbar().classList.contains('is-vertical')).toBe(false)
  })

  it('moves to the left from the Appearance popover, and back', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Left' }))
    expect(root().dataset.toolbar).toBe('left')
    expect(toolbar().classList.contains('is-vertical')).toBe(true)
    // A rail of icons from the start: labels never show down the left.
    expect(toolbar().classList.contains('is-icons')).toBe(true)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.layout)!)).toMatchObject({ toolbar: 'left' })
    // The popover stays open, so the two can be compared.
    expect(screen.getByRole('radio', { name: 'Left' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Top' }))
    expect(root().dataset.toolbar).toBe('top')
    expect(toolbar().classList.contains('is-vertical')).toBe(false)
  })

  it('puts zoom in above zoom out down the left', () => {
    act(() => store().setToolbarPlacement('left'))
    render(<App />)
    const zoom = [...toolbar().querySelectorAll<HTMLElement>('[data-tip^="Zoom"]')].map(b => b.dataset.tip)
    expect(zoom).toEqual(['Zoom in', 'Zoom out'])
  })
})

/**
 * The features panel's placement: on the right of the main area, or along
 * the bottom of the sequence view, from its header or the Appearance popover.
 */
describe('features panel placement', () => {
  const panel = () => document.querySelector<HTMLElement>('.feature-sidebar')
  // The store outlives each render, and a sidebar request left by an earlier
  // test opens the panel on mount: open it only if it is not already.
  const openPanel = () => {
    if (!panel()) fireEvent.click(document.querySelector<HTMLButtonElement>('button[title="Toggle feature sidebar"]')!)
  }

  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pPanel', 'ATGCGATCGATCGATCGTAA')
  })
  afterEach(() => {
    act(() => store().setPanelPlacement('right'))
    localStorage.removeItem(STORAGE_KEYS.layout)
    localStorage.removeItem(STORAGE_KEYS.featurePanelHeight)
  })

  it('sits on the right of the main area by default', () => {
    render(<App />)
    openPanel()
    expect(panel()!.classList.contains('is-bottom')).toBe(false)
    expect(panel()!.parentElement!.classList.contains('main-area')).toBe(true)
  })

  it('moves under the view from its header, keeping its tab, and back', () => {
    render(<App />)
    openPanel()
    act(() => store().setSidebarTab('primers'))
    fireEvent.click(screen.getByRole('button', { name: 'Move the panel to the bottom' }))
    expect(root().dataset.panel).toBe('bottom')
    const p = panel()!
    expect(p.classList.contains('is-bottom')).toBe(true)
    // Inside the sequence column, above the status bar.
    expect(p.parentElement!.classList.contains('center-panel')).toBe(true)
    expect(p.nextElementSibling!.classList.contains('status-bar')).toBe(true)
    expect(screen.getByRole('tab', { name: /Primers/ }).getAttribute('aria-selected')).toBe('true')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.layout)!)).toMatchObject({ panel: 'bottom' })
    fireEvent.click(screen.getByRole('button', { name: 'Move the panel to the right' }))
    expect(panel()!.parentElement!.classList.contains('main-area')).toBe(true)
  })

  it('switches from the Appearance popover too', () => {
    render(<App />)
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Bottom' }))
    expect(panel()!.classList.contains('is-bottom')).toBe(true)
  })

  it('resizes from its top edge with the arrow keys and keeps the height', () => {
    act(() => store().setPanelPlacement('bottom'))
    render(<App />)
    openPanel()
    const edge = screen.getByRole('separator', { name: 'Resize the features panel' })
    // jsdom has no layout, so the column has no room above the panel's
    // minimum: any step lands on 140px, and that is what is kept.
    expect(panel()!.style.height).toBe('260px')
    fireEvent.keyDown(edge, { key: 'ArrowDown', shiftKey: true })
    expect(panel()!.style.height).toBe('140px')
    expect(localStorage.getItem(STORAGE_KEYS.featurePanelHeight)).toBe('140')
  })
})

/**
 * Along the bottom, BLAST is the features panel's fourth tab: BLAST being
 * open is that tab showing. On the right it keeps its own drawer.
 */
describe('BLAST as a tab of the bottom panel', () => {
  const panel = () => document.querySelector<HTMLElement>('.feature-sidebar')
  const blastButton = () => toolbar().querySelector<HTMLButtonElement>('[data-tip="BLAST"]')!
  const blastOpen = () => useBlastStore.getState().open

  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pBlast', 'ATGCGATCGATCGATCGTAAGCTAGCTAGGATCC')
    act(() => store().setPanelPlacement('bottom'))
  })
  afterEach(() => {
    act(() => { closeBlastDrawer(); store().setPanelPlacement('right') })
    localStorage.removeItem(STORAGE_KEYS.layout)
  })

  it('opens the panel on its BLAST tab from the toolbar, and closes it again', async () => {
    render(<App />)
    // A sidebar request left by an earlier test may have opened the panel.
    if (panel()) fireEvent.click(screen.getByTitle('Close panel'))
    fireEvent.click(blastButton())
    expect(panel()).toBeTruthy()
    expect(screen.getByRole('tab', { name: /BLAST/ }).getAttribute('aria-selected')).toBe('true')
    // The search form, inside the panel rather than in a drawer of its own.
    expect(await screen.findByRole('group', { name: 'Search settings' }, { timeout: 5000 })).toBeTruthy()
    expect(panel()!.querySelector('.bd.bd-embedded')).toBeTruthy()
    fireEvent.click(blastButton())
    expect(blastOpen()).toBe(false)
    // BLAST had opened the panel, so it goes with it.
    expect(panel()).toBeNull()
  })

  it('closes BLAST when another tab is picked, and with the panel', async () => {
    render(<App />)
    act(() => openBlastDrawer())
    await screen.findByRole('group', { name: 'Search settings' }, { timeout: 5000 })
    fireEvent.click(screen.getByRole('tab', { name: /Features/ }))
    expect(blastOpen()).toBe(false)
    expect(screen.getByRole('tab', { name: /Features/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: /BLAST/ }))
    expect(blastOpen()).toBe(true)
    fireEvent.click(screen.getByTitle('Close panel'))
    expect(blastOpen()).toBe(false)
    expect(panel()).toBeNull()
  })

  it('hands an open search back to the drawer when the panel moves right', async () => {
    render(<App />)
    act(() => openBlastDrawer())
    await screen.findByRole('group', { name: 'Search settings' }, { timeout: 5000 })
    fireEvent.click(screen.getByRole('button', { name: 'Move the panel to the right' }))
    expect(blastOpen()).toBe(true)
    // The drawer, under the view, not in the sidebar, which has no BLAST tab.
    const drawer = await screen.findByRole('region', { name: 'BLAST' }, { timeout: 5000 })
    expect(drawer.closest('.feature-sidebar')).toBeNull()
    expect(screen.queryByRole('tab', { name: /BLAST/ })).toBeNull()
  })
})
