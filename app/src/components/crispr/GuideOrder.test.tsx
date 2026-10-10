/**
 * Ordering, prime editing and the library: what the panel does once a guide
 * has been chosen.
 */
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import GuidePanel from './GuidePanel'
import { useEditorStore } from '../../store'
import { findGuideSites } from '../../crispr/finder'
import { scoreSites } from '../../crispr/score/guide'
import { builtInNuclease } from '../../crispr/nucleases'
import { guideKey } from '../../utils/guide-features'
import { scaffoldById } from '../../crispr/scaffolds'
import type { Nuclease } from '../../crispr/types'

const store = () => useEditorStore.getState()
const spCas9 = builtInNuclease('spcas9') as Nuclease
const PAD = 'CATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCAT'
const SPACER = 'ACGTACGTACGTACGTACGT'
const BASES = PAD + SPACER + 'AGG' + PAD

function loadScan(nuclease: Nuclease = spCas9) {
  const { sites } = findGuideSites(BASES, nuclease, 'linear')
  store().setGuideResults(scoreSites(sites, nuclease, BASES, 'linear'))
}

function selectTheGuide() {
  const found = store().guideResults.find(c => c.site.spacer === SPACER)
  if (found) store().setSelectedGuideKey(guideKey(found.site))
  return found
}

describe('the order task', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('order', BASES)
    store().clearGuides()
    store().setCrisprParams({ crisprNucleaseId: 'spcas9', crisprSpacerLength: 0, crisprSelectionOnly: false })
    store().setOrderParams({ crisprOrderFormat: 'annealed', crisprVectorId: 'bbsi-cacc', crisprScaffoldId: null })
    store().removeGuides(store().guideLibrary.map(g => g.id))
    store().setCrisprTask('order')
    store().setCrisprView('design')
    act(() => { loadScan() })
  })
  afterEach(cleanup)

  it('waits for a guide', () => {
    render(<GuidePanel />)
    expect(screen.getByText(/Select a guide, or pick several/)).toBeTruthy()
  })

  it('shows the oligo pair with the vector overhangs and the added base marked', () => {
    act(() => { selectTheGuide() })
    render(<GuidePanel />)
    expect(screen.getByText(/1 guide, BbsI vector/)).toBeTruthy()
    // The spacer does not start with G, so one is added and said to be added.
    expect(screen.getByText(/A G was added/)).toBeTruthy()
    const seqs = [...document.querySelectorAll('.gp-oligo-seq')].map(e => e.textContent)
    expect(seqs[0]).toBe('CACCG' + SPACER)
    expect(seqs).toHaveLength(2)
  })

  it('switches format and drops the vector picker for a synthetic order', () => {
    act(() => { selectTheGuide() })
    render(<GuidePanel />)
    fireEvent.change(screen.getByLabelText('Order as'), { target: { value: 'synthetic' } })
    expect(screen.queryByLabelText('Vector')).toBeNull()
    expect(screen.getByLabelText('Scaffold')).toBeTruthy()
    const seq = document.querySelector('.gp-oligo-seq')?.textContent ?? ''
    expect(seq.startsWith('ACGUACGU')).toBe(true)
    expect(seq).toContain(scaffoldById('spcas9-sgrna')!.sequence.replace(/T/g, 'U'))
  })

  it('keeps the chosen guide in the library', () => {
    act(() => { selectTheGuide() })
    render(<GuidePanel />)
    expect(store().guideLibrary).toHaveLength(0)
    act(() => { screen.getByRole('button', { name: /Keep/ }).click() })
    expect(store().guideLibrary).toHaveLength(1)
    expect(store().guideLibrary[0].spacer).toBe(SPACER)
    expect(store().guideLibrary[0].origin?.documentName).toBe('order')
  })

  it('orders every picked guide at once', () => {
    // A stretch with several sites, so there is more than one to pick.
    const many = PAD + SPACER + 'AGG' + 'CCTTGGCCTTGGCCTTGGCC' + 'TGG' + 'AACCTTAACCTTAACCTTAA' + 'CGG' + PAD
    act(() => {
      for (const tab of store().tabs) store().closeTab(tab.id)
      store().openDocument('many', many)
      store().clearGuides()
      const { sites } = findGuideSites(many, spCas9, 'linear')
      store().setGuideResults(scoreSites(sites, spCas9, many, 'linear'))
      for (const candidate of store().guideResults.slice(0, 3)) {
        store().toggleGuidePick(guideKey(candidate.site))
      }
    })
    const picked = store().guidePicks.size
    expect(picked).toBeGreaterThan(1)
    render(<GuidePanel />)
    expect(screen.getByText(new RegExp(`${picked} guides, BbsI vector`))).toBeTruthy()
    expect(document.querySelectorAll('.gp-order')).toHaveLength(picked)
  })

  it('offers a screening plan for one guide', () => {
    act(() => { selectTheGuide() })
    render(<GuidePanel />)
    act(() => { screen.getByRole('button', { name: /How to screen it/ }).click() })
    expect(screen.getByText('Amplicon across the cut')).toBeTruthy()
    expect(screen.getByText(/Cut by an enzyme, uncut once edited/)).toBeTruthy()
  })
})

