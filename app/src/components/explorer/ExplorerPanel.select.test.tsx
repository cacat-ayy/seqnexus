/**
 * Smoke tests for the explorer's multi-selection.
 *
 * The hook's own behaviour is covered in useListMultiSelect.test.ts; what
 * these check is the wiring, that the panel still drives the store slice and
 * that the "first ctrl-click also takes the open document" rule survived the
 * move onto uid-keyed selection.
 */
import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import ExplorerPanel from './ExplorerPanel'
import { useEditorStore } from '../../store'
import { toUid } from '../../explorer/types'

const store = () => useEditorStore.getState()
const noop = vi.fn()

function renderExplorer() {
  return render(
    <ExplorerPanel
      open
      onCollapse={noop}
      onExpand={noop}
      onImportFile={noop}
      onOpenProperties={noop}
      onAlignToRef={noop}
      onQuickAlign={noop}
      onExportItems={noop}
    />,
  )
}

/** The rendered item rows, in list order. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.ex-row')]
}

function clickRow(el: HTMLElement, mods: Partial<MouseEventInit> = {}) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...mods }))
  })
}

describe('ExplorerPanel multi-selection', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    useEditorStore.setState({ recentlyDeleted: [], itemMeta: {} })
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

  it('selection is keyed by uid, not by raw store id', () => {
    renderExplorer()
    const open = store().activeTabId!
    const other = rows().find(r => !r.className.includes('open'))!
    clickRow(other, { ctrlKey: true })
    expect(store().explorerSelectedIds.has(toUid('sequence', open))).toBe(true)
    expect(store().explorerSelectedIds.has(open)).toBe(false)
  })

  it('first ctrl-click also picks up the open document', () => {
    renderExplorer()
    const open = store().activeTabId!
    const other = rows().find(r => !r.className.includes('open'))!
    clickRow(other, { ctrlKey: true })
    expect(store().explorerSelectedIds.has(toUid('sequence', open))).toBe(true)
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
    // Rows are not in insertion order, so pick by state rather than index.
    // Indexing blindly makes the second ctrl-click land on the row the first
    // one implicitly selected, toggling it back off.
    const inactive = rows().filter(r => !r.className.includes('open'))
    clickRow(inactive[0], { ctrlKey: true })
    clickRow(inactive[1], { ctrlKey: true })
    const picked = [...store().explorerSelectedIds]
    expect(picked.length).toBeGreaterThanOrEqual(2)

    const tabId = picked[0].slice('sequence:'.length)
    act(() => { store().closeTab(tabId) })
    expect(store().explorerSelectedIds.has(picked[0])).toBe(false)
  })
})
