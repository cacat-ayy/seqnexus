import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import App from './App'
import { useEditorStore } from './store'
import { useToastStore } from './toast'
import { toUid } from './explorer/types'
import { simpleAb1 } from './io/abif-testing'

const lastToast = () => { const t = useToastStore.getState().toasts; return t[t.length - 1] }

const SEQ = 'com.biomatters.geneious.publicapi.implementations.sequence'

function doc(cls: string, name: string, content: string, fields = ''): string {
  return `<geneiousDocument class="${cls}"><hiddenFields><cache_name>${name}</cache_name></hiddenFields>`
    + `<fields>${fields}</fields><originalElement>${content}</originalElement></geneiousDocument>`
}

const CLONING = '<?xml version="1.0" encoding="UTF-8"?><geneious version="2026.1.1"><folder name="Cloning" />'
  + doc(`${SEQ}.DefaultNucleotideSequence`, 'pDONR201',
    '<XMLSerialisableRootElement><sequenceAnnotations /><charSequence>AcGtAcGtAcGtAcGt</charSequence></XMLSerialisableRootElement>',
    '<topology>circular</topology><molType>DNA</molType>')
  + doc(`${SEQ}.DefaultAminoAcidSequence`, 'YadF',
    '<XMLSerialisableRootElement><sequenceAnnotations /><charSequence>MsElDpLf</charSequence></XMLSerialisableRootElement>',
    '<molType>AA</molType>')
  + doc(`${SEQ}.OligoSequenceDocument`, 'yadF F +attB1',
    '<XMLSerialisableRootElement><charSequence>GgGgAcAaGtTtGtAc</charSequence></XMLSerialisableRootElement>',
    '<oligoType>Primer</oligoType>')
  + doc('com.biomatters.geneious.common.restrictionAnalysis.EnzymeSetDocument', 'BioBrick',
    '<XMLSerialisableRootElement><name>BioBrick</name><enzymes>'
    + ['EcoRI', 'XbaI', 'NotAnEnzyme'].map(n => `<enzyme><name>${n}</name><recognitionSequence>G^AATTC</recognitionSequence></enzyme>`).join('')
    + '</enzymes></XMLSerialisableRootElement>')
  + doc('com.biomatters.geneious.publicapi.documents.OperationRecordDocument', 'Extraction', '')
  + '</geneious>'