describe('the prime editing task', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('peg', BASES)
    store().clearGuides()
    store().setCrisprParams({ crisprNucleaseId: 'spcas9-d10a', crisprSpacerLength: 0 })
    store().setOrderParams({ crisprScaffoldId: null })
    store().setCrisprTask('primeedit')
    store().setCrisprView('design')
    act(() => { loadScan(builtInNuclease('spcas9-d10a') as Nuclease) })
  })
  afterEach(cleanup)

  it('asks for a guide and then for the bases to change', () => {
    render(<GuidePanel />)
    expect(screen.getByText(/Select a guide, in the Find task/)).toBeTruthy()
    cleanup()
    act(() => { selectTheGuide() })
    render(<GuidePanel />)
    expect(screen.getByText(/Select the bases to change/)).toBeTruthy()
  })

  it('builds a pegRNA from the selection and the replacement', () => {
    act(() => {
      selectTheGuide()
      // A base downstream of the nick, which sits three in from the PAM.
      store().setSelection({ anchor: PAD.length + 18, caret: PAD.length + 19 })
    })
    render(<GuidePanel />)
    fireEvent.change(screen.getByLabelText(/Replace/), { target: { value: 'A' } })
    expect(screen.getByText(/^pegRNA, \d+ nt$/)).toBeTruthy()
    // The tail is drawn in its pieces: the template, then the primer site.
    expect(document.querySelector('.gi-peg-pbs')?.textContent).toHaveLength(13)
    expect(document.querySelector('.gi-peg-spacer')?.textContent).toBe(SPACER)
    expect(document.querySelector('.gi-insert')?.textContent?.length).toBeGreaterThan(0)
  })

  it('says when the guide cannot write the edit', () => {
    act(() => {
      selectTheGuide()
      // Behind the nick, which the template never reaches.
      store().setSelection({ anchor: PAD.length + 2, caret: PAD.length + 3 })
    })
    render(<GuidePanel />)
    expect(screen.getByText(/the selection is\s+behind it/)).toBeTruthy()
  })
})

describe('the library view', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('lib', BASES)
    store().clearGuides()
    store().removeGuides(store().guideLibrary.map(g => g.id))
    for (const sc of store().customScaffolds) store().removeCustomScaffold(sc.id)
    store().setCrisprView('library')
    act(() => { loadScan() })
  })
  afterEach(cleanup)

  it('says when nothing is kept', () => {
    render(<GuidePanel />)
    expect(screen.getByText(/Nothing kept yet/)).toBeTruthy()
  })

  it('says which kept guides bind the open sequence', () => {
    act(() => {
      store().addGuides([
        { name: 'here', nucleaseId: 'spcas9', spacer: SPACER, pam: 'AGG' },
        { name: 'elsewhere', nucleaseId: 'spcas9', spacer: 'GGGGGGGGGGCCCCCCCCCC', pam: 'AGG' },
      ])
    })
    render(<GuidePanel />)
    expect(screen.getByText(/1 bind this sequence/)).toBeTruthy()
    expect(screen.getByText('not here')).toBeTruthy()
  })

  it('renames and forgets a guide', () => {
    act(() => { store().addGuides([{ name: 'g1', nucleaseId: 'spcas9', spacer: SPACER, pam: 'AGG' }]) })
    render(<GuidePanel />)
    fireEvent.change(screen.getByDisplayValue('g1'), { target: { value: 'renamed' } })
    expect(store().guideLibrary[0].name).toBe('renamed')
    act(() => { screen.getByTitle('Forget this guide').click() })
    expect(store().guideLibrary).toHaveLength(0)
  })

  it('keeps a scaffold pasted from a vector', () => {
    render(<GuidePanel />)
    act(() => { screen.getByRole('button', { name: /Add the scaffold/ }).click() })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'pMine' } })
    fireEvent.change(screen.getByLabelText('Sequence'), { target: { value: 'GTTTTAGAGCTAGAAATAGCAAG' } })
    act(() => { screen.getByRole('button', { name: 'Keep it' }).click() })
    expect(store().customScaffolds).toHaveLength(1)
    expect(store().customScaffolds[0].name).toBe('pMine')
    expect(store().customScaffolds[0].sequence).toBe('GTTTTAGAGCTAGAAATAGCAAG')
  })

  it('opens a scaffold to show the sequence, and shuts it again', () => {
    render(<GuidePanel />)
    const scaffold = scaffoldById('spcas9-sgrna')!
    expect(screen.queryByText(scaffold.sequence)).toBeNull()
    act(() => { screen.getByRole('button', { name: new RegExp(`^${scaffold.name}$`) }).click() })
    expect(screen.getByText(scaffold.sequence)).toBeTruthy()
    expect(screen.getByText(new RegExp(`${scaffold.sequence.length} nt, after the spacer`))).toBeTruthy()
    expect(screen.getByRole('button', { name: /Copy/ })).toBeTruthy()
    act(() => { screen.getByRole('button', { name: new RegExp(`^${scaffold.name}$`) }).click() })
    expect(screen.queryByText(scaffold.sequence)).toBeNull()
  })

  it('shows a scaffold you pasted in, and still lets you forget it', () => {
    render(<GuidePanel />)
    act(() => { screen.getByRole('button', { name: /Add the scaffold/ }).click() })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'pMine' } })
    fireEvent.change(screen.getByLabelText('Sequence'), { target: { value: 'GTTTTAGAGCTAGAAATAGCAAG' } })
    act(() => { screen.getByRole('button', { name: 'Keep it' }).click() })
    act(() => { screen.getByRole('button', { name: /^pMine$/ }).click() })
    expect(screen.getByText('GTTTTAGAGCTAGAAATAGCAAG')).toBeTruthy()
    act(() => { screen.getByTitle('Forget this scaffold').click() })
    expect(store().customScaffolds).toHaveLength(0)
  })

  it('goes back to the design view', () => {
    render(<GuidePanel />)
    act(() => { screen.getByRole('tab', { name: 'Design' }).click() })
    expect(store().crisprView).toBe('design')
  })
})
