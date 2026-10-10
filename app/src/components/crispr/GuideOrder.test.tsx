/**
 * Ordering, prime editing and the library: what the panel does once a guide
 * has been chosen.
 */
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react'
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

describe('the analyse task', () => {
  // One sample per base is unrealistic for a real trace, so these fixtures
  // space the peaks out the way the sequencer does.
  const SPACING = 12
  const CHANNELS = ['A', 'C', 'G', 'T'] as const
  function trace(name: string, bases: string, mix?: { cut: number; parts: { size: number; fraction: number }[] }) {
    const samples = bases.length * SPACING
    const traces = {
      A: new Array<number>(samples).fill(0),
      C: new Array<number>(samples).fill(0),
      G: new Array<number>(samples).fill(0),
      T: new Array<number>(samples).fill(0),
    }
    const peakLocations: number[] = []
    for (let i = 0; i < bases.length; i++) {
      const at = i * SPACING + SPACING / 2
      peakLocations.push(at)
      const add = (base: string, height: number) => {
        const ch = CHANNELS.find(c => c === base)
        if (!ch) return
        traces[ch][at] += height
        traces[ch][at - 1] += height * 0.6
        traces[ch][at + 1] += height * 0.6
      }
      if (!mix || i < mix.cut) add(bases[i], 1000)
      else for (const part of mix.parts) {
        const j = i + part.size
        if (j >= 0 && j < bases.length) add(bases[j], 1000 * part.fraction)
      }
    }
    return {
      name,
      bases,
      peakLocations,
      qualityScores: Array.from({ length: bases.length }, () => 40),
      traces,
      metadata: { averageSpacing: SPACING },
    } as never
  }

  const AMPLICON = (() => {
    let x = 99
    let out = ''
    while (out.length < 400) { x = (x * 1103515245 + 12345) >>> 0; out += 'ACGT'[(x >>> 16) % 4] }
    return out
  })()
  const CUT = 200

  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('amplicon', AMPLICON)
    store().clearGuides()
    store().setCrisprAnalysis(null)
    store().setCrisprTask('analyse')
    store().setCrisprView('design')
    store().setSelection({ anchor: CUT, caret: CUT })
  })
  afterEach(cleanup)

  it('asks for traces when there are none', () => {
    render(<GuidePanel />)
    expect(screen.getByText(/No chromatograms are open/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Analyse/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('takes an edited trace apart against its control', () => {
    act(() => {
      store().addSequencingReads([
        { data: trace('control', AMPLICON), trimStart: 0, trimEnd: 0 },
        {
          data: trace('edited', AMPLICON, { cut: CUT, parts: [{ size: 0, fraction: 0.5 }, { size: -1, fraction: 0.5 }] }),
          trimStart: 0,
          trimEnd: 0,
        },
      ])
    })
    const ids = store().sequencingReads.map(r => r.id)
    render(<GuidePanel />)
    fireEvent.change(screen.getByLabelText('Control'), { target: { value: ids[0] } })
    fireEvent.change(screen.getByLabelText('Edited'), { target: { value: ids[1] } })
    act(() => { screen.getByRole('button', { name: /Analyse/ }).click() })

    const analysis = store().crisprAnalysis
    expect(analysis?.kind).toBe('traces')
    if (analysis?.kind !== 'traces') return
    expect(analysis.result.edited).toBeCloseTo(0.5, 1)
    expect(analysis.result.spectrum.find(x => x.size === -1)?.fraction).toBeCloseTo(0.5, 1)
    expect(screen.getByText(/From the traces/)).toBeTruthy()
    // The headline numbers are on screen, not only in the store.
    expect(document.querySelectorAll('.ca-number').length).toBeGreaterThan(2)
    expect(document.querySelectorAll('.ca-bar').length).toBeGreaterThan(0)
  })

  it('groups pasted reads into alleles', async () => {
    const deleted = AMPLICON.slice(0, CUT) + AMPLICON.slice(CUT + 1)
    const pasted = [...Array(6).fill(AMPLICON), ...Array(4).fill(deleted)]
      .map((r, i) => `>r${i}\n${r}`).join('\n')
    render(<GuidePanel />)
    fireEvent.change(screen.getByLabelText('Evidence'), { target: { value: 'reads' } })
    fireEvent.change(screen.getByLabelText(/Or paste reads/), { target: { value: pasted } })
    await act(async () => { screen.getByRole('button', { name: /Analyse/ }).click() })
    await waitFor(() => expect(store().crisprAnalysis).not.toBeNull())

    const analysis = store().crisprAnalysis
    expect(analysis?.kind).toBe('reads')
    if (analysis?.kind !== 'reads') return
    expect(analysis.table.counted).toBe(10)
    expect(analysis.table.edited).toBeCloseTo(0.4, 2)
    expect(analysis.table.frameshift).toBeCloseTo(0.4, 2)
    expect(screen.getByText('Alleles')).toBeTruthy()
  })

  it('clears a reading', () => {
    act(() => {
      store().setCrisprAnalysis({
        kind: 'reads',
        source: { description: 'test', cut: CUT, when: Date.now() },
        table: {
          counted: 1, skipped: { tooShort: 0, unaligned: 0 }, alleles: [], edited: 0, frameshift: 0,
          donor: 0, spectrum: [], window: { start: 0, end: 10 },
        },
        conversion: null,
        sample: { used: 1, available: 1, sampled: false },
      })
    })
    render(<GuidePanel />)
    act(() => { screen.getByRole('button', { name: 'Clear' }).click() })
    expect(store().crisprAnalysis).toBeNull()
  })
})
