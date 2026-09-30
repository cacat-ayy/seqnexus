import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SequenceContextMenu, { type SequenceMenuTarget } from './SequenceContextMenu'
import { useEditorStore } from '../store'
import { Annotation } from '../models/Annotation'
import { primerItems, type PrimerItem } from '../primers/display'

const store = () => useEditorStore.getState()

/** An off-frame CDS: ACC ATG ... reads T M ... with stops inside. */
const BASES = 'ACCATGATTACGCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTCGTAATCATGGTCATAGCTGT'

const cds = new Annotation({ id: 'lacz', name: 'lacZ-alpha', type: 'CDS', start: 0, end: 90, strand: 1, color: '#4dabf7' })

function menu(target: Partial<SequenceMenuTarget>, opts: { primers?: PrimerItem[] } = {}) {
  const byId = new Map((opts.primers ?? []).map(p => [p.annotation.id, p]))
  const props = {
    onClose: vi.fn(),
    onAnnotateRequest: vi.fn(),
    onDeleteAnnotation: vi.fn(),
  }
  render(
    <SequenceContextMenu
      target={{ x: 10, y: 10, seqPos: 5, annId: null, enzymeGroup: null, ...target }}
      annotations={[cds]}
      primerItemById={byId}
      siteCountOf={() => 1}
      {...props}
    />,
  )
  return props
}

describe('SequenceContextMenu', () => {
  beforeEach(() => {
    store().loadDocument('test', BASES, 'circular')
    store().addAnnotation({ id: 'lacz', name: 'lacZ-alpha', type: 'CDS', start: 0, end: 90, strand: 1, color: '#4dabf7' })
    store().setSelection({ anchor: 0, caret: 0 })
  })

  it('opens with a two-line summary of a feature instead of its bases, and flags a broken frame', () => {
    menu({ annId: 'lacz' })
    expect(screen.getByText('lacZ-alpha')).toBeInTheDocument()
    expect(screen.getByText(/1\.\.90 · 90 bp · forward/)).toBeInTheDocument()
    expect(screen.getByText(/internal stop codon/)).toBeInTheDocument()
    expect(screen.queryByText(/ACCATGATTACG/)).toBeNull()
  })

  it('keeps copies and the origin in submenus', () => {
    menu({ annId: 'lacz' })
    expect(screen.getByRole('menuitem', { name: 'Copy Annotation' })).toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.getByRole('menuitem', { name: 'Origin at 6' })).toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.queryByRole('menuitem', { name: 'Set as Position 1' })).toBeNull()
  })

  it('asks the view to confirm a delete', async () => {
    const { onDeleteAnnotation } = menu({ annId: 'lacz' })
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Delete Annotation' }))
    expect(onDeleteAnnotation).toHaveBeenCalledWith(expect.objectContaining({ id: 'lacz' }))
  })

  it('selects the clicked base before asking for a new annotation', async () => {
    const { onAnnotateRequest } = menu({ seqPos: 12 })
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Add Annotation Here…' }))
    expect(store().selection).toEqual({ anchor: 12, caret: 13 })
    expect(onAnnotateRequest).toHaveBeenCalledOnce()
  })

  it('offers no origin actions without a position, as near the map centre', () => {
    menu({ seqPos: null })
    expect(screen.queryByRole('menuitem', { name: /Origin/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Add Annotation/ })).toBeNull()
  })

  it('summarises a primer with its Tm and offers its own actions', () => {
    const primer = { id: 'p1', name: 'M13-fwd', sequence: BASES.slice(20, 37), role: 'primer' as const }
    const [item] = primerItems([primer], new Map([['p1', [{
      primerId: 'p1', start: 20, end: 37, strand: 1 as const,
      annealFrom: 0, annealTo: 17, tail5: '', tail3: '', mismatches: [],
    }]]]), BASES.length)
    menu({ annId: item.annotation.id }, { primers: [item] })
    expect(screen.getByText('M13-fwd')).toBeInTheDocument()
    // Typed as it is saved, like any feature.
    expect(screen.getByText('primer_bind')).toHaveClass('hc-chip')
    expect(screen.getByText(/17 nt · Tm \d+\.\d °C/)).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Copy Oligo' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Show in Primers Panel/ })).toBeInTheDocument()
  })
})
