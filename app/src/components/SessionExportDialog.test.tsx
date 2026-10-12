import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import SessionExportDialog from './SessionExportDialog'
import { useEditorStore, type ReadSet } from '../store'

const readSet = (id: string, name: string): ReadSet => ({
  id, name, createdAt: 1, modifiedAt: 1, technology: 'illumina', paired: true,
  files: [], stats: {} as ReadSet['stats'], qc: {} as ReadSet['qc'], chunks: 3, storedBytes: 5_000_000,
} as ReadSet)

describe('SessionExportDialog', () => {
  beforeEach(() => {
    act(() => {
      useEditorStore.setState({
        tabs: [], sequencingReads: [], alignments: [], contigs: [], assemblies: [],
        gels: [], clones: [], oligos: [], guideLibrary: [], enzymeSets: [],
        readSets: [readSet('rs1', 'sample A'), readSet('rs2', 'sample B')], activeReadSetId: null,
      })
    })
  })

  it('says the read sets stay in the browser, lists them and opens one', () => {
    const onClose = vi.fn()
    render(<SessionExportDialog open onClose={onClose} onExport={vi.fn()} />)
    // The Sanger option says what it counts, rather than "Sequencing reads (0)".
    expect(screen.getByText('Sanger chromatograms (0)')).toBeTruthy()
    expect(screen.getByText('2 NGS read sets stay in this browser')).toBeTruthy()
    expect(screen.getByText('sample A')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1])
    expect(onClose).toHaveBeenCalled()
    expect(useEditorStore.getState().activeReadSetId).toBe('rs2')
  })

  it('offers NGS mappings, which have no contigs, and says their reads stay behind', () => {
    act(() => {
      useEditorStore.setState({
        readSets: [],
        assemblies: [{ id: 'm1', name: 'map', contigIds: [], samples: [{ readSetId: null, readSetName: 'x', storageId: 'm1', report: {} }] }] as never,
      })
    })
    render(<SessionExportDialog open onClose={vi.fn()} onExport={vi.fn()} />)
    const box = screen.getByRole('checkbox', { name: 'Assemblies and mappings (1)' }) as HTMLInputElement
    expect(box.disabled).toBe(false)
    expect(box.checked).toBe(true)
    expect(screen.getByText(/The reads behind the NGS mapping are stored the same way/)).toBeTruthy()
  })

  it('exports a workspace without sequences, and lists what always goes in', () => {
    act(() => { useEditorStore.setState({ readSets: [], gels: [{ id: 'g' }, { id: 'h' }] as never }) })
    render(<SessionExportDialog open onClose={vi.fn()} onExport={vi.fn()} />)
    expect(screen.getByText('Also included: 2 gels.')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Export/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})
