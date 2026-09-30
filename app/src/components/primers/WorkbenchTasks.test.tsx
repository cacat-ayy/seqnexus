/**
 * The workbench's tasks beyond PCR, each through its main loop: cloning
 * primers with tails into a simulated PCR product, a mutagenesis pair and
 * its mutant, a sequencing set, and checking an oligo across open sequences.
 */
import { render, screen, act, cleanup, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import PrimerWorkbench from './PrimerWorkbench'
import { useEditorStore } from '../../store'
import { DEFAULT_SETTINGS } from '../../primers/design/settings'
import { reverseComplement } from '../../models/complement'

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

// No EcoRI or BamHI sites in the insert, so the default enzymes are clean.
const T = template(3000).replace(/GAATTC/g, 'GAAATC').replace(/GGATCC/g, 'GGAACC')

function useTask(task: string) {
  localStorage.setItem('seqnexus:primer-task', task)
}

describe('workbench tasks', () => {
  beforeEach(() => {
    localStorage.setItem('seqnexus:primer-design', JSON.stringify({ ...DEFAULT_SETTINGS, minTm: 50, maxTm: 70, minGC: 20, maxGC: 80 }))
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pClone', T, 'circular')
    store().clearDesign()
  })
  afterEach(() => {
    cleanup()
    localStorage.removeItem('seqnexus:primer-task')
    localStorage.removeItem('seqnexus:primer-design')
  })

  it('cloning: restriction tails, then a PCR product that carries them', () => {
    useTask('cloning')
    render(<PrimerWorkbench />)
    act(() => { store().setSelection({ anchor: 1000, caret: 1600 }) })

    const { forward, reverse } = store().primerDesign.picks
    expect(forward).toMatch(/^TAAGCAGAATTC/)
    expect(reverse).toMatch(/^TAAGCAGGATCC/)
    expect(forward!.slice(12)).toBe(T.slice(1000, 1000 + forward!.length - 12))

    act(() => { screen.getByRole('button', { name: 'Simulate PCR' }).click() })
    const product = store().doc
    expect(product.metadata?.origin).toBe('pcr')
    expect(product.sequence.bases.startsWith('TAAGCAGAATTC')).toBe(true)
    expect(product.sequence.bases.endsWith(reverseComplement('TAAGCAGGATCC'))).toBe(true)
    expect(product.sequence.length).toBe(600 + 24)
  })

  it('cloning: warns when the enzyme also cuts inside the insert', () => {
    useTask('cloning')
    render(<PrimerWorkbench />)
    // A "site" typed straight from the middle of the insert is sure to cut it.
    fireEvent.change(screen.getByLabelText('5′ site'), { target: { value: T.slice(1300, 1306) } })
    act(() => { store().setSelection({ anchor: 1000, caret: 1600 }) })
    expect(screen.getByText(/also cuts inside the insert/)).toBeTruthy()
  })

  it('cloning: homology arms come from the vector', () => {
    const vector = template(2000, 7)
    const vectorId = store().openDocument('pVec', vector, 'circular')
    const insertTab = store().openDocument('pInsert', T, 'circular')
    useTask('cloning')
    render(<PrimerWorkbench />)
    fireEvent.change(screen.getByDisplayValue('Restriction sites'), { target: { value: 'homology' } })
    fireEvent.change(screen.getByLabelText('Vector'), { target: { value: vectorId } })
    fireEvent.change(within(screen.getByText('Insert after').parentElement!).getByRole('spinbutton'), { target: { value: '500' } })
    act(() => { store().setSelection({ anchor: 1000, caret: 1600 }) })
    expect(store().activeTabId).toBe(insertTab)
    expect(store().primerDesign.picks.forward!.startsWith(vector.slice(480, 500))).toBe(true)
    expect(store().primerDesign.picks.reverse!.startsWith(reverseComplement(vector.slice(500, 520)))).toBe(true)
  })

  it('mutagenesis: a back-to-back pair, and the mutant it makes', () => {
    useTask('mutagenesis')
    render(<PrimerWorkbench />)
    act(() => { store().setSelection({ anchor: 1200, caret: 1203 }) })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'tag' } })

    const { forward, reverse } = store().primerDesign.picks
    expect(forward!.startsWith('TAG')).toBe(true)
    expect(T.slice(0, 1200).endsWith(reverseComplement(reverse!))).toBe(true)

    act(() => { screen.getByRole('button', { name: 'Open mutant' }).click() })
    expect(store().doc.sequence.bases).toBe(T.slice(0, 1200) + 'TAG' + T.slice(1203))
  })

  it('sequencing: plans a set, previews it, saves it', () => {
    useTask('sequencing')
    render(<PrimerWorkbench />)
    act(() => { store().setSelection({ anchor: 500, caret: 2000 }) })
    act(() => { screen.getByRole('button', { name: 'Plan primers' }).click() })

    const batch = store().primerDesign.batch
    expect(batch.length).toBeGreaterThan(2)
    act(() => { screen.getByRole('button', { name: 'Save all' }).click() })
    expect(store().doc.primers?.length).toBe(batch.length)
    expect(store().primerDesign.batch).toEqual([])
  })

  it('check: finds where a pasted oligo binds across open sequences', () => {
    store().openDocument('pOther', template(1500, 3))
    useTask('check')
    render(<PrimerWorkbench />)
    fireEvent.change(screen.getByLabelText('Oligo'), { target: { value: T.slice(700, 722) } })
    expect(screen.getByText(/Binds 1 of 2 open sequences/)).toBeTruthy()
    expect(screen.getByText('pClone')).toBeTruthy()
  })
})
