import { render, fireEvent, screen, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import App from './App'
import { useEditorStore } from './store'
import { useToastStore } from './toast'

/** Export from the explorer, for every kind it lists. */
describe('Export from the explorer', () => {
  beforeEach(() => {
    useToastStore.getState().clear()
    for (const tab of useEditorStore.getState().tabs) useEditorStore.getState().closeTab(tab.id)
  })

  it('opens the export dialog for a protein instead of crashing', async () => {
    render(<App />)
    await act(async () => {
      useEditorStore.getState().openDocument('ProbeProtein', 'MKVLAAGIVGLLLAAQ', 'linear', undefined, undefined, 'protein')
    })
    const row = screen.getAllByText('ProbeProtein').find(el => el.closest('aside'))!
    await act(async () => { fireEvent.contextMenu(row) })
    await act(async () => { fireEvent.click(screen.getByText(/Export…/)) })
    expect(screen.getByRole('dialog', { name: 'Export Sequence' })).toBeTruthy()
    // A protein's GenBank record is GenPept.
    expect(screen.getByText(/^GenPept/)).toBeTruthy()
    expect(screen.queryByText(/^SnapGene/)).toBeNull()
  })

  it('does not offer Export for a gel, which has its own export', async () => {
    render(<App />)
    await act(async () => {
      useEditorStore.getState().openDocument('ProbeDna', 'ATGC'.repeat(100), 'circular')
      useEditorStore.getState().createGel({ name: 'ProbeGel', activate: false })
    })
    const row = screen.getAllByText('ProbeGel').find(el => el.closest('aside'))!
    await act(async () => { fireEvent.contextMenu(row) })
    expect(screen.queryByText(/Export…/)).toBeNull()
  })
})
