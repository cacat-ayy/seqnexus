import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
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
