import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dna, FileUp } from 'lucide-react'
import StartScreen from './StartScreen'

const primary = (run = vi.fn()) => [
  { id: 'new', label: 'New Sequence', description: 'Type or paste', icon: Dna, run },
  { id: 'files', label: 'Import Files', description: 'GenBank and more', icon: FileUp, shortcut: 'Ctrl+O', run: vi.fn() },
]

describe('StartScreen', () => {
  it('welcomes an empty workspace with the ways in and the example', () => {
    const run = vi.fn()
    const example = vi.fn()
    render(<StartScreen primary={primary(run)} more={[]} hasItems={false} onOpenExample={example} />)
    expect(screen.getByRole('heading').textContent).toBe('Start something new')
    fireEvent.click(screen.getByRole('button', { name: /New Sequence/ }))
    expect(run).toHaveBeenCalled()
    expect(screen.getByText('Ctrl+O')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /pUC19 Example/ }))
    expect(example).toHaveBeenCalled()
  })

  it('says nothing is open when the explorer has items, without the example', () => {
    render(<StartScreen primary={primary()} more={[]} hasItems onOpenExample={vi.fn()} />)
    expect(screen.getByRole('heading').textContent).toBe('Nothing open')
    expect(screen.queryByRole('button', { name: /pUC19 Example/ })).toBeNull()
  })
})
