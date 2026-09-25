/**
 * Render-cost regression tests.
 *
 * App holds ~55 state hooks and ~49 store subscriptions, so it re-renders
 * constantly — every dialog toggle, every toast, every theme change. The
 * expensive children (the two canvas views, the file explorer, the feature
 * sidebar) are React.memo'd so those re-renders stop at their boundary.
 *
 * memo only holds if the props App passes keep their identity. Reintroducing
 * an inline arrow — `onEditFeature={() => setFeaturesPanelOpen(true)}` — is an
 * easy and invisible way to break that, which is what these tests guard.
 *
 * The mocks below are memo()'d stand-ins, so a failure here means App handed
 * the real component unstable props, not that memo itself stopped working.
 */
import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { memo } from 'react'

const renders = { sequenceView: 0, plasmidMap: 0, fileExplorer: 0 }

vi.mock('./components/SequenceView', () => ({
  default: memo(function SequenceViewMock() {
    renders.sequenceView++
    return <div data-testid="sequence-view" />
  }),
}))

vi.mock('./components/PlasmidMap', () => ({
  default: memo(function PlasmidMapMock() {
    renders.plasmidMap++
    return <div data-testid="plasmid-map" />
  }),
}))

vi.mock('./components/FileExplorer', () => ({
  default: memo(function FileExplorerMock() {
    renders.fileExplorer++
    return <div data-testid="file-explorer" />
  }),
}))

import App from './App'
import { useEditorStore } from './store'

/** Open a document so the sequence view is actually on screen. */
function openSequence() {
  act(() => {
    useEditorStore.getState().openDocument('perf-fixture', 'ATGCGTACGTAGCTAGCTAGCATCGATCGATCG')
  })
}

describe('App render cost', () => {
  beforeEach(() => {
    renders.sequenceView = 0
    renders.plasmidMap = 0
    renders.fileExplorer = 0
  })

  it('does not re-render the sequence view when an unrelated dialog opens', () => {
    render(<App />)
    openSequence()

    const before = renders.sequenceView
    expect(before).toBeGreaterThan(0) // it is actually mounted

    // Toggle a piece of App-local state that the sequence view does not read.
    // The ORF finder button is one of the ~22 dialog flags living in App.
    const orfButton = document.querySelector<HTMLButtonElement>(
      'button[title="Open reading frame finder"]',
    )
    expect(orfButton).toBeTruthy()
    act(() => { orfButton!.click() })

    expect(renders.sequenceView).toBe(before)
  })

  it('does not re-render the file explorer when a dialog opens', () => {
    render(<App />)
    openSequence()

    const before = renders.fileExplorer
    expect(before).toBeGreaterThan(0)

    const enzymeButton = document.querySelector<HTMLButtonElement>(
      'button[title="Restriction enzyme analysis"]',
    )
    expect(enzymeButton).toBeTruthy()
    act(() => { enzymeButton!.click() })

    expect(renders.fileExplorer).toBe(before)
  })
})
