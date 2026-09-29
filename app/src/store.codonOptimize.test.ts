/**
 * Applying an optimization to the document.
 *
 * The substitution primitive exists because the ordinary replace path would
 * delete the very feature being optimized, so that is what these check: the
 * bases change, the annotations do not, and the whole run is one undo entry.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'
import { DEFAULT_CODON_SETTINGS } from './codon/settings'

const store = () => useEditorStore.getState()

/** ATG GGT GGT TAA plus filler. */
const BASES = 'ATGGGTGGTTAA' + 'AAACCCGGGTTT'

describe('substituteBases', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pCodon', BASES)
    store().addAnnotation({
      id: 'cds1', name: 'gene', type: 'CDS', start: 0, end: 12, strand: 1,
    })
  })

  it('rewrites the bases in place', () => {
    store().substituteBases([{ start: 3, end: 9, bases: 'GGCGGC' }])
    expect(store().doc.sequence.bases).toBe('ATGGGCGGCTAA' + 'AAACCCGGGTTT')
  })

  it('leaves the feature it rewrote alone', () => {
    store().substituteBases([{ start: 0, end: 12, bases: 'ATGGGCGGCTAA' }])
    const [ann] = store().doc.annotations
    expect(store().doc.annotations).toHaveLength(1)
    expect(ann).toMatchObject({ id: 'cds1', start: 0, end: 12, strand: 1 })
  })

  it('is one undo entry however many edits it carries', () => {
    const before = store().doc.sequence.bases
    store().substituteBases([
      { start: 3, end: 6, bases: 'GGC' },
      { start: 6, end: 9, bases: 'GGA' },
      { start: 12, end: 15, bases: 'TTT' },
    ])
    expect(store().doc.sequence.bases).toBe('ATGGGCGGATAA' + 'TTTCCCGGGTTT')

    store().undo()
    expect(store().doc.sequence.bases).toBe(before)
    expect(store().doc.annotations).toHaveLength(1)
  })

  it('does nothing when there is nothing to do', () => {
    const before = store().doc.sequence.bases
    expect(store().substituteBases([])).toBe(false)
    expect(store().doc.sequence.bases).toBe(before)

    // And it did not spend an undo slot: the one taken back here is the
    // annotation the setup added, not an empty substitution.
    store().undo()
    expect(store().doc.annotations).toHaveLength(0)
    expect(store().doc.sequence.bases).toBe(before)
  })

  it('is refused on a read-only document', () => {
    store().toggleReadOnly()
    expect(store().substituteBases([{ start: 0, end: 3, bases: 'GGG' }])).toBe(false)
    expect(store().doc.sequence.bases).toBe(BASES)
  })

  it('refuses an edit that would change the length', () => {
    expect(() => store().substituteBases([{ start: 0, end: 3, bases: 'GG' }]))
      .toThrow(/equal-length/)
    expect(store().doc.sequence.bases).toBe(BASES)
  })

  it('refuses an edit past the end of the sequence', () => {
    expect(() => store().substituteBases([{ start: 100, end: 103, bases: 'GGG' }]))
      .toThrow(/out of range/)
  })
})

describe('codon settings', () => {
  it('starts from the defaults and keeps patches', () => {
    expect(store().codonSettings).toEqual(DEFAULT_CODON_SETTINGS)

    store().setCodonSettings({ mode: 'rare-only', rareThreshold: 15 })
    expect(store().codonSettings.mode).toBe('rare-only')
    expect(store().codonSettings.rareThreshold).toBe(15)
    // Untouched fields survive.
    expect(store().codonSettings.geneticCodeId).toBe(DEFAULT_CODON_SETTINGS.geneticCodeId)

    store().setCodonSettings({ ...DEFAULT_CODON_SETTINGS })
  })
})

describe('custom usage tables', () => {
  beforeEach(() => {
    for (const t of store().customUsageTables) store().removeCustomUsageTable(t.id)
  })

  it('adds a table under a fresh id and can remove it again', () => {
    const id = store().addCustomUsageTable({
      id: '', name: 'my host', source: 'imported', approximate: false, fractions: { ATG: 1 },
    })
    expect(id).toMatch(/^usage_\d+$/)
    expect(store().customUsageTables).toHaveLength(1)
    expect(store().customUsageTables[0].name).toBe('my host')

    store().removeCustomUsageTable(id)
    expect(store().customUsageTables).toHaveLength(0)
  })

  it('never reuses an id', () => {
    const a = store().addCustomUsageTable({
      id: '', name: 'a', source: '', approximate: false, fractions: {},
    })
    const b = store().addCustomUsageTable({
      id: '', name: 'b', source: '', approximate: false, fractions: {},
    })
    expect(a).not.toBe(b)
  })
})
