/**
 * The library in the UI: library oligos show up as their own group in the
 * explorer, and the Primers tab offers the ones that bind the open sequence.
 */
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import ExplorerPanel from '../explorer/ExplorerPanel'
import PrimerList from './PrimerList'
import { useEditorStore } from '../../store'

const store = () => useEditorStore.getState()

function template(n: number, seed = 33): string {
  let x = seed
  let s = ''
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5
    s += 'ACGT'[(x >>> 7) & 3]
  }
  return s
}
const T = template(1200)
const noop = vi.fn()

describe('primer library in the UI', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    useEditorStore.setState({ oligos: [], folders: [], itemMeta: {}, recentlyDeleted: [] })
    localStorage.removeItem('seqnexus:explorer-settings')
    store().openDocument('pLib', T)
    store().addLibraryOligos([
      { name: 'LibFwd', sequence: T.slice(100, 122), role: 'primer' },
      { name: 'Unrelated', sequence: template(22, 5), role: 'primer' },
    ])
  })
  afterEach(cleanup)

  it('lists library oligos in their own explorer group', () => {
    render(<ExplorerPanel open onCollapse={noop} onExpand={noop} onImportFiles={noop} />)
    const groups = [...document.querySelectorAll('.ex-viewport .ex-group-title')].map(el => el.textContent)
    expect(groups).toContain('Oligos')
    expect(screen.getByText('LibFwd')).toBeTruthy()
    expect(screen.getByText('Unrelated')).toBeTruthy()
  })

  it('offers only the library primers that bind, and adds one as an unlinked copy', () => {
    render(<PrimerList adding={false} onAddingChange={noop} />)
    expect(screen.getByText(/1 library primer binds this sequence/)).toBeTruthy()
    act(() => { screen.getByRole('button', { name: 'Add' }).click() })
    expect(store().doc.primers?.map(p => p.name)).toEqual(['LibFwd'])
    expect(store().doc.primers?.[0].id).not.toBe(store().oligos[0].id)
    // Once on the sequence it is no longer offered.
    expect(screen.queryByText(/library primer binds/)).toBeNull()
  })

  it('imports a pasted list into the library', () => {
    render(<PrimerList adding={false} onAddingChange={noop} />)
    act(() => { screen.getByRole('button', { name: 'Add from list…' }).click() })
    fireEvent.change(screen.getByPlaceholderText(/Paste a list/), {
      target: { value: 'NewA\tACGTACGTACGTACGTAC\nNewB\tGGGGCCCCAAAATTTTGG' },
    })
    act(() => { screen.getByRole('button', { name: /to library/ }).click() })
    expect(store().oligos.map(o => o.name)).toEqual(['LibFwd', 'Unrelated', 'NewA', 'NewB'])
  })
})
