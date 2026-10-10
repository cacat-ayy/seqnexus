import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import { isWidgetKeyTarget } from '../utils/key-target'
import FeatureSidebar from './FeatureSidebar'
import { useEditorStore } from '../store'
import { registerSequenceViewCenter } from './sequence-view-controls'

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

describe('FeatureSidebar joined features', () => {
  beforeEach(() => {
    store().loadDocument('test', 'ACGT'.repeat(50), 'linear')
    store().setSidebarTab('features')
  })

  it('makes one feature with a part per selected range', () => {
    store().setSelections({ anchor: 60, caret: 90 }, [{ anchor: 10, caret: 30 }])
    render(<FeatureSidebar open onClose={() => {}} />)
    act(() => { store().setRequestAddAnnotation(true) })
    // The parts in reading order, 1-based, in place of the Range inputs.
    expect(screen.getByText('11..30, 61..90')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add Feature' }))
    const anns = store().doc.annotations
    const added = anns[anns.length - 1]
    expect(added.start).toBe(10)
    expect(added.end).toBe(90)
    expect(added.segments).toEqual([[10, 30], [60, 90]])
  })

  it('edits a part of a joined feature and keeps the join', () => {
    store().addAnnotation({ id: 'j', name: 'exons', type: 'CDS', start: 50, end: 120, strand: 1, segments: [[50, 70], [100, 120]] })
    render(<FeatureSidebar open onClose={() => {}} />)
    act(() => { store().setEditAnnotation('j') })
    const joined = () => store().doc.annotations.find(a => a.id === 'j')!

    const end1 = screen.getByLabelText('Part 1 end')
    fireEvent.change(end1, { target: { value: '80' } })
    fireEvent.keyDown(end1, { key: 'Enter' })
    expect(joined().segments).toEqual([[50, 80], [100, 120]])

    // A part that would overlap the one before is refused, with the reason.
    const start2 = screen.getByLabelText('Part 2 start')
    fireEvent.change(start2, { target: { value: '60' } })
    fireEvent.keyDown(start2, { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toMatch(/follow/)
    expect(joined().segments).toEqual([[50, 80], [100, 120]])

    // The last part's end moves the feature's end with it.
    const end2 = screen.getByLabelText('Part 2 end')
    fireEvent.change(end2, { target: { value: '150' } })
    fireEvent.keyDown(end2, { key: 'Enter' })
    expect([joined().end, joined().segments]).toEqual([150, [[50, 80], [100, 150]]])
  })

  it('annotates the whole span instead on request', () => {
    store().setSelections({ anchor: 60, caret: 90 }, [{ anchor: 10, caret: 30 }])
    render(<FeatureSidebar open onClose={() => {}} />)
    act(() => { store().setRequestAddAnnotation(true) })
    fireEvent.click(screen.getByRole('button', { name: 'One Span' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Feature' }))
    const anns = store().doc.annotations
    const added = anns[anns.length - 1]
    expect([added.start, added.end, added.segments]).toEqual([10, 90, undefined])
  })
})

describe('FeatureSidebar editing and keyboard', () => {
  beforeEach(() => {
    store().loadDocument('test', 'ACGT'.repeat(50), 'linear')
    store().setSidebarTab('features')
    store().setSelection({ anchor: 0, caret: 0 })
    store().addAnnotation({ id: 'f1', name: 'geneA', type: 'misc_feature', start: 10, end: 40, strand: 1 })
    store().addAnnotation({ id: 'f2', name: 'orf', type: 'CDS', start: 50, end: 59, strand: 1 })
  })
  afterEach(cleanup)

  const ann = (id: string) => store().doc.annotations.find(a => a.id === id)

  it('folds typing a name into one undo step', () => {
    render(<FeatureSidebar open onClose={() => {}} />)
    act(() => { store().setEditAnnotation('f1') })
    const name = screen.getByLabelText('Name')
    act(() => { name.focus() })
    for (const v of ['g', 'ge', 'gen']) fireEvent.change(name, { target: { value: v } })
    expect(ann('f1')?.name).toBe('gen')
    act(() => { store().undo() })
    expect(ann('f1')?.name).toBe('geneA')
  })

  it('commits a range only when it is finished, as one step, and refuses a backwards one', () => {
    render(<FeatureSidebar open onClose={() => {}} />)
    act(() => { store().setEditAnnotation('f1') })
    const end = screen.getByLabelText('End')
    fireEvent.change(end, { target: { value: '4' } })
    // Nothing yet: "4" is on the way to "45".
    expect(ann('f1')?.end).toBe(40)
    fireEvent.change(end, { target: { value: '45' } })
    fireEvent.keyDown(end, { key: 'Enter' })
    expect(ann('f1')?.end).toBe(45)
    fireEvent.change(end, { target: { value: '5' } })
    fireEvent.keyDown(end, { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toMatch(/after end/)
    expect(ann('f1')?.end).toBe(45)
  })

  it('flags a CDS that does not read cleanly on its row', () => {
    // 50..59 is 9 bases of ACGT repeats: in frame, no stop at the end.
    render(<FeatureSidebar open onClose={() => {}} />)
    expect(document.querySelector(`#fs-opt-f2 .ft-issue-icon`)).not.toBeNull()
    expect(document.querySelector(`#fs-opt-f1 .ft-issue-icon`)).toBeNull()
  })

  it('runs the list from the keyboard without the keys reaching the sequence', () => {
    render(<FeatureSidebar open onClose={() => {}} />)
    const list = screen.getByRole('listbox', { name: 'Features' })
    // The sequence editor ignores keys aimed at a listbox.
    expect(isWidgetKeyTarget(list)).toBe(true)
    act(() => { list.focus() })

    // CDS is the first group: Down lands on its row and selects its span.
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(store().selection).toMatchObject({ anchor: 50, caret: 59 })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(store().selection).toMatchObject({ anchor: 10, caret: 40 })
    expect(list.getAttribute('aria-activedescendant')).toBe('fs-opt-f1')

    fireEvent.keyDown(list, { key: 'Delete' })
    expect(ann('f1')).toBeUndefined()
    expect(store().doc.sequence.length).toBe(200)

    fireEvent.keyDown(list, { key: 'z', ctrlKey: true })
    expect(ann('f1')).toBeDefined()

    // Typing a letter in the list types into the filter.
    fireEvent.keyDown(list, { key: 'o' })
    expect((screen.getByLabelText('Filter features') as HTMLInputElement).value).toBe('o')
  })

  it('marks the rows under the selection and makes a clicked feature the active row', () => {
    render(<FeatureSidebar open onClose={() => {}} />)
    act(() => { store().setSelection({ anchor: 10, caret: 40 }) })
    const row = document.getElementById('fs-opt-f1')!
    expect(row.className).toMatch(/\bhere\b/)
    expect(row.className).toMatch(/\bactive\b/)
    expect(document.getElementById('fs-opt-f2')!.className).not.toMatch(/\bhere\b/)
  })

  it('filters by terms', () => {
    render(<FeatureSidebar open onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Filter features'), { target: { value: 'type:cds len<20' } })
    expect(document.getElementById('fs-opt-f2')).not.toBeNull()
    expect(document.getElementById('fs-opt-f1')).toBeNull()
  })
})

describe('FeatureSidebar hover card and context menu', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    store().loadDocument('test', 'ACGT'.repeat(50), 'linear')
    store().setSidebarTab('features')
    store().addAnnotation({ id: 'mcs', name: 'MCS', type: 'misc_feature', start: 10, end: 60, strand: 1 })
  })
  afterEach(() => { vi.useRealTimers(); cleanup() })

  const row = () => screen.getByText('MCS').closest('.ft-summary') as HTMLElement
  const card = () => document.querySelector('.ft-tooltip-name')

  it('shows the hover card after a pause on a row', () => {
    render(<FeatureSidebar open onClose={() => {}} />)
    fireEvent.mouseEnter(row())
    act(() => { vi.advanceTimersByTime(500) })
    expect(card()).not.toBeNull()
  })

  it('does not show it under the context menu, pending or already showing', () => {
    render(<FeatureSidebar open onClose={() => {}} />)
    // Pending: right-clicked before the card appeared.
    fireEvent.mouseEnter(row())
    fireEvent.contextMenu(row())
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(card()).toBeNull()
  })

  it('takes away a card already showing when the menu opens', () => {
    render(<FeatureSidebar open onClose={() => {}} />)
    const r = row()
    fireEvent.mouseEnter(r)
    act(() => { vi.advanceTimersByTime(500) })
    expect(card()).not.toBeNull()
    fireEvent.contextMenu(r)
    expect(card()).toBeNull()
  })
})

describe('FeatureSidebar centring a picked feature', () => {
  let centred: [number, number][] = []
  let unregister: () => void = () => {}
  beforeEach(() => {
    centred = []
    unregister = registerSequenceViewCenter((start, end) => { centred.push([start, end]) })
    store().loadDocument('test', 'ACGT'.repeat(50), 'linear')
    store().setSidebarTab('features')
    store().addAnnotation({ id: 'lac', name: 'lacZ', type: 'CDS', start: 120, end: 180, strand: 1 })
  })
  afterEach(() => { unregister(); cleanup() })

  const row = () => screen.getByText('lacZ').closest('.ft-summary') as HTMLElement

  it('selects and centres the feature on a double-click', () => {
    render(<FeatureSidebar open onClose={() => {}} />)
    fireEvent.doubleClick(row())
    expect(store().selection).toEqual({ anchor: 120, caret: 180 })
    expect(centred).toEqual([[120, 180]])
  })

  it('centres it from the context menu\'s Select', () => {
    render(<FeatureSidebar open onClose={() => {}} />)
    fireEvent.contextMenu(row())
    fireEvent.click(screen.getByRole('menuitem', { name: /^Select/ }))
    expect(store().selection).toEqual({ anchor: 120, caret: 180 })
    expect(centred).toEqual([[120, 180]])
  })

  it('only scrolls it into view on a single click', () => {
    render(<FeatureSidebar open onClose={() => {}} />)
    fireEvent.click(row())
    expect(store().selection).toEqual({ anchor: 120, caret: 180 })
    expect(centred).toEqual([])
  })
})
