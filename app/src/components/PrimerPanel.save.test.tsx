/**
 * Regression guard for the primer save path.
 *
 * "Save as Annotations" used to call the singular addAnnotation once per
 * primer — up to three per selected pair — so one button press cost a dozen
 * undo entries, each replaying a full-document snapshot. It must be one.
 */
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import PrimerPanel from './PrimerPanel'
import { useEditorStore } from '../store'
import type { PrimerPair } from '../primers/finder'

const store = () => useEditorStore.getState()

function undoDepth(): number {
  const s = store()
  return s.tabs.find(t => t.id === s.activeTabId)!.undoStack.length
}

/** Minimal primer candidate — only the fields the save path reads. */
const candidate = (start: number, end: number, strand: 1 | -1) => ({
  sequence: 'ATGCATGCATGCATGCAT',
  start, end, strand,
  length: end - start,
  tm: 60.1, gc: 50, penalty: 1,
  hairpin: 0, selfDimer: 0, endStability: 0, gcClamp: true, maxHomopolymer: 2,
}) as unknown as PrimerPair['forward']

function pair(i: number): PrimerPair {
  const base = i * 200
  return {
    forward: candidate(base, base + 18, 1),
    reverse: candidate(base + 150, base + 168, -1),
    probe: candidate(base + 60, base + 84, 1),
    productSize: 168,
    penalty: 2,
  }
}

describe('PrimerPanel save as annotations', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pPrimer', 'ATGC'.repeat(300))
  })

  it('writes every selected primer in a single undoable action', async () => {
    render(<PrimerPanel open onClose={vi.fn()} />)

    act(() => { store().setPrimerResults([pair(0), pair(1), pair(2)]) })
    // setPrimerResults selects only the first pair; select the other two.
    act(() => { store().toggleSelectedPrimer(1); store().toggleSelectedPrimer(2) })
    expect(store().selectedPrimerIndices.size).toBe(3)

    // The probe checkbox is off by default, so this run saves fwd + rev.
    const before = undoDepth()
    const save = screen.getByRole('button', { name: /Save as Annotations/i })
    act(() => { save.click() })

    expect(store().doc.annotations).toHaveLength(6)   // 3 pairs x fwd+rev
    expect(undoDepth()).toBe(before + 1)
  })

  it('one undo removes all of them', () => {
    render(<PrimerPanel open onClose={vi.fn()} />)
    act(() => { store().setPrimerResults([pair(0), pair(1)]) })
    act(() => { store().toggleSelectedPrimer(1) })

    const save = screen.getByRole('button', { name: /Save as Annotations/i })
    act(() => { save.click() })
    expect(store().doc.annotations.length).toBeGreaterThan(0)

    act(() => { store().undo() })
    expect(store().doc.annotations).toHaveLength(0)
  })
})
