import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { gzipSync, strToU8 } from 'fflate'

const toasts = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }))
vi.mock('../toast', () => ({ notify: toasts }))
const traces = vi.hoisted(() => ({ importTraceFiles: vi.fn(async () => []) }))
vi.mock('../sanger/import', async importOriginal => ({
  ...(await importOriginal<typeof import('../sanger/import')>()),
  importTraceFiles: traces.importTraceFiles,
}))

const peek = vi.hoisted(() => ({ reads: 1 }))
vi.mock('../ngs/peek', async importOriginal => ({
  ...(await importOriginal<typeof import('../ngs/peek')>()),
  peekReads: vi.fn(async () => ({ gz: true, reads: Array.from({ length: peek.reads }, () => ({ header: 'r', seq: 'ACGT', qual: '' })) })),
}))

import { useFileImport, canOpen, isSystemFile, looksLikeWords, OPEN_ACCEPT, withoutCompanions } from './useFileImport'
import { useEditorStore } from '../store'

const store = () => useEditorStore.getState()
const handlers = () => ({ onSessionFile: vi.fn(), onReadFiles: vi.fn(), onAlignmentFiles: vi.fn(), onGenomeLinks: vi.fn() })
const file = (name: string, text = '') => new File([text], name)

beforeEach(() => {
  for (const t of store().tabs) store().closeTab(t.id)
  useEditorStore.setState({ folders: [], recentlyDeleted: [] })
  for (const f of Object.values(toasts)) f.mockReset()
  traces.importTraceFiles.mockClear()
})

describe('which files open', () => {
  it('takes read alignments, gzipped reads and every sequence format, in one accept list', () => {
    expect(canOpen('sample.bam')).toBe(true)
    expect(canOpen('sample.SAM')).toBe(true)
    expect(canOpen('reads_R1.fastq.gz')).toBe(true)
    expect(canOpen('report.xlsx')).toBe(false)
    // The explorer's picker used to grey these out.
    for (const ext of ['.gp', '.faa', '.pdb', '.cif', '.seq', '.bam', '.gz', '.aln']) {
      expect(OPEN_ACCEPT.split(',')).toContain(ext)
    }
  })

  it('passes over the files an operating system leaves in a folder', () => {
    expect(isSystemFile('.DS_Store')).toBe(true)
    expect(isSystemFile('Thumbs.db')).toBe(true)
    expect(isSystemFile('pUC19.gb')).toBe(false)
  })

  it("leaves out an ABI .seq beside its chromatogram, and keeps one that stands alone", () => {
    const kept = withoutCompanions([file('A01.ab1'), file('A01.seq'), file('B02.seq')]).map(f => f.name)
    expect(kept).toEqual(['A01.ab1', 'B02.seq'])
  })
})

describe('looksLikeWords', () => {
  it('tells words from residues', () => {
    expect(looksLikeWords('Hello world')).toBe(true)
    expect(looksLikeWords('the quick brown fox')).toBe(true)
    expect(looksLikeWords('MKTAYIAKQRQISFVKSHFSRQ')).toBe(false)
    expect(looksLikeWords('MKTAYIAKQR QISFVKSHFS RQLEERLGLI\nEVQAPILSRV GDGTQDNLSG')).toBe(false)
    expect(looksLikeWords('mktayiakqr\nqisfvkshfs\nrq')).toBe(false)
  })
})

