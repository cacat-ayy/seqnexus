import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NewSequenceDialog, { type NewSequenceResult } from './NewSequenceDialog'
import { readPasted } from '../io/pasted'

function open() {
  const onSubmit = vi.fn<(r: NewSequenceResult) => void>()
  render(<NewSequenceDialog open onClose={() => {}} onSubmit={onSubmit} />)
  const paste = (text: string) => fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: text } })
  return { onSubmit, paste }
}

describe('readPasted', () => {
  it('splits at headers, naming each record and keeping its description', () => {
    expect(readPasted('>a first one\nacgt\n>b\nGG GG\n')).toEqual([
      { name: 'a', description: 'first one', bases: 'ACGT' },
      { name: 'b', description: '', bases: 'GGGG' },
    ])
  })

  it('takes bare letters as one record without a name', () => {
    expect(readPasted('1 acgtacgtac gt')).toEqual([{ name: null, description: '', bases: 'ACGTACGTACGT' }])
  })
})

describe('NewSequenceDialog', () => {
  it('names the sequence from a pasted FASTA header', () => {
    const { onSubmit, paste } = open()
    paste('>pX my plasmid\nACGTACGT\n')
    expect((screen.getByPlaceholderText('Sequence name') as HTMLInputElement).value).toBe('pX')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    const [doc] = onSubmit.mock.calls[0][0].docs
    expect(doc.name).toBe('pX')
    expect(doc.description).toBe('my plasmid')
    expect(doc.sequence.bases).toBe('ACGTACGT')
  })

  it('makes one sequence per record of a multi-record FASTA, where it used to join them', () => {
    const { onSubmit, paste } = open()
    paste('>seqA\nACGTACGTACGT\n>seqB\nGGGGCCCCAAAA\n')
    fireEvent.click(screen.getByRole('button', { name: 'Create 2 sequences' }))
    const { docs, folderName } = onSubmit.mock.calls[0][0]
    expect(docs.map(d => [d.name, d.sequence.bases])).toEqual([['seqA', 'ACGTACGTACGT'], ['seqB', 'GGGGCCCCAAAA']])
    expect(folderName).toBe('New sequences')
  })

  it('reads a pasted GenBank record as GenBank, not as a protein made of its header', () => {
    const { onSubmit, paste } = open()
    paste('LOCUS       pX 12 bp DNA linear\nORIGIN\n        1 acgtacgtac gt\n//\n')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Molecule' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    const [doc] = onSubmit.mock.calls[0][0].docs
    expect(doc.name).toBe('pX')
    expect(doc.sequence.bases).toBe('ACGTACGTACGT')
    expect(doc.sequence.alphabet).toBe('dna')
  })

  it('says what the paste was read as before Create', () => {
    const { paste } = open()
    paste('>a\nACGT\n>b\nGGCC\n')
    expect(screen.getByText('DNA · 2 records · 8 bp')).toBeTruthy()
  })

  it('creates on Enter in the name field', () => {
    const { onSubmit, paste } = open()
    paste('ACGT')
    fireEvent.keyDown(screen.getByPlaceholderText('Sequence name'), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalled()
  })

  it('opens as New Protein with the molecule set', () => {
    const onSubmit = vi.fn<(r: NewSequenceResult) => void>()
    render(<NewSequenceDialog open initialAlphabet="protein" onClose={() => {}} onSubmit={onSubmit} />)
    expect(screen.getByRole('heading').textContent).toBe('New Protein')
    // ACGT alone would be guessed DNA; New Protein keeps it a protein.
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: 'ACGT' } })
    expect(screen.getByText('A protein is always linear.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onSubmit.mock.calls[0][0].docs[0].sequence.alphabet).toBe('protein')
  })

  it('still refuses letters that are not codes', () => {
    const { onSubmit, paste } = open()
    paste('ACGT-ACGT')
    expect(screen.getByRole('alert').textContent).toMatch(/Not nucleotide codes: -/)
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
