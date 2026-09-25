/**
 * Global display preferences, and the layout consequences of the two toggles.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'
import { getLayout, rowHeightForLanes } from './components/zoom-layout'

const store = () => useEditorStore.getState()
const LETTERS_ZOOM = 16   // >= 13 renders letters
const DOTS_ZOOM = 10

describe('display preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pDisplay', 'ATGCGATCGATCGATCGTAA')
    // Reset to defaults regardless of what earlier tests left behind.
    store().setColorScheme('nucleotide')
    if (!store().showComplement) store().toggleComplement()
    if (!store().showAnnotationTracks) store().toggleAnnotationTracks()
  })

  it('defaults to the previous appearance', () => {
    expect(store().colorScheme).toBe('nucleotide')
    expect(store().showComplement).toBe(true)
    expect(store().showAnnotationTracks).toBe(true)
  })

  it('persists the colour scheme to localStorage', () => {
    store().setColorScheme('clustal')
    expect(store().colorScheme).toBe('clustal')
    const raw = JSON.parse(localStorage.getItem('seqnexus:display-settings')!)
    expect(raw.colorScheme).toBe('clustal')
  })

  it('persists a toggle without clobbering the other settings', () => {
    store().setColorScheme('gc-at')
    store().toggleComplement()
    const raw = JSON.parse(localStorage.getItem('seqnexus:display-settings')!)
    expect(raw).toMatchObject({ colorScheme: 'gc-at', showComplement: false })
  })

  it('applies to every tab, not just the active one', () => {
    store().setColorScheme('macclade')
    store().openDocument('another', 'GGCC')
    expect(store().colorScheme).toBe('macclade')
  })

  describe('annotation tracks reveal themselves when a feature is added', () => {
    const feature = (id: string) => ({
      id, name: id, type: 'CDS', start: 0, end: 6, strand: 1 as const,
    })

    it('turns back on for a single add', () => {
      store().toggleAnnotationTracks()
      expect(store().showAnnotationTracks).toBe(false)

      store().addAnnotation(feature('f1'))
      expect(store().showAnnotationTracks).toBe(true)
    })

    it('turns back on for a bulk add', () => {
      store().toggleAnnotationTracks()
      store().addAnnotations([feature('f1'), feature('f2')])
      expect(store().showAnnotationTracks).toBe(true)
    })

    it('persists the reveal, so it does not flip back on reload', () => {
      store().toggleAnnotationTracks()
      store().addAnnotation(feature('f1'))
      const raw = JSON.parse(localStorage.getItem('seqnexus:display-settings')!)
      expect(raw.showAnnotationTracks).toBe(true)
    })

    it('does not reveal when the add was rejected', () => {
      // Read-only tabs reject the mutation; nothing appeared, so nothing to show.
      store().toggleAnnotationTracks()
      store().toggleReadOnly()
      store().addAnnotation(feature('f1'))
      expect(store().showAnnotationTracks).toBe(false)
      store().toggleReadOnly()
    })

    it('does not reveal for an empty bulk add', () => {
      store().toggleAnnotationTracks()
      store().addAnnotations([])
      expect(store().showAnnotationTracks).toBe(false)
    })

    it('leaves deletions alone — removing a feature must not reopen the tracks', () => {
      store().addAnnotation(feature('f1'))
      store().toggleAnnotationTracks()
      store().removeAnnotation('f1')
      expect(store().showAnnotationTracks).toBe(false)
    })
  })
})

describe('layout responds to the toggles', () => {
  it('shrinks the sequence band when the complement is hidden', () => {
    const withComp = getLayout(LETTERS_ZOOM, 900, false, 1000, { showComplement: true })
    const without = getLayout(LETTERS_ZOOM, 900, false, 1000, { showComplement: false })
    expect(withComp.showComplement).toBe(true)
    expect(without.showComplement).toBe(false)
    // Not just a skipped draw — the row has to get shorter, or every row keeps
    // a blank strand's worth of empty space.
    expect(without.seqLineHeight).toBeLessThan(withComp.seqLineHeight)
    expect(without.rowHeight).toBeLessThan(withComp.rowHeight)
  })

  it('never claims a complement below letters zoom, where there are no letters', () => {
    const dots = getLayout(DOTS_ZOOM, 900, false, 1000, { showComplement: true })
    expect(dots.showComplement).toBe(false)
  })

  it('collapses the annotation area when tracks are hidden', () => {
    const withTracks = getLayout(LETTERS_ZOOM, 900, false, 1000, { showAnnotations: true })
    const without = getLayout(LETTERS_ZOOM, 900, false, 1000, { showAnnotations: false })
    expect(withTracks.maxAnnotationRows).toBe(4)
    expect(without.maxAnnotationRows).toBe(0)
    expect(without.rowHeight).toBeLessThan(withTracks.rowHeight)
  })

  it('reserves no annotation space at zero lanes, including the leading gap', () => {
    const L = getLayout(LETTERS_ZOOM, 900, false, 1000, { showAnnotations: false })
    // Row height and the zero-lane height must agree, or the translation row
    // below drifts by the gap the draw loop skipped.
    expect(rowHeightForLanes(L, 0)).toBe(L.rowHeight)
  })

  it('defaults both toggles on when none are passed', () => {
    const L = getLayout(LETTERS_ZOOM, 900, false, 1000)
    expect(L.showComplement).toBe(true)
    expect(L.maxAnnotationRows).toBe(4)
  })
})