describe('useFileImport', () => {
  it('asks about every large file in turn, where a second one used to replace the first', async () => {
    const { result } = renderHook(() => useFileImport(handlers()))
    const fasta = (n: number) => Array.from({ length: n }, (_, i) => `>r${i}\nACGT\n`).join('')
    act(() => { result.current.openPastedText(fasta(250)) })
    act(() => { result.current.openPastedText(fasta(300)) })
    expect(result.current.manyRecords?.count).toBe(250)
    act(() => { result.current.manyRecords!.open(1); result.current.closeManyRecords() })
    expect(result.current.manyRecords?.count).toBe(300)
    act(() => { result.current.manyRecords!.open(1); result.current.closeManyRecords() })
    expect(result.current.manyRecords).toBeNull()
    expect(store().tabs).toHaveLength(2)
  })

  it('opens pasted text the way a text file is read, marked as pasted', () => {
    const { result } = renderHook(() => useFileImport(handlers()))
    act(() => { result.current.openPastedText('>NM_1 human gene\nACGTACGT\n>NM_2\nGGGG\n') })
    expect(store().tabs.map(t => t.doc.name)).toEqual(['NM_1', 'NM_2'])
    expect(store().tabs[0].doc.description).toBe('human gene')
    expect(store().tabs[0].doc.metadata?.origin).toBe('paste')
    expect(store().folders.map(f => f.name)).toEqual(['Pasted sequences'])
  })

  it('does not take pasted words for a protein', () => {
    const { result } = renderHook(() => useFileImport(handlers()))
    act(() => { result.current.openPastedText('Hello world') })
    expect(store().tabs).toHaveLength(0)
    expect(toasts.error).toHaveBeenCalledWith('The clipboard does not look like sequence data', expect.anything())
  })

  it('reads pasted alignments as alignments', () => {
    useEditorStore.setState({ alignments: [] })
    const { result } = renderHook(() => useFileImport(handlers()))
    act(() => { result.current.openPastedText('CLUSTAL W\n\nseqA    ACGTACGTAC-GT\nseqB    ACGTTCGTACAGT\n') })
    expect(store().alignments).toHaveLength(1)
    expect(store().tabs).toHaveLength(0)
  })

  it('gives a folder of files one notice for what it cannot open', () => {
    const { result } = renderHook(() => useFileImport(handlers()))
    act(() => {
      result.current.handleFilesOpen([file('.DS_Store'), file('notes.docx'), file('plate.xlsx'), file('A01.ab1'), file('A01.seq')])
    })
    expect(toasts.error).not.toHaveBeenCalled()
    expect(toasts.warning).toHaveBeenCalledTimes(1)
    expect(toasts.warning.mock.calls[0][0]).toBe('Skipped 2 files that SeqNexus cannot open')
    expect(traces.importTraceFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'A01.ab1' })], {})
  })

  it('sends read alignments to their dialog', () => {
    const h = handlers()
    const { result } = renderHook(() => useFileImport(h))
    act(() => { result.current.handleFilesOpen([file('x.bam')]) })
    expect(h.onAlignmentFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'x.bam' })], expect.any(Function))
  })
})

/** The open tab named so. */
const tab = (name: string) => store().tabs.find(t => t.doc.name === name)
/** The folder holding a tab, by name. */
const folderOf = (name: string) => {
  const t = tab(name)!
  return store().folders.find(f => f.itemUids.some(u => u.endsWith(`:${t.id}`)))
}

