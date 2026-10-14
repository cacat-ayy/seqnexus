/**
 * The panel along the bottom: Features as a table with the editor in a
 * column beside it, and the saved primers likewise.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import FeatureSidebar from './FeatureSidebar'
import { useEditorStore } from '../store'
import { STORAGE_KEYS } from '../storage/keys'

const store = () => useEditorStore.getState()
const names = () => [...document.querySelectorAll('.fs-item .ft-name')].map(n => n.textContent)
const detail = () => screen.getByRole('region', { name: /details/ })

describe('Features as a table', () => {
  beforeEach(() => {
    // The list layout is a saved preference: start each test grouped by type.
    localStorage.removeItem(STORAGE_KEYS.featureSidebarView)
    store().loadDocument('wide', 'ACGT'.repeat(100), 'linear')
    store().setSidebarTab('features')
    act(() => {
      store().addAnnotation({ id: 'b', name: 'beta', type: 'CDS', start: 100, end: 400, strand: 1 })
      store().addAnnotation({ id: 'a', name: 'alpha', type: 'promoter', start: 10, end: 40, strand: -1 })
      store().addAnnotation({ id: 'c', name: 'gamma', type: 'CDS', start: 50, end: 60, strand: 1 })
    })
  })

  it('sorts the flat list by a column, and reverses on a second click', () => {
    render(<FeatureSidebar open onClose={() => {}} placement="bottom" />)
    fireEvent.click(screen.getByRole('button', { name: /Length/ }))
    expect(names()).toEqual(['gamma', 'alpha', 'beta'])
    fireEvent.click(screen.getByRole('button', { name: /Length/ }))
    expect(names()).toEqual(['beta', 'alpha', 'gamma'])
    fireEvent.click(screen.getByRole('button', { name: /Name/ }))
    expect(names()).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('shows the feature clicked in the editor beside the table, not under its row', () => {
    render(<FeatureSidebar open onClose={() => {}} placement="bottom" />)
    expect(within(detail()).getByText(/Click a feature/)).toBeTruthy()
    fireEvent.click(screen.getByText('alpha'))
    expect(within(detail()).getByText('alpha')).toBeTruthy()
    expect(document.querySelector('.fs-list .ft-editor')).toBeNull()
    expect(detail().querySelector('.ft-editor')).toBeTruthy()
  })

  it('carries the editor along with the arrow keys', () => {
    render(<FeatureSidebar open onClose={() => {}} placement="bottom" />)
    fireEvent.click(screen.getByRole('button', { name: /Start/ }))
    fireEvent.click(screen.getByText('alpha'))
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Features' }), { key: 'ArrowDown' })
    expect(within(detail()).getByText('gamma')).toBeTruthy()
  })

  it('opens the new feature form beside the table', () => {
    render(<FeatureSidebar open onClose={() => {}} placement="bottom" />)
    fireEvent.click(screen.getByTitle('Add feature'))
    expect(within(detail()).getByRole('button', { name: 'Add Feature' })).toBeTruthy()
    expect(document.querySelector('.fs-wide-main .ft-add-form')).toBeNull()
  })

  it('keeps the sidebar a list on the right', () => {
    render(<FeatureSidebar open onClose={() => {}} />)
    expect(screen.queryByRole('region', { name: /details/ })).toBeNull()
    expect(document.querySelector('.ft-table-head')).toBeNull()
  })
})

describe('saved primers as a table', () => {
  beforeEach(() => {
    store().loadDocument('wide', 'ATGACCATGATTACGGATTCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCC', 'linear')
    store().setSidebarTab('primers')
    store().setPrimerView('list')
    act(() => store().addPrimers([{ id: 'p1', name: 'M13 fwd', sequence: 'GTAAAACGACGGCCAGT', role: 'primer' }]))
  })

  it('opens a primer in the column beside the table', () => {
    render(<FeatureSidebar open onClose={() => {}} placement="bottom" />)
    expect(document.querySelector('.pl-table-head')).toBeTruthy()
    fireEvent.click(screen.getByText('M13 fwd'))
    expect(within(detail()).getByDisplayValue('M13 fwd')).toBeTruthy()
  })
})
