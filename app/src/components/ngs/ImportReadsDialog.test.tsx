import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('../../ngs/peek', () => ({
  PEEK_BYTES: 512 * 1024,
  // Every file is guessed as nanopore, so a guess landing on the wrong row would show; a file named empty has no reads.
  peekReads: vi.fn(async (f: File) => ({
    reads: f.name.startsWith('empty') ? [] : [{ header: `${f.name} runid=1 ch=1`, seq: 'ACGT', qual: 'IIII' }],
    gz: false,
  })),
}))
vi.mock('../../storage/idb', () => ({ deleteReadChunks: vi.fn(), estimateStorage: vi.fn(async () => null) }))
vi.mock('../../workers/readset', () => ({ startImport: vi.fn(), CancelledError: class extends Error {} }))

import ImportReadsDialog from './ImportReadsDialog'

const file = (name: string) => new File(['@r\nACGT\n+\nIIII\n'], name)

describe('ImportReadsDialog', () => {
  it('lets a sample be left out, closes with the last one, and closes on Escape', () => {
    const onClose = vi.fn()
    render(<ImportReadsDialog files={[file('a.fastq.gz'), file('b.fastq.gz')]} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave out a' }))
    expect((screen.getAllByLabelText(/^Name of sample/) as HTMLInputElement[]).map(n => n.value)).toEqual(['b'])
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Leave out b' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('takes focus when it opens, so Escape closes it from wherever the user was', () => {
    const onClose = vi.fn()
    render(<ImportReadsDialog files={[file('a.fastq.gz')]} onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('refuses a small file with no reads in it instead of making an empty read set', async () => {
    render(<ImportReadsDialog files={[new File([], 'empty.fastq.gz'), file('a.fastq.gz')]} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/No reads found in empty\.fastq\.gz/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Import 1 sample' })).toBeTruthy()
  })

  it('adds files dropped while it is open as more samples, where they used to be lost', async () => {
    const first = [file('a.fastq.gz')]
    const { rerender } = render(<ImportReadsDialog files={first} onClose={() => {}} />)
    expect(screen.getAllByLabelText(/^Name of sample/)).toHaveLength(1)

    rerender(<ImportReadsDialog files={[...first, file('b_R1.fastq.gz'), file('b_R2.fastq.gz')]} onClose={() => {}} />)
    const names = screen.getAllByLabelText(/^Name of sample/) as HTMLInputElement[]
    expect(names.map(n => n.value)).toEqual(['a', 'b'])
    expect(screen.getByRole('button', { name: 'Import 2 samples' })).toBeTruthy()
    // Each row gets the guess for its own files.
    await waitFor(() => {
      const techs = screen.getAllByLabelText(/^Technology of/) as HTMLSelectElement[]
      expect(techs.map(t => t.value)).toEqual(['nanopore', 'nanopore'])
    })
  })
})
