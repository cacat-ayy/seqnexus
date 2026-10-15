/**
 * The ORFs tab: its table, sizes, picking and adding, the ORF in focus, and
 * the finder slot it shares with Motifs.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import OrfTab from './OrfTab'
import FeatureSidebar from '../FeatureSidebar'
import { useEditorStore } from '../../store'
import type { ORFResult } from '../../workers/orf-finder'
import { AnnotationTooltipContent } from '../AnnotationTooltip'
import { Annotation } from '../../models/Annotation'
import { orfOverlayData } from '../../utils/orf-features'
import { saveText } from '../../utils/download'

vi.mock('../../utils/download', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/download')>()),
  saveText: vi.fn(),
}))

const store = () => useEditorStore.getState()

// 'CC' + ATG, ten GCC, TAA + 'CC': one ORF of 11 residues on the forward strand.
const BASES = 'CC' + 'ATG' + 'GCC'.repeat(10) + 'TAA' + 'CC'
const LONG: ORFResult = { start: 2, end: 38, strand: 1, frame: 2, codons: 12 }
const SHORT: ORFResult = { start: 20, end: 29, strand: -1, frame: 0, codons: 3 }

const rows = () => [...document.querySelectorAll<HTMLElement>('.fd-row')]
const frames = () => rows().map(r => r.querySelector('.fd-name')?.textContent)

async function settle(ms = 10) {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })
}

describe('ORFs tab', () => {
  beforeEach(() => {
    store().loadDocument('orfs', BASES, 'linear')
    store().setOrfParams({
      orfMinAminoAcids: 100, orfStartCodons: ['ATG'], orfStartsFromCode: false,
      orfAllowInterior: true, orfIncludePartial: false, orfAllStarts: false,
    })
    store().setOrfRange(null)
    store().setTranslationCode(1)
    vi.mocked(saveText).mockClear()
    act(() => { store().setOrfResults([SHORT, LONG]) })
    store().clearOrfPicks()
    if (store().showOrfs) store().toggleOrfs()
  })

  it('lists the ORFs longest first, with their frame, place and size in residues', () => {
    render(<OrfTab />)
    expect(frames()).toEqual(['+3', '−1'])
    expect(rows()[0].textContent).toContain('3..38')
    expect(rows()[0].textContent).toContain('11 aa')
    expect(rows()[0].textContent).toContain('ATG')
    // Pressed again, a column sorts the other way: shortest first.
    fireEvent.click(screen.getByRole('button', { name: /Sort by length/ }))
    expect(frames()).toEqual(['−1', '+3'])
    fireEvent.click(screen.getByRole('button', { name: /Sort by location/ }))
    expect(frames()).toEqual(['+3', '−1'])
    // Frames in reading order: +1 to +3, then −1 to −3.
    fireEvent.click(screen.getByRole('button', { name: /Sort by frame/ }))
    expect(frames()).toEqual(['+3', '−1'])
  })

  it('shows the ORF clicked, with its protein, and adds it as a CDS', () => {
    render(<OrfTab />)
    fireEvent.click(rows()[0])
    expect(store().selection).toMatchObject({ anchor: 2, caret: 38 })
    const inspector = document.querySelector('.fdi') as HTMLElement
    expect(within(inspector).getByText('ORF +3')).toBeTruthy()
    expect(inspector.querySelector('.fdi-seq')?.textContent).toBe('MAAAAAAAAAA')
    expect(within(inspector).getByText('TAA')).toBeTruthy()
    fireEvent.click(within(inspector).getByRole('button', { name: /Add as CDS/ }))
    expect(store().doc.annotations.map(a => a.name)).toEqual(['ORF +3 (11 aa)'])
    expect(within(document.querySelector('.fdi') as HTMLElement).getByText(/A CDS already covers/)).toBeTruthy()
  })

  it('picks with the box or Ctrl-click, and adds only the picked', () => {
    render(<OrfTab />)
    fireEvent.click(rows()[1].querySelector('.fd-pick')!)
    expect(store().orfPicks.size).toBe(1)
    fireEvent.click(rows()[0], { ctrlKey: true })
    expect(store().orfPicks.size).toBe(2)
    fireEvent.click(rows()[0], { ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Add picked (1)' }))
    expect(store().doc.annotations).toHaveLength(1)
    expect(store().doc.annotations[0].strand).toBe(-1)
  })

  it('marks an ORF that is already a CDS, and does not let it be picked', () => {
    act(() => { store().addAnnotation({ id: 'cds', name: 'gene', type: 'CDS', start: 2, end: 38, strand: 1 }) })
    render(<OrfTab />)
    const row = rows()[0]
    expect(row.classList.contains('is-added')).toBe(true)
    expect((row.querySelector('.fd-pick') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('1 already CDS')).toBeTruthy()
    // Neither the box nor Ctrl-click picks it, so Add never ignores a pick.
    fireEvent.click(row, { ctrlKey: true })
    expect(store().orfPicks.size).toBe(0)
    expect(screen.getByRole('button', { name: 'Add all (1)' })).toBeTruthy()
    fireEvent.click(rows()[1].querySelector('.fd-pick')!)
    expect(screen.getByRole('button', { name: 'Add picked (1)' })).toBeTruthy()
  })

  it('moves through the rows with the arrow keys and picks with Space', () => {
    render(<OrfTab />)
    const list = screen.getByRole('listbox', { name: 'ORFs' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(rows()[0].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(rows()[1].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(list, { key: ' ' })
    expect(store().orfPicks.size).toBe(1)
  })

  it('takes the minimum size in residues, from a preset or once typing pauses', async () => {
    render(<OrfTab />)
    fireEvent.click(screen.getByRole('button', { name: '50' }))
    expect(store().orfMinAminoAcids).toBe(50)
    const box = screen.getByLabelText('Minimum size') as HTMLInputElement
    fireEvent.change(box, { target: { value: '' } })
    expect(box.value).toBe('')
    fireEvent.change(box, { target: { value: '75' } })
    expect(store().orfMinAminoAcids).toBe(50)
    await settle(450)
    expect(store().orfMinAminoAcids).toBe(75)
    expect(screen.getByText(/225 bp and up/)).toBeTruthy()
  })

  it('switches the overlay from Show on the sequence', () => {
    render(<OrfTab />)
    fireEvent.click(screen.getByLabelText('Show on the sequence'))
    expect(store().showOrfs).toBe(true)
  })

  it('asks before adding a great many ORFs', () => {
    const many = Array.from({ length: 60 }, (_, i): ORFResult => ({ start: i * 3, end: i * 3 + 300, strand: 1, frame: 0, codons: 100 }))
    store().loadDocument('many', 'ACGT'.repeat(200), 'linear')
    act(() => { store().setOrfResults(many) })
    render(<OrfTab />)
    fireEvent.click(screen.getByRole('button', { name: 'Add all (60)' }))
    expect(store().doc.annotations).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Add 60' }))
    expect(store().doc.annotations).toHaveLength(60)
  })
})

describe('ORFs tab: starts, range and export', () => {
  beforeEach(() => {
    store().loadDocument('orfs', BASES, 'linear')
    store().setOrfParams({ orfStartCodons: ['ATG'], orfStartsFromCode: false, orfAllStarts: false, orfIncludePartial: false })
    store().setOrfRange(null)
    store().setTranslationCode(1)
    act(() => { store().setOrfResults([SHORT, LONG]) })
    store().clearOrfPicks()
    vi.mocked(saveText).mockClear()
  })

  it("takes the start codons from the genetic code, or offers the code's own to choose from", () => {
    render(<OrfTab />)
    fireEvent.click(screen.getByRole('button', { name: 'From the genetic code' }))
    expect(store().orfStartsFromCode).toBe(true)
    expect(screen.getByText('ATG, TTG, CTG')).toBeTruthy()
    expect(screen.queryByLabelText('GTG')).toBeNull()
    act(() => { store().setTranslationCode(2) })
    expect(screen.getByText('ATT, ATC, ATA, ATG, GTG')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Chosen' }))
    // The usual four, then the code's others.
    expect(screen.getByLabelText('CTG')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('ATA'))
    expect(store().orfStartCodons).toEqual(['ATG', 'ATA'])
  })

  it('lists an ORF from every start when asked', () => {
    render(<OrfTab />)
    fireEvent.click(screen.getByLabelText('Every start codon'))
    expect(store().orfAllStarts).toBe(true)
  })

  it('searches a selection taken when asked, and keeps it while rows are clicked', () => {
    render(<OrfTab />)
    const selectionBtn = screen.getByRole('button', { name: 'Selection' }) as HTMLButtonElement
    expect(selectionBtn.disabled).toBe(true)
    act(() => { store().setSelection({ anchor: 0, caret: 30 }) })
    fireEvent.click(selectionBtn)
    expect(store().orfRange).toEqual({ tabId: store().activeTabId, start: 0, end: 30 })
    expect(screen.getByText(/1\.\.30, 30 bp/)).toBeTruthy()
    // Clicking a row selects its ORF; the range searched stays as it was.
    fireEvent.click(rows()[0])
    expect(store().orfRange).toMatchObject({ start: 0, end: 30 })
    fireEvent.click(screen.getByRole('button', { name: 'Use the selection now' }))
    expect(store().orfRange).toMatchObject({ start: 2, end: 38 })
    fireEvent.click(screen.getByRole('button', { name: 'Whole sequence' }))
    expect(store().orfRange).toBeNull()
  })

  it('allows partial ORFs on a circle only while a selection of it is searched', () => {
    store().loadDocument('ring', BASES, 'circular')
    render(<OrfTab />)
    expect((screen.getByLabelText('Include partial ORFs') as HTMLInputElement).disabled).toBe(true)
    act(() => {
      store().setSelection({ anchor: 0, caret: 30 })
      store().setOrfRange({ tabId: store().activeTabId!, start: 0, end: 30 })
    })
    expect((screen.getByLabelText('Include partial ORFs') as HTMLInputElement).disabled).toBe(false)
  })

  it('exports the picked ORFs, or all of them, as FASTA or CSV', () => {
    render(<OrfTab />)
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Proteins \(FASTA\)/ }))
    const [fasta, name] = vi.mocked(saveText).mock.calls[0]
    expect(name).toBe('orfs_orfs_protein.fasta')
    expect(fasta.match(/^>/gm)).toHaveLength(2)
    expect(fasta).toContain('>orfs_ORF1 frame +3 3..38 11 aa\nMAAAAAAAAAA\n')

    fireEvent.click(rows()[1].querySelector('.fd-pick')!)
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Table \(CSV\)/ }))
    const [csv, csvName] = vi.mocked(saveText).mock.calls[1]
    expect(csvName).toBe('orfs_orfs.csv')
    expect(csv.trim().split('\n')).toHaveLength(2)
    expect(csv).toContain('ORF1,-1,-,21,29')
  })
})

describe('the ORF hover card', () => {
  it('says what the ORFs tab says about it, and whether it is picked', () => {
    store().loadDocument('orfs', BASES, 'linear')
    act(() => { store().setOrfResults([LONG]) })
    store().clearOrfPicks()
    const ann = new Annotation(orfOverlayData(LONG))
    render(<AnnotationTooltipContent ann={ann} sequence={store().doc.sequence} />)
    expect(screen.getByText('ORF +3')).toBeTruthy()
    expect(screen.getByText('3..38')).toBeTruthy()
    expect(screen.getByText('Forward, frame +3')).toBeTruthy()
    expect(screen.getByText('TAA')).toBeTruthy()
    expect(screen.getByText('MAAAAAAAAAA')).toBeTruthy()
    expect(screen.getByText(/kDa|Da/)).toBeTruthy()
    expect(screen.getByText(/Ctrl\+click to pick/)).toBeTruthy()
    act(() => { store().toggleOrfPick('1:2:2:38') })
    expect(screen.getByText(/Picked for Add/)).toBeTruthy()
  })
})

describe('the finder slot', () => {
  it('shows ORFs on DNA and Motifs on a protein, whichever was asked for', () => {
    store().loadDocument('dna', BASES, 'linear')
    store().setSidebarTab('motifs')
    const { unmount } = render(<FeatureSidebar open onClose={() => {}} />)
    expect(screen.getByRole('tab', { name: /ORFs/ }).getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('.fd-orfs')).toBeTruthy()
    unmount()

    store().openDocument('prot', 'MKNGTAAAANLSGAAAA', 'linear', undefined, undefined, 'protein')
    store().setSidebarTab('orfs')
    render(<FeatureSidebar open onClose={() => {}} />)
    expect(screen.getByRole('tab', { name: /Motifs/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('tab', { name: /ORFs/ })).toBeNull()
  })
})
