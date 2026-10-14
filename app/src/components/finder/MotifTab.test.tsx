/**
 * The Motifs tab: the hits in a table, filtered by category, the hit in
 * focus, and adding.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import MotifTab from './MotifTab'
import { useEditorStore } from '../../store'
import { useMotifScan } from '../../hooks/useMotifScan'

const store = () => useEditorStore.getState()

/** The tab with the app's scan, which fills the hits while it is open. */
function Harness() {
  useMotifScan(true)
  return <MotifTab />
}

const rows = () => [...document.querySelectorAll<HTMLElement>('.fd-row')]
const glyco = () => rows().filter(r => r.textContent?.includes('N-glycosylation'))

describe('Motifs tab', () => {
  beforeEach(() => {
    // Two N-glycosylation sequons (N-{P}-[ST]-{P}), at 3 and 10.
    store().openDocument('prot', 'MKNGTAAAANLSGAAAA', 'linear', undefined, undefined, 'protein')
    store().setMotifCategoriesOff([])
    store().clearMotifPicks()
    if (store().showMotifs) store().toggleMotifs()
  })

  it('lists the hits by position, with where they are and the residues matched', () => {
    render(<Harness />)
    expect(glyco().map(r => r.querySelector('.tabular')?.textContent)).toEqual(['3..6', '10..13'])
    expect(glyco()[0].textContent).toContain('NGTA')
  })

  it('leaves out a category switched off', () => {
    render(<Harness />)
    fireEvent.click(screen.getByLabelText(/Modification site/))
    expect(glyco()).toHaveLength(0)
  })

  it('shows the hit clicked, with its pattern, and adds it as a feature', () => {
    render(<Harness />)
    fireEvent.click(glyco()[0])
    expect(store().selection).toMatchObject({ anchor: 2, caret: 6 })
    const inspector = document.querySelector('.fdi') as HTMLElement
    expect(within(inspector).getByText('N-{P}-[ST]-{P}')).toBeTruthy()
    fireEvent.click(within(inspector).getByRole('button', { name: /Add as feature/ }))
    expect(store().doc.annotations.some(a => a.start === 2 && a.end === 6)).toBe(true)
    expect(within(document.querySelector('.fdi') as HTMLElement).getByText(/already has this feature/)).toBeTruthy()
  })

  it('picks with the box and adds only the picked', () => {
    render(<Harness />)
    fireEvent.click(glyco()[1].querySelector('.fd-pick')!)
    fireEvent.click(screen.getByRole('button', { name: 'Add picked (1)' }))
    expect(store().doc.annotations.map(a => a.start)).toEqual([9])
  })

  it('marks a hit the document already has, and does not let it be picked', () => {
    render(<Harness />)
    fireEvent.click(glyco()[0])
    fireEvent.click(within(document.querySelector('.fdi') as HTMLElement).getByRole('button', { name: /Add as feature/ }))
    expect(glyco()[0].classList.contains('is-added')).toBe(true)
    expect((glyco()[0].querySelector('.fd-pick') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('1 already features')).toBeTruthy()
    fireEvent.click(glyco()[0], { ctrlKey: true })
    expect(store().motifPicks.size).toBe(0)
  })

  it('switches the overlay from Show on the sequence', async () => {
    render(<Harness />)
    await act(async () => { fireEvent.click(screen.getByLabelText('Show on the sequence')) })
    expect(store().showMotifs).toBe(true)
  })

  it('says where motifs are found on DNA', () => {
    store().loadDocument('dna', 'ATGAAATAA', 'linear')
    render(<Harness />)
    expect(screen.getByText(/Motifs are found in a protein/)).toBeTruthy()
  })
})
