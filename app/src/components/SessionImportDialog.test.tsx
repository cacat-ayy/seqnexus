import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import SessionImportDialog from './SessionImportDialog'
import { describeSession, type RestoredSession } from '../persistence'

const session = (over: Partial<RestoredSession>): RestoredSession => ({
  tabs: [], activeTabId: null, folders: [], theme: 'light', itemMeta: {}, tagColors: {},
  sequencingReads: [], activeSequencingReadIds: [], alignments: [], contigs: [], assemblies: [],
  readSets: [], oligos: [], gels: [], clones: [],
  ...over,
}) as RestoredSession

describe('describeSession', () => {
  it('counts every kind, so a session of gels alone does not read as empty', () => {
    expect(describeSession(session({ gels: [{}, {}] as never }))).toBe('2 gels')
    expect(describeSession(session({
      tabs: [{ doc: { sequence: { alphabet: 'dna' } } }, { doc: { sequence: { alphabet: 'protein' } } }] as never,
      oligos: [{}] as never,
    }))).toBe('1 sequence, 1 protein and 1 oligo')
    expect(describeSession(session({}))).toBe('')
  })
})

describe('SessionImportDialog', () => {
  it('makes Merge the main action and Replace the destructive one', () => {
    render(<SessionImportDialog open filename="s.json" session={session({ gels: [{}] as never })} onClose={vi.fn()} onReplace={vi.fn()} onMerge={vi.fn()} />)
    expect(screen.getByText('Contains 1 gel.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Merge' }).className).toContain('btn-primary')
    expect(screen.getByRole('button', { name: 'Replace' }).className).not.toContain('btn-primary')
  })
})
