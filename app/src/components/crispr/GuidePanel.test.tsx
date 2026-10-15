/**
 * The Guides tab: the scan reaches the list, a row selects its protospacer,
 * picking converts to features, and a nuclease with no activity model shows
 * no score rather than a borrowed one.
 *
 * The panel does not run the scan itself (App drives it through
 * useGuideScan), so these tests put candidates in the store the way a scan
 * would and check what the panel does with them.
 */
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import GuidePanel from './GuidePanel'
import { useEditorStore } from '../../store'
import { findGuideSites } from '../../crispr/finder'
import { scoreSites } from '../../crispr/score/guide'
import { builtInNuclease } from '../../crispr/nucleases'
import { guideKey } from '../../utils/guide-features'
import type { Nuclease } from '../../crispr/types'

const store = () => useEditorStore.getState()
const spCas9 = builtInNuclease('spcas9') as Nuclease

// One clean SpCas9 site: filler with no GG, a 20-mer, then AGG.
const BASES = 'CATCATCATC' + 'ACGTACGTACGTACGTACGT' + 'AGG' + 'CATCATCATCATCATCATCATCATCATCATCATCAT'

function scan(nuclease: Nuclease = spCas9) {
  const { sites } = findGuideSites(BASES, nuclease, 'linear')
  return scoreSites(sites, nuclease, BASES, 'linear')
}

describe('GuidePanel', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('guides', BASES)
    store().setCrisprParams({ crisprNucleaseId: 'spcas9', crisprSpacerLength: 0 })
    store().setCrisprRange(null)
    store().clearGuides()
  })
  afterEach(cleanup)

  it('lists what the scan found, with the spacer and the PAM', () => {
    act(() => { store().setGuideResults(scan()) })
    render(<GuidePanel />)
    expect(screen.getByText('1 site')).toBeTruthy()
    expect(screen.getByText('ACGTACGTACGTACGTACGT')).toBeTruthy()
    expect(screen.getByText('AGG')).toBeTruthy()
  })

  it('selects the protospacer when a row is clicked', () => {
    act(() => { store().setGuideResults(scan()) })
    render(<GuidePanel />)
    act(() => { fireEvent.click(screen.getByText('ACGTACGTACGTACGTACGT')) })
    expect(store().selection).toEqual({ anchor: 10, caret: 30 })
    expect(store().selectedGuideKey).toBe('spcas9:+:10:30')
  })

  it('takes the selection when Selection only is ticked, and keeps it while a guide is clicked', () => {
    act(() => { store().setGuideResults(scan()) })
    render(<GuidePanel />)
    const box = screen.getByLabelText('Selection only') as HTMLInputElement
    expect(box.disabled).toBe(true)
    act(() => { store().setSelection({ anchor: 0, caret: 50 }) })
    fireEvent.click(box)
    expect(store().crisprRange).toEqual({ tabId: store().activeTabId, start: 0, end: 50 })
    expect(screen.getByText(/Searching 1\.\.50, 50 bp/)).toBeTruthy()
    // Clicking the guide selects its protospacer; the range searched stays.
    act(() => { fireEvent.click(screen.getByText('ACGTACGTACGTACGTACGT')) })
    expect(store().selection).toEqual({ anchor: 10, caret: 30 })
    expect(store().crisprRange).toMatchObject({ start: 0, end: 50 })
    fireEvent.click(screen.getByRole('button', { name: 'Use the selection now' }))
    expect(store().crisprRange).toMatchObject({ start: 10, end: 30 })
    fireEvent.click(screen.getByLabelText('Selection only'))
    expect(store().crisprRange).toBeNull()
  })

  it('shows the inspector for the selected guide, with its cut', () => {
    const candidates = scan()
    act(() => {
      store().setGuideResults(candidates)
      store().setSelectedGuideKey(guideKey(candidates[0].site))
    })
    render(<GuidePanel />)
    expect(screen.getByText('SpCas9 11+')).toBeTruthy()
    expect(screen.getByText(/blunt, after 27/)).toBeTruthy()
  })

  it('adds every guide as a feature, and will not add the same one twice', () => {
    act(() => { store().setGuideResults(scan()) })
    render(<GuidePanel />)
    act(() => { screen.getByRole('button', { name: /Add all/ }).click() })
    const added = store().doc.annotations.filter(a => a.name === 'SpCas9 11+')
    expect(added).toHaveLength(1)
    expect(added[0].type).toBe('misc_binding')
    expect(added[0].start).toBe(10)
    expect(added[0].end).toBe(30)
    // The button is gone once there is nothing left to convert.
    expect(screen.queryByRole('button', { name: /Add all/ })).toBeNull()
  })

  it('adds only the picked guides when there are picks', () => {
    const candidates = scan()
    act(() => {
      store().setGuideResults(candidates)
      store().toggleGuidePick(guideKey(candidates[0].site))
    })
    render(<GuidePanel />)
    expect(screen.getByText('1 picked')).toBeTruthy()
    act(() => { screen.getByRole('button', { name: /Add picked \(1\)/ }).click() })
    expect(store().doc.annotations.filter(a => a.type === 'misc_binding')).toHaveLength(1)
    expect(store().guidePicks.size).toBe(0)
  })

  it('reports no score for a nuclease with no model, and says why', () => {
    const saCas9 = builtInNuclease('sacas9') as Nuclease
    act(() => {
      store().setCrisprParams({ crisprNucleaseId: 'sacas9' })
      const candidates = scoreSites(
        findGuideSites('CATCAT' + 'ACGTACGTACGTACGTACGTA' + 'AAGAAT' + 'CATCATCATCAT', saCas9, 'linear').sites,
        saCas9,
        'CATCAT' + 'ACGTACGTACGTACGTACGTA' + 'AAGAAT' + 'CATCATCATCAT',
        'linear',
      )
      store().setGuideResults(candidates)
      if (candidates.length > 0) store().setSelectedGuideKey(guideKey(candidates[0].site))
    })
    render(<GuidePanel />)
    expect(screen.getByText(/No activity model is fitted for this nuclease/)).toBeTruthy()
  })

  it('says so when the scan found nothing', () => {
    render(<GuidePanel />)
    expect(screen.getByText(/No site for this nuclease in this sequence/)).toBeTruthy()
  })

  it('offers no guides for a protein', () => {
    act(() => { store().openDocument('a protein', 'MKVLAAGIVGLNLGGK', 'linear', undefined, 'new', 'protein') })
    render(<GuidePanel />)
    expect(screen.getByText(/A protein has no PAM to find/)).toBeTruthy()
  })
})

