/**
 * Auto-annotation: proposals in, features out.
 *
 * The conversion is the part worth pinning down. It has to add exactly what
 * was picked, land as one undo entry, and leave the overlay off, and a second
 * apply of the same keys must be a no-op, because by then those proposals
 * describe features the document already has.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'
import { matchKey } from './utils/auto-annotations'
import type { AnnotationMatch } from './workers/annotate-list'

const store = () => useEditorStore.getState()

const match = (over: Partial<AnnotationMatch> = {}): AnnotationMatch => ({
  refName: 'AmpR', refType: 'CDS', start: 0, end: 30, strand: 1, similarity: 98,
  color: '#ff0000', ...over,
})

const AMP = match()
const LAC = match({ refName: 'lacZ', start: 40, end: 70 })

describe('auto-annotation store', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pAuto', 'ATGC'.repeat(30))
    store().clearAutoAnnotations()
  })

  it('is off by default and toggles per tab', () => {
    expect(store().showAutoAnnotations).toBe(false)
    store().toggleAutoAnnotations()
    expect(store().showAutoAnnotations).toBe(true)

    const first = store().activeTabId!
    store().openDocument('other', 'GGCCGGCCGGCC')
    expect(store().showAutoAnnotations).toBe(false)

    store().setActiveTab(first)
    expect(store().showAutoAnnotations).toBe(true)
  })

  it('keeps proposals with their own tab', () => {
    const first = store().activeTabId!
    store().setAutoAnnotations([AMP])
    store().openDocument('other', 'GGCCGGCCGGCC')
    expect(store().autoAnnotations).toEqual([])

    store().setActiveTab(first)
    expect(store().autoAnnotations).toEqual([AMP])
  })

  it('picks and unpicks by match key', () => {
    store().setAutoAnnotations([AMP, LAC])
    store().toggleAutoAnnotationPick(matchKey(AMP))
    expect([...store().autoAnnotationPicks]).toEqual([matchKey(AMP)])
    store().toggleAutoAnnotationPick(matchKey(AMP))
    expect(store().autoAnnotationPicks.size).toBe(0)
  })

  it('drops picks for matches a re-scan no longer returns', () => {
    store().setAutoAnnotations([AMP, LAC])
    store().setAutoAnnotationPicks([matchKey(AMP), matchKey(LAC)])
    // Tightening the threshold drops the weaker hit.
    store().setAutoAnnotations([AMP])
    expect([...store().autoAnnotationPicks]).toEqual([matchKey(AMP)])
  })

  it('forgets picks when the overlay is switched off', () => {
    store().setAutoAnnotations([AMP])
    store().toggleAutoAnnotations()
    store().toggleAutoAnnotationPick(matchKey(AMP))
    store().toggleAutoAnnotations()
    expect(store().autoAnnotationPicks.size).toBe(0)
  })

  it('converts only the picked proposals', () => {
    store().setAutoAnnotations([AMP, LAC])
    const added = store().applyAutoAnnotations([matchKey(AMP)])

    expect(added).toBe(1)
    expect(store().doc.annotations.map(a => a.name)).toEqual(['AmpR (98%)'])
    expect(store().doc.annotations[0]).toMatchObject({ type: 'CDS', start: 0, end: 30, strand: 1 })
  })

  it('converts everything proposed when given no keys', () => {
    store().setAutoAnnotations([AMP, LAC])
    expect(store().applyAutoAnnotations()).toBe(2)
    expect(store().doc.annotations).toHaveLength(2)
  })

  it('switches the overlay off and clears picks once converted', () => {
    store().setAutoAnnotations([AMP, LAC])
    store().toggleAutoAnnotations()
    store().toggleAutoAnnotationPick(matchKey(AMP))

    store().applyAutoAnnotations([matchKey(AMP)])

    expect(store().showAutoAnnotations).toBe(false)
    expect(store().autoAnnotationPicks.size).toBe(0)
  })

  it('lands as a single undo entry however many were converted', () => {
    store().setAutoAnnotations([AMP, LAC])
    store().applyAutoAnnotations()
    expect(store().doc.annotations).toHaveLength(2)

    store().undo()
    expect(store().doc.annotations).toHaveLength(0)
  })

  it('will not convert the same proposal twice', () => {
    store().setAutoAnnotations([AMP, LAC])
    store().applyAutoAnnotations([matchKey(AMP)])
    // The proposal list is unchanged: the overlap rule is what excludes it.
    expect(store().applyAutoAnnotations([matchKey(AMP)])).toBe(0)
    expect(store().doc.annotations).toHaveLength(1)
  })

  it('still converts the others after one has been converted', () => {
    store().setAutoAnnotations([AMP, LAC])
    store().applyAutoAnnotations([matchKey(AMP)])
    expect(store().applyAutoAnnotations()).toBe(1)
    expect(store().doc.annotations.map(a => a.name)).toEqual(['AmpR (98%)', 'lacZ (98%)'])
  })

  it('ignores keys that are not on offer', () => {
    store().setAutoAnnotations([AMP])
    expect(store().applyAutoAnnotations(['nonsense'])).toBe(0)
    expect(store().doc.annotations).toHaveLength(0)
  })
})

describe('auto-annotation loci and rejection', () => {
  // Three fluorescent proteins on one gene, and a marker elsewhere.
  const EGFP = match({ refName: 'EGFP', start: 0, end: 60, similarity: 98.8 })
  const ECFP = match({ refName: 'ECFP', start: 0, end: 60, similarity: 98.9 })
  const EYFP = match({ refName: 'EYFP', start: 0, end: 60, similarity: 98.6 })
  const KAN = match({ refName: 'kanR', start: 70, end: 110 })

  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pLoci', 'ATGC'.repeat(30))
    store().setAutoAnnotations([EGFP, ECFP, EYFP, KAN])
  })

  it('converts one feature per locus: the best, when nothing is picked', () => {
    expect(store().applyAutoAnnotations()).toBe(2)
    expect(store().doc.annotations.map(a => a.name).sort()).toEqual(['ECFP (98.9%)', 'kanR (98%)'])
  })

  it('keeps one pick per locus, so choosing another relative replaces the first', () => {
    store().toggleAutoAnnotationPick(matchKey(ECFP))
    store().toggleAutoAnnotationPick(matchKey(EGFP))
    expect([...store().autoAnnotationPicks]).toEqual([matchKey(EGFP)])
    // A pick elsewhere is left alone.
    store().toggleAutoAnnotationPick(matchKey(KAN))
    expect(new Set(store().autoAnnotationPicks)).toEqual(new Set([matchKey(EGFP), matchKey(KAN)]))
  })

  it('converts the relative the user picked, not the best', () => {
    store().toggleAutoAnnotationPick(matchKey(EGFP))
    expect(store().applyAutoAnnotations()).toBe(2)
    expect(store().doc.annotations.map(a => a.name).sort()).toEqual(['EGFP (98.8%)', 'kanR (98%)'])
  })

  it('stores a rejection with the document, and offers the next relative', () => {
    store().rejectSuggestions([{ name: 'ECFP', type: 'CDS' }])
    expect(store().doc.metadata?.rejectedSuggestions).toEqual([{ name: 'ECFP', type: 'CDS' }])
    expect(store().applyAutoAnnotations()).toBe(2)
    expect(store().doc.annotations.map(a => a.name).sort()).toEqual(['EGFP (98.8%)', 'kanR (98%)'])
  })

  it('never converts a rejected element, even when asked by key', () => {
    store().rejectSuggestions([{ name: 'kanR', type: 'CDS' }])
    expect(store().applyAutoAnnotations([matchKey(KAN)])).toBe(0)
  })

  it('drops the picks of what it rejects', () => {
    store().toggleAutoAnnotationPick(matchKey(KAN))
    store().rejectSuggestions([{ name: 'kanR', type: 'CDS' }])
    expect(store().autoAnnotationPicks.size).toBe(0)
  })

  it('undoes a rejection, and restores one or all', () => {
    store().rejectSuggestions([{ name: 'kanR', type: 'CDS' }, { name: 'ECFP', type: 'CDS' }])
    store().undo()
    expect(store().doc.metadata?.rejectedSuggestions).toBeUndefined()
    store().redo()
    store().restoreSuggestions([{ name: 'kanR', type: 'CDS' }])
    expect(store().doc.metadata?.rejectedSuggestions).toEqual([{ name: 'ECFP', type: 'CDS' }])
    store().restoreSuggestions()
    expect(store().doc.metadata?.rejectedSuggestions).toBeUndefined()
  })

  it('does not record a rejection twice', () => {
    store().rejectSuggestions([{ name: 'kanR', type: 'CDS' }])
    const undoDepth = store().tabs.find(t => t.id === store().activeTabId)!.undoStack.length
    store().rejectSuggestions([{ name: 'kanR', type: 'CDS' }])
    expect(store().doc.metadata?.rejectedSuggestions).toHaveLength(1)
    expect(store().tabs.find(t => t.id === store().activeTabId)!.undoStack.length).toBe(undoDepth)
  })
})

describe('feature sources', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pSources', 'ATGC'.repeat(30))
    for (const s of store().featureSources) {
      if (!s.builtin) store().removeFeatureSource(s.id)
    }
  })

  it('starts with the built-in library enabled', () => {
    const sources = store().featureSources
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ builtin: true, enabled: true })
    expect(sources[0].features.length).toBeGreaterThan(0)
  })

  it('adds an imported database and lists it after the built-in one', () => {
    const id = store().addFeatureSource('lab parts', [
      { name: 'myPart', type: 'CDS', color: '', category: 'lab parts', sequence: 'ATGCGTACGTAGCTAGCTAGC' },
    ])
    const added = store().featureSources.find(s => s.id === id)!
    expect(added).toMatchObject({ name: 'lab parts', builtin: false, enabled: true })
    expect(store().featureSources[0].builtin).toBe(true)
  })

  it('toggles and renames a custom source, and removes it again', () => {
    const id = store().addFeatureSource('lab parts', [])
    store().toggleFeatureSource(id)
    expect(store().featureSources.find(s => s.id === id)!.enabled).toBe(false)

    store().renameFeatureSource(id, 'renamed')
    expect(store().featureSources.find(s => s.id === id)!.name).toBe('renamed')

    store().removeFeatureSource(id)
    expect(store().featureSources.find(s => s.id === id)).toBeUndefined()
  })

  it('lets the built-in library be switched off but not removed', () => {
    const builtin = store().featureSources[0]
    store().toggleFeatureSource(builtin.id)
    expect(store().featureSources[0].enabled).toBe(false)

    store().removeFeatureSource(builtin.id)
    expect(store().featureSources[0].builtin).toBe(true)
  })
})
