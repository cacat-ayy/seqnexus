/**
 * Smoke tests for the file explorer's multi-selection after it moved onto the
 * shared useListMultiSelect hook.
 *
 * The hook's own behaviour is covered in useListMultiSelect.test.ts; what these
 * check is the wiring — that the explorer still drives the store slice, and
 * that its section-aware "first ctrl-click also takes the open document" rule
 * survived the move.
 */
import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import FileExplorer from './FileExplorer'
import { useEditorStore } from '../store'

const store = () => useEditorStore.getState()
const noop = vi.fn()

function renderExplorer() {
  return render(
    <FileExplorer
      onImportFile={noop}
      onOpenProperties={noop}
      onOpenInfo={noop}
      onAlignToRef={noop}
      onQuickAlign={noop}
      onExportItems={noop}
    />,
  )
}

/** The rendered document rows, in list order. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('li.fe-item')]
}

function clickRow(el: HTMLElement, mods: Partial<MouseEventInit> = {}) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...mods }))
  })
}

describe('FileExplorer multi-selection', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().setExplorerSelectedIds(new Set())
    store().openDocument('one', 'ATGC')
    store().openDocument('two', 'GGCC')
    store().openDocument('three', 'TTAA')
  })

  it('renders a row per document', () => {
    renderExplorer()
    expect(rows().length).toBeGreaterThanOrEqual(3)
  })

  it('ctrl-click writes the selection into the store', () => {
    renderExplorer()
    clickRow(rows()[0], { ctrlKey: true })
    expect(store().explorerSelectedIds.size).toBeGreaterThan(0)
  })

  it('first ctrl-click also picks up the active document', () => {
    renderExplorer()
    const active = store().activeTabId!
    // Click a row that is not the active one.
    const other = rows().find(r => !r.className.includes('active'))!
    clickRow(other, { ctrlKey: true })
    expect(store().explorerSelectedIds.has(active)).toBe(true)
    expect(store().explorerSelectedIds.size).toBe(2)
  })

  it('plain click collapses the selection', () => {
    renderExplorer()
    clickRow(rows()[0], { ctrlKey: true })
    expect(store().explorerSelectedIds.size).toBeGreaterThan(0)
    clickRow(rows()[1])
    expect(store().explorerSelectedIds.size).toBe(0)
  })

  it('shift-click after a plain click selects a range', () => {
    renderExplorer()
    const r = rows()
    clickRow(r[0])
    clickRow(r[2], { shiftKey: true })
    expect(store().explorerSelectedIds.size).toBe(3)
  })

  it('drops a selected document from the selection when it is closed', () => {
    renderExplorer()
    // Rows are not in insertion order — the active document is hoisted — so
    // pick by class, not index. Indexing blindly makes the second ctrl-click
    // land on the row the first one implicitly selected, toggling it back off.
    const inactive = rows().filter(r => !r.className.includes('active'))
    clickRow(inactive[0], { ctrlKey: true })
    clickRow(inactive[1], { ctrlKey: true })
    const picked = [...store().explorerSelectedIds]
    expect(picked.length).toBeGreaterThanOrEqual(2)

    act(() => { store().closeTab(picked[0]) })
    expect(store().explorerSelectedIds.has(picked[0])).toBe(false)
  })
})
