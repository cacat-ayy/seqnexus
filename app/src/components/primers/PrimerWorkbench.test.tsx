/**
 * The workbench loop: select a region, the design follows, pick a pair,
 * save it as primers in one undo entry. Workers do not exist under jsdom,
 * so the design runs inline and only the debounce is waited for.
 */
import { render, screen, act, waitFor, cleanup, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import PrimerWorkbench from './PrimerWorkbench'
import { useEditorStore } from '../../store'
import { DEFAULT_SETTINGS } from '../../primers/design/settings'

const store = () => useEditorStore.getState()

function template(n: number, seed = 42): string {
  let x = seed
  let s = ''
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5
    s += 'ACGT'[(x >>> 7) & 3]
  }
  return s
}

const undoDepth = () => store().tabs.find(t => t.id === store().activeTabId)!.undoStack.length

/** The top-ranked pair's button. By position: its name runs "#1523 bp…", so
 *  matching on "#1" would also hit #10 to #19. */
const firstPair = () => within(screen.getByRole('list', { name: 'Best pairs' })).getAllByRole('button')[0]

describe('PrimerWorkbench', () => {
  beforeEach(() => {
    localStorage.setItem('seqnexus:primer-design', JSON.stringify({
      ...DEFAULT_SETTINGS, minTm: 45, maxTm: 75, minGC: 30, maxGC: 70, minProduct: 250, maxProduct: 600,
    }))
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pDesign', template(3000))
    store().clearDesign()
  })
  afterEach(() => {
    cleanup()
    localStorage.removeItem('seqnexus:primer-design')
  })

  it('asks for a target until there is a selection', () => {
    render(<PrimerWorkbench />)
    expect(screen.getByText(/Select a region/)).toBeTruthy()
  })

  it('designs around the selection and saves a picked pair in one undo entry', async () => {
    render(<PrimerWorkbench />)
    act(() => { store().setSelection({ anchor: 1000, caret: 1200 }) })

    await waitFor(() => expect(store().primerDesign.result?.pairs.length).toBeGreaterThan(0), { timeout: 3000 })
    // Digit grouping follows the locale: 1,001 here, 1.001 on a German system.
    expect(screen.getByText(/1[.,]?001\.\.1[.,]?200/)).toBeTruthy()

    const best = store().primerDesign.result!.pairs[0]
    act(() => { firstPair().click() })
    expect(store().primerDesign.picks).toMatchObject({
      forward: best.forward.sequence, reverse: best.reverse.sequence,
    })
    // Both picks are inspected, and the pair is checked.
    expect(screen.getByRole('region', { name: 'Forward' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Reverse' })).toBeTruthy()
    expect(screen.getAllByText(`${best.evaluation.productSize} bp`).length).toBeGreaterThan(0)

    const before = undoDepth()
    fireEvent.change(screen.getByLabelText('Name for the saved primers'), { target: { value: 'GFP' } })
    act(() => { screen.getByRole('button', { name: 'Save to primers' }).click() })

    expect(store().doc.primers?.map(p => p.name)).toEqual(['GFP fwd', 'GFP rev'])
    expect(store().doc.primers?.[0].sequence).toBe(best.forward.sequence)
    expect(undoDepth()).toBe(before + 1)
    expect(store().primerDesign.picks).toEqual({ forward: null, reverse: null, probe: null })
  })

  it('extends a pick along the template, one base at a time', async () => {
    render(<PrimerWorkbench />)
    act(() => { store().setSelection({ anchor: 1000, caret: 1200 }) })
    await waitFor(() => expect(store().primerDesign.result?.pairs.length).toBeGreaterThan(0), { timeout: 3000 })
    act(() => { firstPair().click() })

    const fwd = store().primerDesign.picks.forward!
    const at = store().doc.sequence.bases.indexOf(fwd)
    act(() => { screen.getAllByTitle('Extend the 3′ end along the template')[0].click() })
    expect(store().primerDesign.picks.forward).toBe(store().doc.sequence.bases.slice(at, at + fwd.length + 1))
  })

  it('reports a target too long for the product instead of changing the settings', async () => {
    render(<PrimerWorkbench />)
    act(() => { store().setSelection({ anchor: 500, caret: 1500 }) })
    await waitFor(() => expect(screen.getByText(/longer than the largest product/)).toBeTruthy(), { timeout: 3000 })
    expect(JSON.parse(localStorage.getItem('seqnexus:primer-design')!).maxProduct).toBe(600)
  })
})
