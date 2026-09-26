/**
 * Converting ORFs into CDS features.
 *
 * Deliberately the same contract as the auto-annotation conversion — one undo
 * entry, picks cleared, overlay off — with one difference: the ORF overlay
 * keeps showing an ORF after it has been annotated, so what has to hold is
 * that converting twice does not produce two copies.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'
import { orfKey } from './utils/orf-features'
import type { ORFResult } from './workers/orf-finder'

const store = () => useEditorStore.getState()

const A: ORFResult = { start: 0, end: 30, strand: 1, frame: 0, codons: 10 }
const B: ORFResult = { start: 40, end: 70, strand: -1, frame: 1, codons: 10 }

describe('ORF conversion', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pOrf', 'ATGC'.repeat(30))
    store().clearOrfs()
  })

  it('picks and unpicks by ORF key', () => {
    store().setOrfResults([A, B])
    store().toggleOrfPick(orfKey(A))
    expect([...store().orfPicks]).toEqual([orfKey(A)])
    store().toggleOrfPick(orfKey(A))
    expect(store().orfPicks.size).toBe(0)
  })

  it('drops picks for ORFs a re-scan no longer finds', () => {
    store().setOrfResults([A, B])
    store().toggleOrfPick(orfKey(A))
    store().toggleOrfPick(orfKey(B))
    // Raising the minimum ORF size drops the shorter one.
    store().setOrfResults([A])
    expect([...store().orfPicks]).toEqual([orfKey(A)])
  })

  it('forgets picks when the overlay is switched off', () => {
    store().setOrfResults([A])
    store().toggleOrfs()
    store().toggleOrfPick(orfKey(A))
    store().toggleOrfs()
    expect(store().orfPicks.size).toBe(0)
  })

  it('converts only the picked ORFs, as CDS features', () => {
    store().setOrfResults([A, B])
    expect(store().applyOrfs([orfKey(A)])).toBe(1)

    expect(store().doc.annotations).toHaveLength(1)
    expect(store().doc.annotations[0]).toMatchObject({
      name: 'ORF +1 (10 aa)', type: 'CDS', start: 0, end: 30, strand: 1,
    })
  })

  it('converts every convertible ORF when given no keys', () => {
    store().setOrfResults([A, B])
    expect(store().applyOrfs()).toBe(2)
    expect(store().doc.annotations).toHaveLength(2)
  })

  it('switches the overlay off and clears picks once converted', () => {
    store().setOrfResults([A])
    store().toggleOrfs()
    store().toggleOrfPick(orfKey(A))

    store().applyOrfs([orfKey(A)])

    expect(store().showOrfs).toBe(false)
    expect(store().orfPicks.size).toBe(0)
  })

  it('lands as a single undo entry however many were converted', () => {
    store().setOrfResults([A, B])
    store().applyOrfs()
    store().undo()
    expect(store().doc.annotations).toHaveLength(0)
  })

  it('will not convert the same ORF twice', () => {
    store().setOrfResults([A, B])
    store().applyOrfs([orfKey(A)])
    expect(store().applyOrfs([orfKey(A)])).toBe(0)
    expect(store().doc.annotations).toHaveLength(1)
  })

  it('keeps showing a converted ORF — only the conversion skips it', () => {
    store().setOrfResults([A, B])
    store().applyOrfs([orfKey(A)])
    // The overlay still holds both: an annotated reading frame is still a
    // reading frame. Only the second conversion knows to leave it alone.
    expect(store().orfResults).toHaveLength(2)
    expect(store().applyOrfs()).toBe(1)
  })

  it('ignores keys that are not on offer', () => {
    store().setOrfResults([A])
    expect(store().applyOrfs(['nonsense'])).toBe(0)
    expect(store().doc.annotations).toHaveLength(0)
  })
})
