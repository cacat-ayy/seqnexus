import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useEditorStore } from '../../store'
import { useToastStore } from '../../toast'
import type { TraceData } from '../../io/trace'
import { buildLayout } from '../../sanger/layout'
import ReadWorkspace from './ReadWorkspace'
import ReadSetView from './ReadSetView'

function trace(name: string, bases: string, quality = 40, meta: TraceData['metadata'] = {}): TraceData {
  const spacing = 10
  const len = bases.length * spacing + spacing
  const flat = () => new Array(len).fill(0)
  const traces = { A: flat(), C: flat(), G: flat(), T: flat() }
  const peakLocations = [...bases].map((_, i) => spacing + i * spacing)
  ;[...bases].forEach((b, i) => { if ('ACGT'.includes(b)) traces[b as 'A'][peakLocations[i]] = 800 })
  return { name, bases, peakLocations, qualityScores: new Array(bases.length).fill(quality), traces, metadata: meta }
}

function Harness() {
  const read = useEditorStore(s => (s.activeSequencingReadIds.length === 1 ? s.sequencingReads.find(r => r.id === s.activeSequencingReadIds[0]) : undefined))
  return read ? <ReadWorkspace key={read.id} read={read} onClose={() => useEditorStore.getState().setActiveSequencingRead(null)} /> : <div>no read</div>
}

const read = () => useEditorStore.getState().sequencingReads[0]
const shown = () => buildLayout(read().data, read().edits).bases
const canvas = () => screen.getByRole('application', { name: 'Sequencing trace' })

function setup(bases = 'ACGTACGTAC') {
  localStorage.clear()
  useEditorStore.setState({ sequencingReads: [], activeSequencingReadIds: [], folders: [], recentlyDeleted: [] })
  useEditorStore.getState().addSequencingReads([{ data: trace('M13F_A01', bases, 40, { well: 'A1', instrument: '3730xl' }), trimStart: 0, trimEnd: bases.length }])
}

describe('ReadWorkspace', () => {
  beforeEach(() => setup())

  it('shows the read, its QC and its run details', () => {
    render(<Harness />)
    expect(screen.getByRole('textbox', { name: 'Read name' })).toHaveValue('M13F_A01')
    expect(screen.getByText('3730xl')).toBeInTheDocument()
    expect(screen.getByText(/Keeping/)).toBeInTheDocument()
  })

  it('does not change calls until editing is turned on', () => {
    render(<Harness />)
    fireEvent.keyDown(canvas(), { key: 'ArrowRight' })
    fireEvent.keyDown(canvas(), { key: 'g' })
    expect(read().edits).toEqual([])
    expect(useToastStore.getState().toasts.some(t => t.message === 'Turn on Edit to change base calls')).toBe(true)
  })

  it('replaces, inserts, deletes and undoes from the keyboard', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /^Edit/ }))
    fireEvent.keyDown(canvas(), { key: 'ArrowRight' }) // caret on column 2 (C)
    fireEvent.keyDown(canvas(), { key: 't' })
    expect(shown()).toBe('ATGTACGTAC')
    fireEvent.keyDown(canvas(), { key: 'Insert' })
    fireEvent.keyDown(canvas(), { key: 'a' })
    expect(shown()).toBe('ATAGTACGTAC')
    fireEvent.keyDown(canvas(), { key: 'Backspace' }) // removes the inserted A
    expect(shown()).toBe('ATGTACGTAC')
    fireEvent.keyDown(canvas(), { key: 'Delete' }) // marks the G deleted; it keeps its column
    expect(read().edits.some(e => e.type === 'delete' && e.pos === 2)).toBe(true)
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', expect.stringContaining('Delete base'))
    fireEvent.keyDown(canvas(), { key: 'z', ctrlKey: true })
    expect(read().edits.some(e => e.type === 'delete')).toBe(false)
    fireEvent.keyDown(canvas(), { key: 'y', ctrlKey: true })
    expect(read().edits.some(e => e.type === 'delete')).toBe(true)
  })

  it('edits a reverse-complemented read in its own orientation', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Reverse complement/ }))
    expect(read().reversed).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /^Edit/ }))
    // Shown: GTACGTACGT. Column 1 shows G, which is the forward C at position 9 complemented.
    fireEvent.keyDown(canvas(), { key: 'Home' })
    fireEvent.keyDown(canvas(), { key: 'a' })
    expect(read().edits).toEqual([{ type: 'substitute', pos: 9, original: 'C', base: 'T' }])
  })

  it('trims from the side panel as one undo step each', () => {
    useEditorStore.setState({ sequencingReads: [] })
    useEditorStore.getState().addSequencingReads([{ data: { ...trace('r', 'ACGTACGTACGTACGT', 40), qualityScores: [5, 5, ...new Array(12).fill(40), 5, 5] }, trimStart: 0, trimEnd: 16 }])
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Trim by quality/ }))
    expect([read().trimStart, read().trimEnd]).toEqual([2, 14])
    fireEvent.click(screen.getByRole('button', { name: /Keep the whole read/ }))
    expect([read().trimStart, read().trimEnd]).toEqual([0, 16])
    expect(read().undoStack.map(s => s.label)).toEqual(['Trim by quality', 'Keep the whole read'])
  })
})

describe('Trim and call dialog', () => {
  it('previews every read and applies to all of them, one undo step each', () => {
    localStorage.clear()
    useEditorStore.setState({ sequencingReads: [], activeSequencingReadIds: [], folders: [] })
    const q = [...new Array(15).fill(4), ...new Array(500).fill(40), ...new Array(25).fill(4)]
    const mk = (name: string) => ({ ...trace(name, 'ACGT'.repeat(135), 40), qualityScores: q })
    const ids = useEditorStore.getState().addSequencingReads([
      { data: mk('r1'), trimStart: 0, trimEnd: 540 },
      { data: mk('r2'), trimStart: 0, trimEnd: 540 },
    ])
    render(<ReadSetView readIds={ids} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Trim & call/ }))
    const dialog = screen.getByRole('dialog', { name: 'Trim and call mixed bases' })
    expect(dialog).toHaveTextContent('r1')
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 reads' }))
    for (const r of useEditorStore.getState().sequencingReads) {
      expect([r.trimStart, r.trimEnd]).toEqual([15, 515])
      expect(r.undoStack.map(s => s.label)).toEqual(['Trim'])
    }
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('ReadSetView', () => {
  it('lists reads with their QC and opens one on click', () => {
    localStorage.clear()
    useEditorStore.setState({ sequencingReads: [], activeSequencingReadIds: [], folders: [] })
    const good = trace('B_good', 'ACGT'.repeat(150), 40)
    const bad = trace('A_bad', 'ACGT'.repeat(150), 8)
    const ids = useEditorStore.getState().addSequencingReads([
      { data: good, trimStart: 0, trimEnd: 600 },
      { data: bad, trimStart: 0, trimEnd: 600 },
    ])
    render(<ReadSetView readIds={ids} onClose={() => {}} />)
    expect(screen.getByText(/1 good · 1 failed/)).toBeInTheDocument()
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('A_bad')
    fireEvent.click(screen.getByText('B_good'))
    expect(useEditorStore.getState().activeSequencingReadIds).toEqual([ids[0]])
  })
})
