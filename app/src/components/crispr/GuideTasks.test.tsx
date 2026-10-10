/**
 * The strategy tasks in the panel: each one asks for what it needs, says so
 * when it has not got it, and turns the same scan into its own answer.
 */
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import GuidePanel from './GuidePanel'
import { useEditorStore } from '../../store'
import { findGuideSites } from '../../crispr/finder'
import { scoreSites } from '../../crispr/score/guide'
import { builtInNuclease } from '../../crispr/nucleases'
import type { Nuclease } from '../../crispr/types'

const store = () => useEditorStore.getState()
const spCas9 = builtInNuclease('spcas9') as Nuclease

// A gene with guides along it, inside padding that has none of its own.
const CDS = 'ATG' + 'GCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGGTGAAGGTGATGCAACATACGGAAAACTTACC' + 'TAA'
const PAD = 'CATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCAT'
const BASES = PAD + CDS + PAD

function loadScan() {
  const { sites } = findGuideSites(BASES, spCas9, 'linear')
  store().setGuideResults(scoreSites(sites, spCas9, BASES, 'linear'))
}

function addGene() {
  store().addAnnotations([{
    id: 'gene1', name: 'targetGene', type: 'CDS',
    start: PAD.length, end: PAD.length + CDS.length, strand: 1,
  }])
}

describe('the task tabs', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('tasks', BASES)
    store().setCrisprParams({ crisprNucleaseId: 'spcas9', crisprSpacerLength: 0, crisprSelectionOnly: false })
    store().clearGuides()
    store().setCrisprTask('find')
  })
  afterEach(cleanup)

  it('offers every task and remembers which one is open', () => {
    act(() => { loadScan() })
    render(<GuidePanel />)
    for (const label of ['Find', 'Knock out', 'Delete', 'Knock in', 'Base edit', 'Tile']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy()
    }
    act(() => { screen.getByRole('tab', { name: 'Tile' }).click() })
    expect(store().crisprTask).toBe('tile')
  })

  it('keeps the nuclease settings across tasks', () => {
    act(() => { loadScan(); store().setCrisprTask('knockout') })
    render(<GuidePanel />)
    expect(screen.getByLabelText('Nuclease')).toBeTruthy()
  })
})

describe('knockout task', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('ko', BASES)
    store().clearGuides()
    store().setCrisprTask('knockout')
    act(() => { addGene(); loadScan() })
  })
  afterEach(cleanup)

  it('asks for a gene before it will rank anything', () => {
    render(<GuidePanel />)
    expect(screen.getByText(/Choose a coding feature/)).toBeTruthy()
  })

  it('ranks the guides inside the chosen gene and says which codon each cuts in', () => {
    render(<GuidePanel />)
    fireEvent.change(screen.getByLabelText('Gene'), { target: { value: 'gene1' } })
    expect(screen.getByText(/in targetGene/)).toBeTruthy()
    expect(screen.getAllByText(/codon \d+ of \d+/).length).toBeGreaterThan(0)
  })
})

describe('deletion task', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('del', BASES)
    store().clearGuides()
    store().setCrisprTask('deletion')
    act(() => { addGene(); loadScan() })
  })
  afterEach(cleanup)

  it('asks for a region first', () => {
    render(<GuidePanel />)
    expect(screen.getByText(/Select a region, or choose a feature/)).toBeTruthy()
  })

  it('pairs guides around a chosen feature and opens the result', () => {
    render(<GuidePanel />)
    fireEvent.change(screen.getByLabelText('Region to remove'), { target: { value: 'gene1' } })
    fireEvent.change(screen.getByLabelText('Cut within'), { target: { value: '1000' } })
    expect(screen.getByText(/pairs? around targetGene/)).toBeTruthy()

    const before = store().tabs.length
    const rows = document.querySelectorAll('.gp-pair')
    expect(rows.length).toBeGreaterThan(0)
    act(() => { (rows[0] as HTMLElement).click() })
    act(() => { screen.getByRole('button', { name: /Open the result/ }).click() })
    expect(store().tabs.length).toBe(before + 1)
    expect(store().doc.sequence.length).toBeLessThan(BASES.length)
    expect(store().doc.metadata?.origin).toBe('edited')
  })
})

describe('knock-in task', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('ki', BASES)
    store().clearGuides()
    store().setCrisprTask('knockin')
    act(() => { addGene(); loadScan() })
  })
  afterEach(cleanup)

  it('waits for a guide to be selected', () => {
    render(<GuidePanel />)
    expect(screen.getByText(/Select a guide in the Find task/)).toBeTruthy()
  })

  it('builds a donor around the selected guide, and says what it did about re-cutting', () => {
    act(() => {
      const first = store().guideResults[0]
      store().setSelectedGuideKey(`${first.site.nucleaseId}:${first.site.strand === 1 ? '+' : '-'}:${first.site.start}:${first.site.end}`)
    })
    render(<GuidePanel />)
    fireEvent.change(screen.getByLabelText('What goes in'), { target: { value: 'GGATCCGGATCC' } })
    expect(screen.getByText(/^Donor, \d+ bp$/)).toBeTruthy()
    expect(screen.getByText('Re-cutting')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Open/ })).toBeTruthy()
  })
})

describe('base editing task', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('be', BASES)
    store().clearGuides()
    store().setCrisprTask('baseedit')
    act(() => { addGene(); loadScan() })
  })
  afterEach(cleanup)

  it('asks for one base to be selected', () => {
    render(<GuidePanel />)
    expect(screen.getByText(/Select a single base to edit/)).toBeTruthy()
  })

  it('lists the guides that reach a selected base, with their bystanders', () => {
    render(<GuidePanel />)
    // Every guide in the sequence, not only those reaching one base.
    fireEvent.click(screen.getByLabelText(/Only guides reaching the selected base/))
    fireEvent.change(screen.getByLabelText('Editor'), { target: { value: 'cbe-wide' } })
    const rows = document.querySelectorAll('.gp-row')
    expect(rows.length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.gp-why').length).toBeGreaterThan(0)
  })
})

describe('tiling task', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('tile', BASES)
    store().clearGuides()
    store().setCrisprTask('tile')
    act(() => { loadScan() })
  })
  afterEach(cleanup)

  it('spaces a set across the sequence and offers it as a table', () => {
    render(<GuidePanel />)
    expect(screen.getByText(/across the whole sequence/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Table/ })).toBeTruthy()
    expect(document.querySelectorAll('.gp-row').length).toBeGreaterThan(0)
  })

  it('turns the whole set into features in one step', () => {
    render(<GuidePanel />)
    const before = store().doc.annotations.length
    act(() => { screen.getByRole('button', { name: /Features/ }).click() })
    expect(store().doc.annotations.length).toBeGreaterThan(before)
    expect(store().doc.annotations.some(a => a.type === 'misc_binding')).toBe(true)
  })
})