describe('importing files', () => {
  it('rebuilds the directories of an imported folder as explorer folders', async () => {
    const { result } = renderHook(() => useFileImport(handlers()))
    const a = file('a.fasta', '>seqA\nACGTACGT\n')
    const b = file('b.fasta', '>seqB\nGGGGCCCC\n')
    act(() => { result.current.handleFilesOpen([a, b], { paths: new Map([[a, 'Plate/sub/a.fasta'], [b, 'Plate/b.fasta']]) }) })
    await waitFor(() => expect(tab('seqA')).toBeDefined())
    await waitFor(() => expect(tab('seqB')).toBeDefined())
    const plate = store().folders.find(f => f.name === 'Plate')!
    const sub = store().folders.find(f => f.name === 'sub')!
    expect(plate.parentId).toBeNull()
    expect(sub.parentId).toBe(plate.id)
    expect(folderOf('seqA')?.id).toBe(sub.id)
    expect(folderOf('seqB')?.id).toBe(plate.id)
  })

  it('imports into the folder it was dropped on', async () => {
    const into = store().createFolder('Target')
    const { result } = renderHook(() => useFileImport(handlers()))
    act(() => { result.current.handleFilesOpen([file('one.fasta', '>one\nACGTTT\n')], { into }) })
    await waitFor(() => expect(tab('one')).toBeDefined())
    expect(folderOf('one')?.id).toBe(into)
  })

  it('reports several files once, with what went wrong underneath', async () => {
    const { result } = renderHook(() => useFileImport(handlers()))
    act(() => {
      result.current.handleFilesOpen([
        file('x.fasta', '>x\nACGTAC\n'), file('y.fasta', '>y\nGGTTAA\n'), file('bad.txt', 'Hello, world!'),
      ])
    })
    await waitFor(() => expect(toasts.warning).toHaveBeenCalled())
    expect(toasts.warning).toHaveBeenCalledTimes(1)
    const [message, opts] = toasts.warning.mock.calls[0]
    expect(message).toBe('Opened 2 items from 3 files')
    expect(opts.detail).toMatch(/"bad.txt" does not look like sequence data/)
    expect(toasts.error).not.toHaveBeenCalled()
  })

  it('shows a sequence that is already open instead of opening it twice, and offers a copy', async () => {
    const { result } = renderHook(() => useFileImport(handlers()))
    act(() => { result.current.handleFilesOpen([file('d.fasta', '>dupe\nACGTACGTAA\n')]) })
    await waitFor(() => expect(tab('dupe')).toBeDefined())
    act(() => { result.current.handleFilesOpen([file('d.fasta', '>dupe\nACGTACGTAA\n')]) })
    await waitFor(() => expect(toasts.info).toHaveBeenCalled())
    expect(store().tabs.filter(t => t.doc.name === 'dupe')).toHaveLength(1)
    expect(toasts.info.mock.calls[0][0]).toBe('"dupe" is already open')
    act(() => { toasts.info.mock.calls[0][1].action.onClick() })
    expect(store().tabs.filter(t => t.doc.name === 'dupe')).toHaveLength(2)
  })

  it('opens EMBL files', async () => {
    const { result } = renderHook(() => useFileImport(handlers()))
    const embl = 'ID   EMB1; SV 1; linear; DNA; STD; SYN; 8 BP.\nDE   An EMBL record\nSQ   Sequence 8 BP;\n     acgtacgt                                                                  8\n//\n'
    act(() => { result.current.handleFilesOpen([file('r.embl', embl)]) })
    await waitFor(() => expect(tab('EMB1')).toBeDefined())
    expect(tab('EMB1')!.doc.description).toBe('An EMBL record')
  })

  it('adds GFF3 features to the open sequence they name', async () => {
    store().openDocument('pMy', 'ACGT'.repeat(10))
    const { result } = renderHook(() => useFileImport(handlers()))
    const gff = '##gff-version 3\npMy\t.\tgene\t3\t12\t.\t+\t.\tName=myGene\nother\t.\tgene\t1\t5\t.\t+\t.\tName=lost\n'
    act(() => { result.current.handleFilesOpen([file('f.gff3', gff)]) })
    await waitFor(() => expect(tab('pMy')!.doc.annotations.some(a => a.name === 'myGene')).toBe(true))
    const gene = tab('pMy')!.doc.annotations.find(a => a.name === 'myGene')!
    expect([gene.start, gene.end]).toEqual([2, 12])
    expect(toasts.warning.mock.calls[0][0]).toMatch(/No open sequence named "other"/)
  })

  it('opens gzipped GenBank, and a gzipped FASTA of a few sequences as sequences', async () => {
    const { result } = renderHook(() => useFileImport(handlers()))
    const gb = 'LOCUS       gzRec 8 bp DNA linear\nORIGIN\n        1 acgtacgt\n//\n'
    act(() => { result.current.handleFilesOpen([new File([gzipSync(strToU8(gb))], 'r.gb.gz')]) })
    await waitFor(() => expect(tab('gzRec')).toBeDefined())
    peek.reads = 1
    act(() => { result.current.handleFilesOpen([new File([gzipSync(strToU8('>chrZ\nACGTACGTAC\n'))], 'ref.fa.gz')]) })
    await waitFor(() => expect(tab('chrZ')).toBeDefined())
  })

  it('sends a gzipped FASTA of many records to the read set import', async () => {
    const h = handlers()
    const { result } = renderHook(() => useFileImport(h))
    peek.reads = 500
    act(() => { result.current.handleFilesOpen([new File([gzipSync(strToU8('>r1\nACGT\n'))], 'reads.fa.gz')]) })
    await waitFor(() => expect(h.onReadFiles).toHaveBeenCalled())
    expect(h.onReadFiles.mock.calls[0][0][0].name).toBe('reads.fa.gz')
  })
})

describe('whole-plasmid sequencing results', () => {
  it('offers a drop that holds a result set before importing it, and imports the rest straight away', () => {
    const h = { ...handlers(), onResultSets: vi.fn() }
    const { result } = renderHook(() => useFileImport(h))
    const drop = [file('ORD_1_a.fasta', '>a\nACGT\n'), file('ORD_1_a.fastq.gz'), file('ORD_1_a.png'), file('pX12.gb', 'LOCUS')]
    act(() => { result.current.handleFilesOpen(drop) })
    expect(h.onResultSets).toHaveBeenCalledTimes(1)
    const [samples, rest] = h.onResultSets.mock.calls[0]
    expect(samples.map((s: { name: string }) => s.name)).toEqual(['ORD_1_a'])
    expect(rest.map((f: File) => f.name)).toEqual(['pX12.gb'])
    // Nothing went down the ordinary path yet.
    expect(h.onReadFiles).not.toHaveBeenCalled()
  })

  it('imports a drop the ordinary way when it holds no result set', async () => {
    const h = { ...handlers(), onResultSets: vi.fn() }
    const { result } = renderHook(() => useFileImport(h))
    act(() => { result.current.handleFilesOpen([file('pX12.fasta', '>pX12\nACGTACGT\n')]) })
    expect(h.onResultSets).not.toHaveBeenCalled()
    await waitFor(() => expect(store().tabs.map(t => t.doc.name)).toContain('pX12'))
    expect(canOpen('ORD_results.zip')).toBe(true)
    expect(OPEN_ACCEPT.split(',')).toContain('.zip')
  })
})
