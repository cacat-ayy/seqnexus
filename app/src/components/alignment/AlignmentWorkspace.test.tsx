import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useEditorStore } from '../../store'
import { makeDoc } from '../../msa/model'
import { useToastStore } from '../../toast'
import AlignmentWorkspace from './AlignmentWorkspace'

function Harness() {
  const aln = useEditorStore(s => s.alignments.find(a => a.id === s.activeAlignmentId))
  return aln
    ? <AlignmentWorkspace key={aln.id} aln={aln} onClose={() => useEditorStore.getState().setActiveAlignment(null)} />
    : <div>no alignment</div>
}

const doc = () => useEditorStore.getState().alignments[0].doc
const seqs = () => doc().rows.map(r => r.seq)
const grid = () => screen.getByRole('grid', { name: 'Alignment' })

function setup(rows: [string, string][] = [['alpha', 'ACGT-ACGT'], ['beta', 'ACGTTACGT']]) {
  localStorage.clear()
  useEditorStore.setState({ alignments: [], activeAlignmentId: null, recentlyDeleted: [] })
  useEditorStore.getState().addAlignment(makeDoc(rows.map(([name, seq]) => ({ name, seq })), { method: 'import', format: 'Clustal', at: 1 }))
}

describe('AlignmentWorkspace', () => {
  beforeEach(() => setup())

  it('summarises the alignment in the header and the inspector', () => {
    render(<Harness />)
    expect(screen.getByRole('textbox', { name: 'Alignment name' })).toHaveValue('alpha vs beta')
    expect(screen.getByText('Clustal file')).toBeInTheDocument()
    expect(screen.getByText(/2 sequences · 9 columns/)).toBeInTheDocument()
    expect(screen.getByText('Whole alignment')).toBeInTheDocument()
    expect(screen.getByText('Identical sites')).toBeInTheDocument()
  })

  it('does not change residues until editing is turned on', () => {
    render(<Harness />)
    fireEvent.keyDown(grid(), { key: 'ArrowRight' })
    fireEvent.keyDown(grid(), { key: 'G' })
    expect(seqs()[0]).toBe('ACGT-ACGT')
    expect(useToastStore.getState().toasts.some(t => t.message === 'Turn on Edit to change residues and gaps')).toBe(true)
  })

  it('types, inserts gaps and undoes with the keyboard in edit mode', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /^Edit/ }))
    fireEvent.keyDown(grid(), { key: 'ArrowRight' }) // caret: row 1, column 2
    fireEvent.keyDown(grid(), { key: 'g' })
    expect(seqs()[0]).toBe('AGGT-ACGT')
    fireEvent.keyDown(grid(), { key: ' ' })
    expect(seqs()[0]).toBe('AG-GT-ACGT') // the gap goes in at the caret, after the typed G
    expect(seqs()[1]).toBe('ACGTTACGT-')
    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true })
    expect(seqs()[0]).toBe('AGGT-ACGT')
    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true })
    expect(seqs()[0]).toBe('ACGT-ACGT')
    fireEvent.keyDown(grid(), { key: 'y', ctrlKey: true })
    expect(seqs()[0]).toBe('AGGT-ACGT')
  })

  it('Backspace removes a gap and pulls the row left', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /^Edit/ }))
    for (let i = 0; i < 5; i++) fireEvent.keyDown(grid(), { key: 'ArrowRight' }) // column 5, after the gap
    fireEvent.keyDown(grid(), { key: 'Backspace' })
    expect(seqs()).toEqual(['ACGTACGT-', 'ACGTTACGT'])
  })

  it('selects everything and joins the rows', () => {
    render(<Harness />)
    fireEvent.keyDown(grid(), { key: 'a', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: /Join 2 rows/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect(doc().rows).toHaveLength(1)
    expect(doc().rows[0].seq).toBe('ACGTTACGT')
    expect(doc().rows[0].name).toBe('alpha + beta')
  })

  it('strips gap-only columns', () => {
    setup([['a', 'A-CG'], ['b', 'A-CT']])
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Strip columns/ }))
    expect(screen.getByText('Removes 1 of 4 columns.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Strip' }))
    expect(seqs()).toEqual(['ACG', 'ACT'])
  })

  it('renames a row from its name', () => {
    render(<Harness />)
    fireEvent.doubleClick(screen.getByText('alpha', { selector: '.aw-name-text' }))
    const input = screen.getByDisplayValue('alpha')
    fireEvent.change(input, { target: { value: 'alpha-1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(doc().rows[0].name).toBe('alpha-1')
  })

  it('switches colour scheme and highlighting through the view, not the history', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Colour'), { target: { value: 'gc-at' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Differences' }))
    const aln = useEditorStore.getState().alignments[0]
    expect(aln.view.dnaScheme).toBe('gc-at')
    expect(aln.view.highlight).toBe('differences')
    expect(aln.undoStack).toHaveLength(0)
  })

  it('finds a motif across gaps', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Find/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a motif' }), { target: { value: 'GTAC' } })
    expect(screen.getByText('1 of 1')).toBeInTheDocument()
  })

  it('lists every export format', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    for (const label of ['Aligned FASTA', 'Clustal', 'PHYLIP', 'NEXUS', 'MEGA', 'Stockholm', 'PIR / NBRF', 'GCG MSF']) {
      expect(screen.getByText(label, { selector: '.aw-menu-label' })).toBeInTheDocument()
    }
  })

  it('keeps the selection valid when undo removes rows', () => {
    render(<Harness />)
    fireEvent.keyDown(grid(), { key: 'a', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: /Join 2 rows/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    act(() => { useEditorStore.getState().undoAlignment(useEditorStore.getState().alignments[0].id) })
    expect(doc().rows).toHaveLength(2)
    expect(screen.getByText('Whole alignment')).toBeInTheDocument()
  })
})

describe('adding sequences', () => {
  beforeEach(() => setup([['alpha', 'TTTTTGGCCAATTGCAAAAA'], ['beta', 'TTTTTGGCCAATTGCAAAAA']]))

  it('fits pasted sequences to the alignment without changing it', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /^Add/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Paste sequences' }), { target: { value: '>frag\nGGCCAATTGC\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add sequence' }))
    await act(async () => { await new Promise(r => setTimeout(r, 60)) })
    expect(doc().rows.map(r => r.name)).toEqual(['alpha', 'beta', 'frag'])
    expect(seqs()).toEqual(['TTTTTGGCCAATTGCAAAAA', 'TTTTTGGCCAATTGCAAAAA', '-----GGCCAATTGC-----'])
    expect(useEditorStore.getState().alignments[0].undoStack[0].label).toBe('Add a sequence')
  })
})
