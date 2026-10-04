import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import FeatureSidebar from './FeatureSidebar'
import { useEditorStore } from '../store'

const store = () => useEditorStore.getState()

describe('FeatureSidebar add-annotation requests', () => {
  beforeEach(() => {
    store().loadDocument('test', 'ACGT'.repeat(50), 'linear')
    store().setSelection({ anchor: 10, caret: 30 })
    store().setSidebarTab('primers')
  })

  it('switches from the Primers tab back to Features and opens the form on the selection', () => {
    render(<FeatureSidebar open onClose={() => {}} />)
    expect(screen.getByRole('tab', { name: /Primers/ })).toHaveAttribute('aria-selected', 'true')

    act(() => { store().setRequestAddAnnotation(true) })

    expect(store().sidebarTab).toBe('features')
    expect(screen.getByRole('tab', { name: /Features/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByDisplayValue('11')).toBeInTheDocument()
    expect(screen.getByDisplayValue('30')).toBeInTheDocument()
    expect(store().requestAddAnnotation).toBe(false)
  })
})

describe('FeatureSidebar joined features', () => {
  beforeEach(() => {
    store().loadDocument('test', 'ACGT'.repeat(50), 'linear')
    store().setSidebarTab('features')
  })

  it('makes one feature with a part per selected range', () => {
    store().setSelections({ anchor: 60, caret: 90 }, [{ anchor: 10, caret: 30 }])
    render(<FeatureSidebar open onClose={() => {}} />)
    act(() => { store().setRequestAddAnnotation(true) })
    // The parts in reading order, 1-based, in place of the Range inputs.
    expect(screen.getByText('11..30, 61..90')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add Feature' }))
    const anns = store().doc.annotations
    const added = anns[anns.length - 1]
    expect(added.start).toBe(10)
    expect(added.end).toBe(90)
    expect(added.segments).toEqual([[10, 30], [60, 90]])
  })

  it('annotates the whole span instead on request', () => {
    store().setSelections({ anchor: 60, caret: 90 }, [{ anchor: 10, caret: 30 }])
    render(<FeatureSidebar open onClose={() => {}} />)
    act(() => { store().setRequestAddAnnotation(true) })
    fireEvent.click(screen.getByRole('button', { name: 'One Span' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Feature' }))
    const anns = store().doc.annotations
    const added = anns[anns.length - 1]
    expect([added.start, added.end, added.segments]).toEqual([10, 90, undefined])
  })
})
