/**
 * The pick-and-convert loop for both overlays, end to end through the panel bar.
 *
 * Picking happens on the canvas, which jsdom cannot lay out, so the pick set
 * is driven through the store here — what this covers is the wiring around it:
 * that results reach the overlay, that the bar offers the conversion, and that
 * converting leaves the document and the toggle in the state the user was
 * promised.
 */
import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import App from './App'
import { useEditorStore } from './store'
import { matchKey } from './utils/auto-annotations'
import { orfKey } from './utils/orf-features'
import type { AnnotationMatch } from './workers/annotate-list'
import type { ORFResult } from './workers/orf-finder'

const MATCHES: AnnotationMatch[] = [
  { refName: 'AmpR', refType: 'CDS', start: 0, end: 30, strand: 1, similarity: 98, color: '#ff0000' },
  { refName: 'lacZ', refType: 'CDS', start: 40, end: 70, strand: 1, similarity: 91, color: '#00ff00' },
]

// The real scan spawns a Web Worker, which jsdom has none of.
vi.mock('./workers/annotate-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workers/annotate-list')>()
  return { ...actual, annotateFromList: vi.fn(async () => MATCHES) }
})

const store = () => useEditorStore.getState()

/** Let pending promises (the scan, the session restore) and their renders run. */
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
}

/**
 * Mount the app and put a known document in front of it.
 *
 * App restores the last session — or loads the demo — asynchronously on mount,
 * and that lands on top of whatever the store held beforehand, so the document
 * has to be opened after it settles rather than in `beforeEach`.
 */
async function mountApp() {
  render(<App />)
  await settle()
  await act(async () => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pAuto', 'ATGC'.repeat(30))
  })
}

function button(label: string): HTMLButtonElement | null {
  return [...document.querySelectorAll('button')]
    .find(b => b.textContent?.replace(/\s+/g, ' ').trim() === label) as HTMLButtonElement ?? null
}

function toggleTitled(title: string): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
  if (!el) throw new Error(`no toggle titled "${title}"`)
  return el
}

const autoToggle = () => toggleTitled('Toggle auto-annotation suggestions')
const orfToggle = () => toggleTitled('Toggle ORF display')

describe('auto-annotation in the panel bar', () => {
  beforeEach(() => {
    store().clearAutoAnnotations()
  })

  it('offers no conversion until the overlay is on', async () => {
    await mountApp()
    expect(autoToggle().classList.contains('active')).toBe(false)
    expect(button('Add all (2)')).toBeNull()
  })

  it('scans when switched on and offers to add what it found', async () => {
    await mountApp()
    await act(async () => { autoToggle().click() })
    await settle()

    expect(store().autoAnnotations).toHaveLength(2)
    expect(autoToggle().textContent).toContain('2')
    expect(button('Add all (2)')).toBeTruthy()
    expect(button('Add picked (1)')).toBeNull()
  })

  it('offers the picked subset once something is picked', async () => {
    await mountApp()
    await act(async () => { autoToggle().click() })
    await settle()

    await act(async () => { store().toggleAutoAnnotationPick(matchKey(MATCHES[0])) })
    expect(button('Add picked (1)')).toBeTruthy()
    expect(button('Add all (2)')).toBeTruthy()
  })

  it('converts the picked suggestion and switches the overlay off', async () => {
    await mountApp()
    await act(async () => { autoToggle().click() })
    await settle()
    await act(async () => { store().toggleAutoAnnotationPick(matchKey(MATCHES[0])) })

    await act(async () => { button('Add picked (1)')!.click() })

    expect(store().doc.annotations.map(a => a.name)).toEqual(['AmpR (98%)'])
    expect(store().showAutoAnnotations).toBe(false)
    expect(autoToggle().classList.contains('active')).toBe(false)
  })

  it('does not suggest a converted feature again', async () => {
    await mountApp()
    await act(async () => { autoToggle().click() })
    await settle()
    await act(async () => { store().toggleAutoAnnotationPick(matchKey(MATCHES[0])) })
    await act(async () => { button('Add picked (1)')!.click() })

    // Switching back on re-scans and finds both again — but one of them is a
    // feature now, so only the other is still worth suggesting.
    await act(async () => { autoToggle().click() })
    await settle()

    expect(store().autoAnnotations).toHaveLength(2)
    expect(button('Add all (1)')).toBeTruthy()
    expect(button('Add all (2)')).toBeNull()
  })
})

const ORFS: ORFResult[] = [
  { start: 0, end: 30, strand: 1, frame: 0, codons: 10 },
  { start: 40, end: 70, strand: -1, frame: 1, codons: 10 },
]

describe('ORFs in the panel bar', () => {
  beforeEach(() => {
    store().clearOrfs()
  })

  /** The ORF finder runs from its own panel; here the results are given. */
  async function showOrfs() {
    await act(async () => { store().setOrfResults(ORFS) })
    await act(async () => { orfToggle().click() })
  }

  it('offers no conversion until the overlay is on', async () => {
    await mountApp()
    await act(async () => { store().setOrfResults(ORFS) })
    expect(button('Add all (2)')).toBeNull()
  })

  it('offers to add the ORFs it is displaying', async () => {
    await mountApp()
    await showOrfs()
    expect(button('Add all (2)')).toBeTruthy()
  })

  it('converts the picked ORF into a CDS feature and switches the overlay off', async () => {
    await mountApp()
    await showOrfs()
    await act(async () => { store().toggleOrfPick(orfKey(ORFS[0])) })

    expect(button('Add picked (1)')).toBeTruthy()
    await act(async () => { button('Add picked (1)')!.click() })

    expect(store().doc.annotations.map(a => a.name)).toEqual(['ORF +1 (10 aa)'])
    expect(store().doc.annotations[0].type).toBe('CDS')
    expect(store().showOrfs).toBe(false)
    expect(orfToggle().classList.contains('active')).toBe(false)
  })

  it('keeps displaying a converted ORF but stops offering it', async () => {
    await mountApp()
    await showOrfs()
    await act(async () => { store().toggleOrfPick(orfKey(ORFS[0])) })
    await act(async () => { button('Add picked (1)')!.click() })

    await act(async () => { orfToggle().click() })

    expect(orfToggle().textContent).toContain('2')
    expect(button('Add all (1)')).toBeTruthy()
    expect(button('Add all (2)')).toBeNull()
  })
})