async function open(text: string, name: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File([text], name, { type: 'application/octet-stream' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
}

describe('opening a Geneious file', () => {
  beforeEach(() => {
    useToastStore.getState().clear()
    for (const tab of useEditorStore.getState().tabs) useEditorStore.getState().closeTab(tab.id)
  })

  it('opens each document as what it is, filed in a folder named after the Geneious folder', async () => {
    render(<App />)
    await open(CLONING, 'Cloning.geneious')

    await waitFor(() => expect(useEditorStore.getState().tabs.some(t => t.doc.name === 'YadF')).toBe(true))
    const s = useEditorStore.getState()
    const dna = s.tabs.find(t => t.doc.name === 'pDONR201')!
    const protein = s.tabs.find(t => t.doc.name === 'YadF')!
    expect(dna.doc.sequence.bases).toBe('ACGTACGTACGTACGT')
    expect(dna.doc.sequence.topology).toBe('circular')
    expect(protein.doc.sequence.alphabet).toBe('protein')

    const oligo = s.oligos.find(o => o.name === 'yadF F +attB1')!
    expect(oligo.sequence).toBe('GGGGACAAGTTTGTAC')

    const folder = s.folders.find(f => f.name === 'Cloning')!
    expect(folder.itemUids).toHaveLength(3)
    expect(folder.itemUids).toContain(toUid('oligo', oligo.id))

    const toast = lastToast()
    expect(toast.severity).toBe('warning')
    expect(toast.message).toBe('Opened 1 sequence and 1 protein from "Cloning.geneious"; 1 oligo added to the primer library; 1 enzyme set saved')
    expect(toast.detail).toBe('1 enzyme of "BioBrick" not in the enzyme database, so left out (NotAnEnzyme)')
    expect(s.enzymeSets.find(e => e.name === 'BioBrick')?.enzymes).toEqual(['EcoRI', 'XbaI'])
  })

  it('does not save an enzyme set again from the same file', async () => {
    render(<App />)
    await open(CLONING, 'Cloning.geneious')
    await waitFor(() => expect(useEditorStore.getState().enzymeSets.some(e => e.name === 'BioBrick')).toBe(true))
    const count = useEditorStore.getState().enzymeSets.length
    await open(CLONING, 'Cloning.geneious')
    await waitFor(() => expect(lastToast().detail).toContain('1 enzyme set was already saved'))
    expect(useEditorStore.getState().enzymeSets).toHaveLength(count)
  })

  it('opens an alignment as an alignment item in the same folder', async () => {
    render(<App />)
    const rows = ['Adam', 'Eve'].map(n => `<sequence><gappedSequence type="DefaultNucleotideSequence"><name>${n}</name>`
      + '<charSequence gapSuffixLength="1">ACGT</charSequence></gappedSequence></sequence>').join('')
    const text = '<geneious><folder name="People" />'
      + doc(`${SEQ}.DefaultNucleotideSequence`, 'Adam',
        '<XMLSerialisableRootElement><sequenceAnnotations /><charSequence>ACGT</charSequence></XMLSerialisableRootElement>')
      + doc('com.biomatters.geneious.publicapi.implementations.DefaultAlignmentDocument', 'People alignment',
        `<DefaultAlignmentDocument><alphabet>NUCLEOTIDE</alphabet><sequences>${rows}</sequences></DefaultAlignmentDocument>`)
      + '</geneious>'
    await open(text, 'People.geneious')

    await waitFor(() => expect(useEditorStore.getState().alignments.some(a => a.name === 'People alignment')).toBe(true))
    const s = useEditorStore.getState()
    const aln = s.alignments.find(a => a.name === 'People alignment')!
    expect(aln.doc.rows.map(r => r.seq)).toEqual(['ACGT', 'ACGT'])
    expect(aln.doc.origin.file).toBe('People.geneious')
    expect(s.folders.find(f => f.name === 'People')!.itemUids).toContain(toUid('alignment', aln.id))
    expect(lastToast().message).toBe('Opened 1 sequence and 1 alignment from "People.geneious"')
  })

  it('opens a Sanger read as a chromatogram in the folder, the sequence staying the open item', async () => {
    render(<App />)
    const raw = btoa(String.fromCharCode(...new Uint8Array(simpleAb1('ACGTACGTACGT'))))
    const text = '<geneious><folder name="Contig Assembly" />'
      + doc(`${SEQ}.DefaultNucleotideSequence`, 'yghJ CDS',
        '<XMLSerialisableRootElement><sequenceAnnotations /><charSequence>ACGTACGTACGT</charSequence></XMLSerialisableRootElement>')
      + '<geneiousDocument class="com.biomatters.plugins.abi.ABIPluginDocument"><hiddenFields><cache_urn>urn:local:.:a1</cache_urn>'
      + `<cache_name>77536205_C02.ab1</cache_name></hiddenFields><originalElement><ABIDocument><rawdata>${raw}</rawdata></ABIDocument></originalElement></geneiousDocument>`
      + '</geneious>'
    await open(text, 'Contig Assembly.geneious')

    await waitFor(() => expect(useEditorStore.getState().sequencingReads.some(r => r.data.name === '77536205_C02')).toBe(true))
    const s = useEditorStore.getState()
    const read = s.sequencingReads.find(r => r.data.name === '77536205_C02')!
    expect(read.data.bases).toBe('ACGTACGTACGT')
    expect(s.folders.find(f => f.name === 'Contig Assembly')!.itemUids).toContain(toUid('read', read.id))
    expect(s.tabs.find(t => t.id === s.activeTabId)?.doc.name).toBe('yghJ CDS')
    expect(s.activeSequencingReadIds).toEqual([])
    expect(lastToast().message).toBe('Opened 1 sequence and 1 chromatogram from "Contig Assembly.geneious"')
  })

  it('opens a structure as its protein, shown in 3D', async () => {
    render(<App />)
    const atom = (serial: number, resn: string, resi: number) =>
      `ATOM  ${String(serial).padStart(5)}  CA  ${resn} A${String(resi).padStart(4)}    ${'1.000'.padStart(8)}${'2.000'.padStart(8)}${'3.000'.padStart(8)}  1.00 50.00           C`
    const pdb = ['HEADER    TEST', atom(1, 'MET', 1), atom(2, 'LYS', 2), atom(3, 'GLY', 3), 'END'].join('&#xD;\n')
    const text = '<geneious><folder name="Protein Documents" />'
      + doc('com.biomatters.geneious.publicapi.implementations.structure.PdbDocument', 'Small protein',
        `<XMLSerialisableRootElement><fields><PDBname>9TST</PDBname><data>${pdb}</data></fields></XMLSerialisableRootElement>`)
      + '</geneious>'
    await open(text, 'Protein Documents.geneious')

    await waitFor(() => expect(useEditorStore.getState().tabs.some(t => t.doc.name === 'Small protein')).toBe(true))
    const s = useEditorStore.getState()
    const tab = s.tabs.find(t => t.doc.name === 'Small protein')!
    expect(tab.doc.sequence.alphabet).toBe('protein')
    expect(tab.doc.sequence.bases).toBe('MKG')
    expect(tab.doc.metadata?.structure).toMatchObject({ source: 'file', id: '9TST.pdb', chain: 'A' })
    expect(s.viewMode).toBe('structure')
  })

  it('says so when nothing in the file can be opened', async () => {
    render(<App />)
    const links = '<geneious><folder name="Plants" />'
      + doc('com.biomatters.plugins.ncbi.genome.GenomeSummaryDocument', 'Rice Chr12', '', '<sequence_length>27757321</sequence_length>')
      + '</geneious>'
    await open(links, 'Plants.geneious')
    await waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(0))
    const toast = lastToast()
    expect(toast.severity).toBe('error')
    expect(toast.message).toBe('Nothing in "Plants.geneious" could be opened')
    expect(toast.detail).toContain('1 genome link not opened (Rice Chr12)')
  })

  it('lists genome links on request, each opening the Fetch dialog with its accession', async () => {
    render(<App />)
    const link = '<geneiousDocument class="com.biomatters.plugins.ncbi.genome.GenomeSummaryDocument"><hiddenFields>'
      + '<override_accession>NC_008405</override_accession><override_cache_name>Rice Chr12</override_cache_name><cache_name>NC_008405</cache_name>'
      + '</hiddenFields><fields><sequence_length type="int">27757321</sequence_length></fields><originalElement /></geneiousDocument>'
    await open(`<geneious><folder name="Plants" />${link}</geneious>`, 'Plants.geneious')
    await waitFor(() => expect(lastToast()?.action?.label).toBe('Show links'))
    // The notice stays until dismissed, so the list can still be had.
    expect(lastToast().duration).toBe(0)

    act(() => { lastToast().action!.onClick() })
    const dialog = await screen.findByRole('dialog', { name: 'Genome links in "Plants.geneious"' })
    expect(within(dialog).getByText('NC_008405')).toBeInTheDocument()
    expect(within(dialog).getByText('27.76 Mbp')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Fetch…' }))
    const fetch = await screen.findByRole('dialog', { name: 'Import by Accession' })
    expect(within(fetch).getByRole('textbox')).toHaveValue('NC_008405')
  })
})