describe('GuidePanel off-targets', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('guides', BASES)
    store().setCrisprParams({ crisprNucleaseId: 'spcas9', crisprSpacerLength: 0 })
    store().setCrisprRange(null)
    store().clearGuides()
    store().setOffTargetParams({ offTargetScope: 'document' })
  })
  afterEach(cleanup)

  it('keeps the search folded away until it is wanted', () => {
    act(() => { store().setGuideResults(scan()) })
    render(<GuidePanel />)
    // The section is there, collapsed, so the candidate list keeps the room.
    expect(screen.getByText('Off-targets')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Check off-targets/ })).toBeNull()
    act(() => { screen.getByText('Off-targets').click() })
    // Nothing is selected yet, so the button has nothing to check.
    expect((screen.getByRole('button', { name: /Check off-targets/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('searches the selected guide and shows what it found', async () => {
    const candidates = scan()
    act(() => {
      store().setGuideResults(candidates)
      store().setSelectedGuideKey(guideKey(candidates[0].site))
    })
    render(<GuidePanel />)
    await act(async () => { screen.getByRole('button', { name: /Check off-targets/ }).click() })
    await waitFor(() => expect(Object.keys(store().offTargetReports)).toHaveLength(1))

    const report = store().offTargetReports[guideKey(candidates[0].site)]
    // Its own site is excluded, and this short sequence holds nothing else.
    expect(report.onTargetSites).toBe(1)
    expect(report.hits).toHaveLength(0)
    expect(report.specificity).toBe(100)
    expect(screen.getByText(/Searched guides/)).toBeTruthy()
    expect(screen.getByText(/Nothing else this guide could bind/)).toBeTruthy()
  })

  it('puts the specificity on the row once it is known', async () => {
    const candidates = scan()
    act(() => {
      store().setGuideResults(candidates)
      store().setSelectedGuideKey(guideKey(candidates[0].site))
    })
    render(<GuidePanel />)
    await act(async () => { screen.getByRole('button', { name: /Check off-targets/ }).click() })
    await waitFor(() => expect(screen.getByText('S 100')).toBeTruthy())
  })

  it('finds a near match elsewhere in the sequence and marks the mismatches', async () => {
    // A second copy of the spacer with two changed bases, and its own PAM.
    const near = 'ACGTTCGTACGTACGTTCGT'
    const withNear = BASES + 'CATCATCATC' + near + 'TGG' + 'CATCATCATC'
    act(() => {
      for (const tab of store().tabs) store().closeTab(tab.id)
      store().openDocument('near', withNear)
      store().clearGuides()
      const { sites } = findGuideSites(withNear, spCas9, 'linear')
      const scored = scoreSites(sites, spCas9, withNear, 'linear')
      store().setGuideResults(scored)
      const target = scored.find(c => c.site.spacer === 'ACGTACGTACGTACGTACGT')
      if (target) store().setSelectedGuideKey(guideKey(target.site))
    })
    render(<GuidePanel />)
    await act(async () => { screen.getByRole('button', { name: /Check off-targets/ }).click() })
    await waitFor(() => expect(Object.keys(store().offTargetReports)).toHaveLength(1))
    const report = Object.values(store().offTargetReports)[0]
    expect(report.hits).toHaveLength(1)
    expect(report.hits[0].mismatches).toBe(2)
    expect(report.specificity).toBeLessThan(100)
    expect(report.specificity).toBeGreaterThan(80)
    // Both mismatches are shown as letters against dots for the matches.
    expect(screen.getAllByText(/^[ACGT]$/).length).toBeGreaterThanOrEqual(2)
  })

  it('will not search a file scope with no file loaded', () => {
    const candidates = scan()
    act(() => {
      store().setGuideResults(candidates)
      store().setSelectedGuideKey(guideKey(candidates[0].site))
      store().setOffTargetParams({ offTargetScope: 'file' })
    })
    render(<GuidePanel />)
    act(() => { screen.getByText('Off-targets').click() })
    expect(screen.getAllByRole('button', { name: /Check off-targets/ })
      .every(b => (b as HTMLButtonElement).disabled)).toBe(true)
    expect(screen.getByRole('button', { name: /Load FASTA/ })).toBeTruthy()
  })

  it('forgets a report when the scan no longer finds its guide', () => {
    const candidates = scan()
    const key = guideKey(candidates[0].site)
    act(() => {
      store().setGuideResults(candidates)
      store().setOffTargetReports({
        [key]: {
          spacer: candidates[0].site.spacer, nucleaseId: 'spcas9', hits: [], specificity: 100,
          searched: [], onTargetSites: 1, truncated: false,
          settings: { maxMismatches: 3, bulges: false, alternativePams: false, maxHits: 1000 },
        },
      })
    })
    expect(Object.keys(store().offTargetReports)).toHaveLength(1)
    act(() => { store().setGuideResults([]) })
    expect(Object.keys(store().offTargetReports)).toHaveLength(0)
  })
})
