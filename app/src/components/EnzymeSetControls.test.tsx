import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useState } from 'react'
import EnzymeSetControls from './EnzymeSetControls'
import { useEditorStore } from '../store'
import { useToastStore } from '../toast'
import { DEFAULT_SUBSET, setKey } from '../enzymes/sets'

const store = () => useEditorStore.getState()

/** The controls with the panel's subset kept in state, as the panel keeps it in the store. */
function Harness({ listed }: { listed: string[] }) {
  const [subset, setSubset] = useState(DEFAULT_SUBSET)
  return (
    <>
      <output data-testid="subset">{subset}</output>
      <EnzymeSetControls subset={subset} onSubset={setSubset} listed={listed} />
    </>
  )
}

describe('EnzymeSetControls', () => {
  beforeEach(() => {
    cleanup()
    useEditorStore.setState({ enzymeSets: [] })
    useToastStore.getState().clear()
  })

  it('saves the listed enzymes as a set and shows it', () => {
    render(<Harness listed={['EcoRI', 'XbaI', 'SpeI', 'PstI']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save list as set…' }))
    fireEvent.change(screen.getByLabelText(/Name for the 4 enzymes listed/), { target: { value: 'BioBrick' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save set' }))
    const [saved] = store().enzymeSets
    expect(saved).toMatchObject({ name: 'BioBrick', enzymes: ['EcoRI', 'XbaI', 'SpeI', 'PstI'] })
    expect(screen.getByTestId('subset').textContent).toBe(setKey(saved.id))
  })

  it('cannot save an empty list', () => {
    render(<Harness listed={[]} />)
    expect(screen.getByRole('button', { name: 'Save list as set…' })).toBeDisabled()
  })

  it('renames a set and edits its enzymes, leaving out names it does not know', () => {
    render(<Harness listed={['EcoRI']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save list as set…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save set' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit set…' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Cutters' } })
    fireEvent.change(screen.getByLabelText(/^Enzymes/), { target: { value: 'ecori, BamHI NotAnEnzyme' } })
    expect(screen.getByText(/left out: NotAnEnzyme/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(store().enzymeSets[0]).toMatchObject({ name: 'Cutters', enzymes: ['EcoRI', 'BamHI'] })
  })

  it('deletes a set, with Undo', () => {
    render(<Harness listed={['EcoRI']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save list as set…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save set' }))
    const id = store().enzymeSets[0].id
    fireEvent.click(screen.getByRole('button', { name: 'Delete set' }))
    expect(store().enzymeSets).toEqual([])
    const toasts = useToastStore.getState().toasts
    const toast = toasts[toasts.length - 1]
    toast.action!.onClick()
    expect(store().enzymeSets.map(s => s.id)).toEqual([id])
  })
})
