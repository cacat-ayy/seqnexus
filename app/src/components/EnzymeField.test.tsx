import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import EnzymeField, { type CutTarget } from './EnzymeField'

const fill = (n: number) => 'ACGT'.repeat(Math.ceil(n / 4)).slice(0, n)
const put = (s: string, at: number, site: string) => s.slice(0, at) + site + s.slice(at + site.length)

// The vector has one EcoRI and one BamHI site; the insert has EcoRI only.
const VECTOR: CutTarget = {
  source: { name: 'vector', bases: put(put(fill(3000), 100, 'GAATTC'), 1500, 'GGATCC'), topology: 'circular' },
  color: '#123456',
}
const INSERT: CutTarget = {
  source: { name: 'insert', bases: put(fill(800), 400, 'GAATTC'), topology: 'linear' },
  color: '#654321',
}

describe('EnzymeField', () => {
  beforeEach(() => localStorage.clear())

  it('suggests enzymes that cut the first sequence once and every other one', () => {
    render(<EnzymeField value={[]} onChange={vi.fn()} targets={[VECTOR, INSERT]} />)
    fireEvent.focus(screen.getByRole('combobox'))
    const list = screen.getByRole('listbox')
    expect(within(list).getByText('EcoRI')).toBeInTheDocument()
    // BamHI opens the vector once but leaves the insert whole.
    expect(within(list).queryByText('BamHI')).not.toBeInTheDocument()
  })

  it('shows how often an option cuts each sequence', () => {
    render(<EnzymeField value={[]} onChange={vi.fn()} targets={[VECTOR, INSERT]} />)
    const box = screen.getByRole('combobox')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'BamHI' } })
    const option = screen.getAllByRole('option').find(o => o.textContent?.startsWith('BamHI'))!
    const counts = option.querySelector('.ef-counts')!
    expect(counts.textContent).toBe('1×0×')
    expect(counts.getAttribute('title')).toBe('vector: 1 cut\ninsert: 0 cuts')
  })

  it('flags a chosen enzyme that cuts none of the sequences', () => {
    render(<EnzymeField value={['EcoRI', 'NotI']} onChange={vi.fn()} targets={[VECTOR, INSERT]} />)
    const notI = screen.getByText('NotI', { selector: '.ef-chip' })
    expect(within(notI).getByText('0×')).toBeInTheDocument()
    const ecoRI = screen.getByText('EcoRI', { selector: '.ef-chip' })
    expect(within(ecoRI).queryByText('0×')).not.toBeInTheDocument()
  })

  it('adds a name left typed in the box when focus moves away', () => {
    const onChange = vi.fn()
    render(<EnzymeField value={[]} onChange={onChange} targets={[VECTOR]} />)
    const box = screen.getByRole('combobox')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'EcoRI' } })
    fireEvent.blur(box)
    expect(onChange).toHaveBeenCalledWith(['EcoRI'])
  })

  it('flags text left in the box that names no enzyme', () => {
    const onChange = vi.fn()
    render(<EnzymeField value={[]} onChange={onChange} targets={[VECTOR]} />)
    const box = screen.getByRole('combobox')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'EcoQ' } })
    fireEvent.blur(box)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('Not recognised: EcoQ')).toBeInTheDocument()
  })
})
