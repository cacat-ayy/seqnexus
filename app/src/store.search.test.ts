/**
 * The store's side of Find: which hit is current as a query is typed, hits
 * that follow edits, and replacing on the strand a hit reads on.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore, defaultSearchOptions, type SearchOptions } from './store'

const store = () => useEditorStore.getState()
const open = (bases: string, topology: 'linear' | 'circular' = 'linear') => {
  for (const t of store().tabs) store().closeTab(t.id)
  store().openDocument('p', bases, topology)
}
const opts = (o: Partial<SearchOptions> = {}): SearchOptions => ({ ...defaultSearchOptions, ...o })
const current = () => store().search.matches[store().search.currentMatch]
const bases = () => store().doc.sequence.bases

beforeEach(() => {
  store().setTranslationCode(1)
})

describe('typing a query', () => {
  it('stays on the hit under the selection as the query grows', () => {
    open('GGGGATGGGGATGCCC')
    const o = opts({ revComplement: false })
    for (const q of ['A', 'AT', 'ATG']) {
      store().setSearch(q, o)
      expect(current().start).toBe(4)
    }
    // Only now does the first hit stop matching.
    store().setSearch('ATGC', o)
    expect(current().start).toBe(10)
  })

  it('selects a hit across the origin as an origin-spanning selection', () => {
    open('TTCGGGGGGGGGAA', 'circular')
    store().setSearch('GAATTC', opts())
    expect(store().selection).toEqual({ anchor: 11, caret: 3 })
  })
})

describe('hits follow edits', () => {
  it('searches again after an insertion, and after undo', () => {
    open('GGGGAATTCGGGG')
    store().setSearch('GAATTC', opts())
    store().insert(0, 'TTT')
    expect(current().start).toBe(6)
    store().undo()
    expect(current().start).toBe(3)
  })

  it('drops a hit an edit destroys', () => {
    open('GGGGAATTCGGGG')
    store().setSearch('GAATTC', opts())
    store().delete(5, 6)
    expect(store().search.matches).toEqual([])
  })

  it('searches a protein query again when the genetic code changes', () => {
    open('ATGTGA')
    store().setSearch('MW', opts({ mode: 'protein' }))
    expect(store().search.matches).toHaveLength(0)
    store().setTranslationCode(4)
    expect(store().search.matches).toHaveLength(1)
  })
})

describe('replace', () => {
  it('writes the reverse complement over a reverse-strand hit', () => {
    open('GGGGCATGGGG')
    store().setSearch('ATGC', opts())
    expect(current().strand).toBe(-1)
    store().replaceCurrentMatch('ATGG')
    // The reverse strand now reads ATGG where it read ATGC.
    expect(bases()).toBe('GGGCCATGGGG')
  })

  it('replaces a protein hit with bases and refuses a peptide', () => {
    open('GGATGAAAACCGG')
    store().setSearch('MKT', opts({ mode: 'protein' }))
    store().replaceCurrentMatch('MKA')
    expect(bases()).toBe('GGATGAAAACCGG')
    store().replaceCurrentMatch('ATGAAAGCC')
    expect(bases()).toBe('GGATGAAAGCCGG')
  })

  it('skips overlapping hits in Replace all instead of splicing them', () => {
    open('GGAATTGG')
    store().setSearch('AAT', opts())
    expect(store().search.matches).toHaveLength(2)
    const r = store().replaceAllMatches('CCC')
    expect(r).toEqual({ replaced: 1, skipped: 1 })
    expect(bases()).toBe('GGCCCTGG')
  })

  it('replaces a hit across the origin', () => {
    open('TTCGGGGGGGGGAA', 'circular')
    store().setSearch('GAATTC', opts())
    store().replaceCurrentMatch('AAAAAA')
    expect(bases()).toBe('GGGGGGGGAAAAAA')
  })

  it('replaces every hit, the rightmost first so positions hold', () => {
    open('GAATTCxGAATTCxGAATTC'.replace(/x/g, 'TT'))
    store().setSearch('GAATTC', opts())
    expect(store().replaceAllMatches('A')).toEqual({ replaced: 3, skipped: 0 })
    expect(bases()).toBe('ATTATTA')
    expect(store().search.matches).toEqual([])
  })

  it('is one undo step', () => {
    open('GAATTCTTGAATTC')
    store().setSearch('GAATTC', opts())
    store().replaceAllMatches('A')
    store().undo()
    expect(bases()).toBe('GAATTCTTGAATTC')
  })
})
