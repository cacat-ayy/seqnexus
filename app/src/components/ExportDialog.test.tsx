import { render, screen, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ExportDialog from './ExportDialog'

const base = { open: true, defaultName: 'pTest', annotationCount: 2, onExport: vi.fn(), onClose: vi.fn() }

describe('ExportDialog', () => {
  it('says what the chosen format keeps and leaves out', async () => {
    render(<ExportDialog {...base} itemKind="sequence" />)
    const keeps = () => screen.getByRole('list', { name: 'What this file keeps' })
    expect(keeps().textContent).toContain('Colours')
    await act(async () => { fireEvent.click(screen.getByText('FASTA')) })
    const lost = [...keeps().querySelectorAll('li.lost')].map(li => li.textContent)
    expect(lost).toEqual(['Features', 'Primers', 'Topology'])
  })

  it('warns before writing what the format cannot hold', () => {
    render(<ExportDialog {...base} itemKind="sequence" warningsFor={f => (f === 'gb' ? ['pTest: the primer p1 binds nowhere'] : [])} />)
    expect(screen.getByText('pTest: the primer p1 binds nowhere')).toBeInTheDocument()
  })

  it('writes reads as FASTQ by default, which keeps their qualities', () => {
    render(<ExportDialog {...base} itemKind="read" />)
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('pTest.fastq')
  })

  it('offers a protein GenPept, with no topology to keep', () => {
    render(<ExportDialog {...base} itemKind="sequence" protein />)
    expect(screen.getByText(/^GenPept/)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'What this file keeps' }).textContent).not.toContain('Topology')
  })

  it('packs several items into one ZIP when asked', async () => {
    const onExport = vi.fn()
    render(<ExportDialog {...base} defaultName="export_3_items" itemKind="sequence" count={3} itemNames={['a.gb', 'b.gb', 'c.gb']} onExport={onExport} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'One ZIP' })) })
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('export_3_items.zip')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Export' })) })
    expect(onExport).toHaveBeenCalledWith('gb', 'export_3_items.zip', 'zip')
  })

  it('offers separate files or a ZIP, never one combined file, for alignments', () => {
    render(<ExportDialog {...base} itemKind="alignment" count={2} />)
    expect(screen.queryByRole('button', { name: 'Combined file' })).toBeNull()
    expect(screen.getByRole('button', { name: 'One ZIP' })).toBeInTheDocument()
  })

  it('says which alignment formats lose spaces in names', async () => {
    render(<ExportDialog {...base} itemKind="alignment" />)
    await act(async () => { fireEvent.click(screen.getByText('PHYLIP')) })
    expect(screen.getByRole('list', { name: 'What this file keeps' }).querySelector('li.lost')?.textContent).toBe('Names with spaces')
  })
})
