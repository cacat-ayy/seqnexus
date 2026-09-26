/**
 * Converting ORFs from the ORF panel.
 *
 * The panel is where people look at ORFs, so the pick-and-convert affordance
 * has to exist here too — Ctrl-click on a position badge is the list's version
 * of Ctrl-click on the canvas, which jsdom cannot exercise.
 */
import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import ORFPanel from './ORFPanel'
import { useEditorStore } from '../store'
import type { ORFResult } from '../workers/orf-finder'

const ORFS: ORFResult[] = [
  { start: 0, end: 30, strand: 1, frame: 0, codons: 10 },
  { start: 40, end: 70, strand: 1, frame: 1, codons: 10 },
]

// The finder runs in a Web Worker, which jsdom has none of.
vi.mock('../workers/orf-finder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../workers/orf-finder')>()
  return { ...actual, findORFs: vi.fn(async () => ORFS) }
})

const store = () => useEditorStore.getState()

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
}

function button(label: string): HTMLButtonElement | null {
  return [...document.querySelectorAll('button')]
    .find(b => b.textContent?.replace(/\s+/g, ' ').trim() === label) as HTMLButtonElement ?? null
}

function badges(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.re-site-badge')]
}

async function openPanel() {
  render(<ORFPanel open onClose={() => {}} />)
  await settle()
}

describe('ORF panel conversion', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pOrf', 'ATGC'.repeat(30))
    store().clearOrfs()
  })

  it('offers to add the ORFs it found', async () => {
    await openPanel()
    expect(badges()).toHaveLength(2)
    expect(button('Add all (2)')).toBeTruthy()
  })

  it('picks on Ctrl-click, and leaves a plain click selecting the bases', async () => {
    await openPanel()

    await act(async () => { badges()[0].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(store().orfPicks.size).toBe(0)
    expect(store().selection).toEqual({ anchor: 0, caret: 30 })

    await act(async () => {
      badges()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    })
    expect(store().orfPicks.size).toBe(1)
    expect(badges()[0].classList.contains('picked')).toBe(true)
    expect(button('Add picked (1)')).toBeTruthy()
  })

  it('converts the picked ORF into a CDS feature', async () => {
    await openPanel()
    await act(async () => {
      badges()[1].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))
    })
    await act(async () => { button('Add picked (1)')!.click() })

    expect(store().doc.annotations.map(a => a.name)).toEqual(['ORF +2 (10 aa)'])
    expect(store().doc.annotations[0].type).toBe('CDS')
    expect(store().showOrfs).toBe(false)
  })

  it('keeps listing a converted ORF but stops offering it', async () => {
    await openPanel()
    await act(async () => { button('Add all (2)')!.click() })

    expect(store().doc.annotations).toHaveLength(2)
    // Still two reading frames — being annotated does not stop it being one.
    expect(badges()).toHaveLength(2)
    expect(button('Add all (2)')).toBeNull()
    expect(button('Add all (1)')).toBeNull()
  })
})
