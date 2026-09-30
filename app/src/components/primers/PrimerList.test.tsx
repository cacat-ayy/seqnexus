/**
 * The Primers tab: adding by paste shows where the oligo binds before it is
 * added, and old primer_bind features can be converted in one go.
 */
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import PrimerList from './PrimerList'
import { useEditorStore } from '../../store'

const store = () => useEditorStore.getState()

const BASES = 'GATTACACGTTGCAAGCTTGGCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCG'

describe('PrimerList', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pList', BASES)
  })
  afterEach(cleanup)

  it('previews the binding site and tail of a pasted oligo, then adds it', () => {
    const onAdding = vi.fn()
    render(<PrimerList adding onAddingChange={onAdding} />)

    const oligo = 'GGATCC' + BASES.slice(10, 30)
    fireEvent.change(screen.getByPlaceholderText(/5′-/), { target: { value: `5'-${oligo}-3'` } })
    expect(screen.getByText(/Binds 11\.\.30 \(\+\)/)).toBeTruthy()
    expect(screen.getByText(/5′ tail 6/)).toBeTruthy()

    act(() => { screen.getByRole('button', { name: 'Add primer' }).click() })
    expect(store().doc.primers?.[0].sequence).toBe(oligo)
    expect(onAdding).toHaveBeenCalledWith(false)
  })

  it('refuses text that is not an oligo', () => {
    render(<PrimerList adding onAddingChange={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/5′-/), { target: { value: 'ACGTXQ' } })
    expect(screen.getByText(/Only A, C, G, T/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Add primer' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('flags a primer that binds nowhere instead of hiding it', () => {
    act(() => {
      store().addPrimers([{ id: 'o1', name: 'Stray', sequence: 'CCCCCCCCCCCCCCCCCCCC', role: 'primer' }])
    })
    render(<PrimerList adding={false} onAddingChange={vi.fn()} />)
    expect(screen.getByText('Stray')).toBeTruthy()
    expect(screen.getByText(/unbound/)).toBeTruthy()
  })

  it('offers to convert primer_bind features', () => {
    act(() => {
      store().addAnnotations([{ id: 'a1', name: 'Old', type: 'primer_bind', start: 0, end: 20, strand: 1 }])
    })
    render(<PrimerList adding={false} onAddingChange={vi.fn()} />)
    act(() => { screen.getByRole('button', { name: 'Convert' }).click() })
    expect(store().doc.annotations).toHaveLength(0)
    expect(store().doc.primers?.map(p => p.name)).toEqual(['Old'])
  })
})
