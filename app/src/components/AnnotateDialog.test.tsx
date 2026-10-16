/**
 * The Annotate panel's list: one row per locus, relatives behind "N similar",
 * a box that picks everything shown, and rejection that the document keeps.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import AnnotateDialog from './AnnotateDialog'
import { useEditorStore } from '../store'
import { matchKey } from '../utils/auto-annotations'
import type { AnnotationMatch } from '../workers/annotate-list'

const store = () => useEditorStore.getState()

const match = (over: Partial<AnnotationMatch>): AnnotationMatch => ({
  refName: 'x', refType: 'CDS', start: 0, end: 60, strand: 1, similarity: 98, ...over,
})
const EGFP = match({ refName: 'EGFP', similarity: 98.8 })
const ECFP = match({ refName: 'ECFP', similarity: 98.9 })
const EYFP = match({ refName: 'EYFP', similarity: 98.6 })
const KAN = match({ refName: 'kanR', start: 70, end: 110 })
const ORI1 = match({ refName: 'ori', refType: 'rep_origin', start: 120, end: 160 })
const ORI2 = match({ refName: 'ori', refType: 'rep_origin', start: 180, end: 220, strand: -1 })

describe('AnnotateDialog suggestions', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pList', 'ATGC'.repeat(60))
    store().setAutoAnnotations([EGFP, ECFP, EYFP, KAN, ORI1, ORI2])
    store().clearAutoAnnotationPicks()
  })

  const open = () => render(<AnnotateDialog open onClose={() => {}} />)

  it('counts loci, not matches: three proteins on one gene are one suggestion', () => {
    open()
    expect(screen.getByText(/^4 suggestions/)).toBeTruthy()
    // The best relative is offered, the others are behind "2 similar".
    expect(screen.getByText('ECFP')).toBeTruthy()
    expect(screen.queryByText('EGFP')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /2 similar/ }))
    const alts = screen.getByRole('list', { name: /Elements that match at 1\.\.60/ })
    expect(within(alts).getByText('EGFP')).toBeTruthy()
    expect(within(alts).getByText('EYFP')).toBeTruthy()
  })

  it('picks a relative instead of the best, and the row then offers it', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: /2 similar/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pick EGFP here' }))
    expect([...store().autoAnnotationPicks]).toEqual([matchKey(EGFP)])
    expect(screen.getByRole('checkbox', { name: 'Pick EGFP at 1..60' })).toBeTruthy()
  })

  it('shows an element found once as one line, and one found twice as a group', () => {
    open()
    expect(screen.getByRole('checkbox', { name: 'Pick kanR at 71..110' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Pick all 2 copies of ori' })).toBeTruthy()
  })

  it('does not group two elements that only share a name', () => {
    const promoter = match({ refName: 'SV40', refType: 'promoter', start: 300, end: 500 })
    const origin = match({ refName: 'SV40', refType: 'rep_origin', start: 350, end: 480 })
    store().setAutoAnnotations([promoter, origin])
    open()
    expect(screen.queryByRole('checkbox', { name: /copies of SV40/ })).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Pick SV40 at 301..500' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Pick SV40 at 351..480' })).toBeTruthy()
    expect(screen.getByText('promoter')).toBeTruthy()
    expect(screen.getByText('rep_origin')).toBeTruthy()
  })

  it('picks every suggestion shown from the header, one per locus, and unpicks them again', () => {
    open()
    const all = screen.getByRole('checkbox', { name: 'Pick every suggestion shown' })
    fireEvent.click(all)
    expect(new Set(store().autoAnnotationPicks)).toEqual(new Set([ECFP, KAN, ORI1, ORI2].map(matchKey)))
    expect(screen.getByRole('button', { name: 'Add picked (4)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Unpick every suggestion shown' }))
    expect(store().autoAnnotationPicks.size).toBe(0)
  })

  it('picks only what the filter leaves', () => {
    open()
    fireEvent.change(screen.getByPlaceholderText('Filter results…'), { target: { value: 'kan' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pick every suggestion shown' }))
    expect([...store().autoAnnotationPicks]).toEqual([matchKey(KAN)])
  })

  it('finds a locus by a relative behind it, and opens it', () => {
    open()
    fireEvent.change(screen.getByPlaceholderText('Filter results…'), { target: { value: 'egfp' } })
    expect(screen.getByText(/^1 suggestion\b/)).toBeTruthy()
    expect(screen.getByRole('list', { name: /Elements that match/ })).toBeTruthy()
  })

  it('rejects an element, offers the next relative, and keeps the rejection with the document', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: "Don't suggest ECFP in this document" }))
    expect(store().doc.metadata?.rejectedSuggestions).toEqual([{ name: 'ECFP', type: 'CDS' }])
    expect(screen.getByText('EGFP')).toBeTruthy()
    expect(screen.getByText(/Not suggested in this document: 1/)).toBeTruthy()
  })

  it('rejects everything picked at once', () => {
    open()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pick kanR at 71..110' }))
    fireEvent.click(screen.getByRole('button', { name: /Reject \(1\)/ }))
    expect(store().doc.metadata?.rejectedSuggestions).toEqual([{ name: 'kanR', type: 'CDS' }])
    expect(screen.queryByRole('checkbox', { name: 'Pick kanR at 71..110' })).toBeNull()
  })

  it('brings a rejected element back from the list below', () => {
    store().rejectSuggestions([{ name: 'kanR', type: 'CDS' }])
    open()
    expect(screen.queryByRole('checkbox', { name: 'Pick kanR at 71..110' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest kanR again' }))
    expect(store().doc.metadata?.rejectedSuggestions).toBeUndefined()
    expect(screen.getByRole('checkbox', { name: 'Pick kanR at 71..110' })).toBeTruthy()
  })
})
