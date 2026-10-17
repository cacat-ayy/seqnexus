/**
 * Opening files: which reader a file goes to by its name and contents, the
 * folder that a multi-record file lands in, and the hand-offs to the session,
 * read set and read alignment import dialogs. Shared by drag and drop, the
 * Open dialog and the explorer.
 *
 * An import of several files reports once (see import/report.ts), files its
 * items into the explorer folders that mirror the directories they came from
 * (import/folders.ts), and leaves out sequences that are already open
 * (import/duplicates.ts).
 */

import { useCallback, useRef, useState } from 'react'
import { gunzipSync } from 'fflate'
import { useEditorStore } from '../store'
import type { DocumentState } from '../models/Document'
import { Sequence } from '../models/Sequence'
import { readFasta, recordName, type FastaRead, type FastaRecord } from '../io/fasta'
import { parseGenBankMulti } from '../io/genbank'
import { looksLikeEmbl, parseEmbl } from '../io/embl'
import { gff3Documents, looksLikeGff3, matchSeqid, readGff3 } from '../io/gff3'
import { parseGenbankFile } from '../workers/genbank-parser'
import { parseSnapGene } from '../io/snapgene'
import { describeSkipped, readGeneious, type GeneiousImport, type GeneiousSkipped } from '../io/geneious'
import { resolveEnzymeNames } from '../enzymes/sets'
import { toUid } from '../explorer/types'
import { importTraceFiles, initialTrim, initialTrimRule, isTraceFile } from '../sanger/import'
import { parseFastq, meanQuality } from '../io/fastq'
import { countRecords, isNgsByName, NGS_FEW_RECORDS, peekReads } from '../ngs/peek'
import { structureFromFile } from '../structure/sources'
import { proteinsFromStructure } from '../structure/attach'
import { isReadFile } from '../ngs/detect'
import { importSessionFromJson, type RestoredSession } from '../persistence'
import { ALIGNMENT_ONLY_EXTENSIONS, ALN_EXTENSIONS, detectFormat, fastaLooksAligned, readAlignment } from '../msa/formats'
import { notify } from '../toast'
import { directoryOf, folderMaker, type Place } from '../import/folders'
import { batchReporter, directReporter, type Reporter } from '../import/report'
import { openTwin } from '../import/duplicates'

/**
 * Every file extension that opens directly, besides alignments. One list
 * for the drop zones and every Open dialog: three copies had drifted apart,
 * and the explorer's picker greyed out GenPept, .faa and structure files.
 */
const OPEN_EXTENSIONS = [
  '.gb', '.gbk', '.gbff', '.genbank', '.gp', '.gpt', '.genpept', '.ape', '.embl', '.emb', '.gff', '.gff3',
  '.pdb', '.ent', '.cif', '.mmcif', '.dna', '.geneious',
  '.fasta', '.fa', '.fas', '.fna', '.faa', '.fastq', '.fq', '.seq', '.txt', '.ab1', '.abi', '.abif', '.scf', '.json',
  ...ALN_EXTENSIONS,
]
/** Read alignments, which go to their own import dialog. */
const MAPPED_READS = /\.(bam|sam)$/i
/** GenBank, EMBL and GFF3 files gzipped, as NCBI and Ensembl serve them, and gzipped session files. */
const COMPRESSED_RECORDS = /\.(gb|gbk|gbff|genbank|gp|gpt|genpept|ape|embl|emb|gff|gff3|json)\.gz$/i
/** Gzipped FASTA: a reference genome or a file of reads, told apart by peeking. */
const COMPRESSED_FASTA = /\.(fasta|fa|fas|fna|faa)\.gz$/i
/** GenBank text, ApE's files (GenBank under another name) included. */
const GENBANK_FILE = /\.(gb|gbk|gbff|genbank|gp|gpt|genpept|ape)$/i
/**
 * The largest gzipped FASTA opened as sequences. Bigger is a genome's worth
 * of text for one tab, or reads; it goes to the read set import as before.
 */
const COMPRESSED_FASTA_MAX_BYTES = 30 * 1024 * 1024

const escapeExt = (ext: string) => ext.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Every file extension the drop zone and the Open dialog accept. */
export const SUPPORTED_EXTENSIONS = new RegExp(`\\.(${[...new Set(OPEN_EXTENSIONS)].map(escapeExt).join('|')})$`, 'i')

/** The `accept` list for file pickers. `.gz` stands for every gzipped format, which the picker cannot spell out. */
export const OPEN_ACCEPT = [...new Set([...OPEN_EXTENSIONS, '.gz', '.bam', '.sam'])].join(',')

/** Can this file be opened, by name? Sequences, alignments, reads (gzipped too) and read alignments. */
export function canOpen(name: string): boolean {
  return SUPPORTED_EXTENSIONS.test(name) || isReadFile(name) || MAPPED_READS.test(name)
    || COMPRESSED_RECORDS.test(name) || COMPRESSED_FASTA.test(name)
}

/** Files an operating system leaves in folders (.DS_Store, Thumbs.db): never data, so passed over without a word. */
export function isSystemFile(name: string): boolean {
  return name.startsWith('.') || /^(thumbs\.db|desktop\.ini)$/i.test(name)
}

/**
 * Leave out the .seq file an ABI sequencer writes beside each chromatogram:
 * it holds the trace's base calls, so opening it as well put every read in
 * twice, once as a trace and once as a plain sequence.
 */
export function withoutCompanions(files: File[]): File[] {
  const stem = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase()
  const traces = new Set(files.filter(f => isTraceFile(f.name)).map(f => stem(f.name)))
  if (traces.size === 0) return files
  return files.filter(f => !(/\.seq$/i.test(f.name) && traces.has(stem(f.name))))
}

/**
 * Does headerless text read as words rather than residues? Sequence is
 * written in one case per run of letters (soft-masked DNA mixes cases, but
 * it reads as DNA first and never reaches this), and when it is broken into
 * blocks on a line every block but the last has the same length. Words do
 * neither: "Hello world" mixes cases, "the quick brown fox" has blocks of
 * 3 and 5.
 */
export function looksLikeWords(text: string): boolean {
  const lengths = new Set<number>()
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.split(/[\s\d]+/).filter(Boolean)
    for (const t of tokens) if (/[a-z]/.test(t) && /[A-Z]/.test(t)) return true
    for (const t of tokens.slice(0, -1)) lengths.add(t.length)
  }
  return lengths.size > 1
}

/** What a plain-text file has to look like to be read as bases or residues. */
const SEQUENCE_CHARS = /^[A-Za-z*\s\n\r>;.\-\d]+$/

export const SUPPORTED_FORMATS_HINT =
  'Supported: GenBank (.gb, .gbff), GenPept (.gp), EMBL (.embl), GFF3 (.gff3), SnapGene (.dna), Geneious (.geneious), ApE (.ape), '
  + 'FASTA (.fasta, .fa, .faa), FASTQ (.fastq, .fq), AB1 (.ab1), SCF (.scf), plain text (.txt), structures (.pdb, .cif), '
  + 'read alignments (.bam, .sam), alignments in Clustal (.aln), PHYLIP (.phy), NEXUS (.nex), MEGA (.meg), Stockholm (.sto), '
  + 'PIR (.pir) and MSF (.msf), and any of these gzipped.'

/**
 * A file with more records than this asks before opening: each record is a
 * tab, and a FASTQ of tens of thousands of reads would freeze the page.
 */
export const MANY_RECORDS = 200

/**
 * Whether a text file is an alignment rather than sequences: an alignment-only
 * extension, a format only alignments use (Clustal, NEXUS, ...), or a FASTA
 * whose records are gapped and the same length.
 */
function looksLikeAlignmentFile(text: string, fileName: string): boolean {
  const ext = (/\.[^.]+$/.exec(fileName)?.[0] ?? '').toLowerCase()
  if (ALIGNMENT_ONLY_EXTENSIONS.includes(ext) || ext === '.afa' || ext === '.a2m') return true
  const fmt = detectFormat(text, fileName)
  if (fmt && fmt !== 'fasta') return true
  return fmt === 'fasta' && fastaLooksAligned(text)
}

/** "a", "a and b", "a, b and c". */
const listed = (parts: string[]) => parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
const count = (k: number, one: string, many: string) => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`

/** Parser and reader failures, reduced to something fit for a detail line. */
export const errorDetail = (err: unknown): string | undefined =>
  err instanceof Error ? err.message : err ? String(err) : undefined

/** Tell the user about the FASTA records that were not opened: those with characters that are not sequence codes. */
export function reportFastaSkips(source: string, { unreadable }: FastaRead, report: Reporter = directReporter): void {
  if (unreadable.length > 0) {
    report.warning(`${unreadable.length} record${unreadable.length === 1 ? '' : 's'} in "${source}" could not be read`, {
      detail: `They contain characters that are not sequence codes: ${unreadable.slice(0, 5).join(', ')}${unreadable.length > 5 ? ', …' : ''}`,
    })
  }
}

/** One standing notice for features a GenBank import couldn't take in as written. */
export function reportGenBankWarnings(source: string, warnings: string[], report: Reporter = directReporter): void {
  if (warnings.length === 0) return
  const shown = warnings.slice(0, 5).join('\n')
  const more = warnings.length > 5 ? `\n…and ${warnings.length - 5} more` : ''
  report.warning(
    `${warnings.length} ${warnings.length === 1 ? 'feature' : 'features'} in "${source}" could not be read exactly as written`,
    { detail: shown + more },
  )
}

/** A file's contents, as text or bytes. FileReader, which every browser and jsdom have. */
function readFile(file: Blob, as: 'text'): Promise<string>
function readFile(file: Blob, as: 'buffer'): Promise<ArrayBuffer>
function readFile(file: Blob, as: 'text' | 'buffer'): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string | ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'))
    if (as === 'text') reader.readAsText(file)
    else reader.readAsArrayBuffer(file)
  })
}

/**
 * Is a gzipped FASTA a few long sequences (a reference) rather than reads?
 * Judged on the records in its first half megabyte: a handful is a
 * reference, more are reads for the read set import.
 */
async function isCompressedReference(file: File): Promise<boolean> {
  if (file.size > COMPRESSED_FASTA_MAX_BYTES) return false
  try {
    const peek = await peekReads(file)
    return !peek.error && peek.reads.length > 0 && peek.reads.length <= NGS_FEW_RECORDS
  } catch {
    // Unreadable here: the read set import says why, as it does for any reads.
    return false
  }
}

/** Where one file's items go and how what happened is said. */
interface OpenContext {
  place?: Place
  report?: Reporter
}

/** How an import is asked for: into a folder, with the paths of files that came from a dropped or picked folder. */
export interface ImportOptions {
  /** The explorer folder to import into; the top level when absent. */
  into?: string | null
  /** Each file's path inside a dropped folder. Picked folders carry it on the file (webkitRelativePath). */
  paths?: Map<File, string>
}

export interface FileImportHandlers {
  /** A session file was read and parsed: show the import dialog for it. */
  onSessionFile: (filename: string, json: string, session: RestoredSession) => void
  /** NGS read files, and FASTQs with many records, go to the read set import dialog. */
  onReadFiles: (files: File[], placeOf: (file: File) => Place) => void
  /** BAM and SAM files go to the read alignment import dialog. */
  onAlignmentFiles: (files: File[], placeOf: (file: File) => Place) => void
  /** Genome links a Geneious file listed: show them, each to be fetched on request. */
  onGenomeLinks: (source: string, links: GeneiousSkipped[]) => void
}

export function useFileImport(h: FileImportHandlers) {
  // Read through a ref, so the open handlers keep their identity whatever the caller passes.
  const handlers = useRef(h)
  handlers.current = h
  const openDocumentState = useEditorStore(s => s.openDocumentState)
  const addAlignment = useEditorStore(s => s.addAlignment)

  /** Open an alignment file as an alignment item. */
  const openAlignmentFile = useCallback((text: string, fileName: string, { place, report = directReporter }: OpenContext = {}) => {
    try {
      const { doc, warnings } = readAlignment(text, fileName)
      const id = addAlignment(doc, { name: fileName.replace(/\.[^.]+$/, '') })
      const folder = place?.()
      if (folder) useEditorStore.getState().moveItemToFolder(toUid('alignment', id), folder)
      report.opened(1)
      for (const w of warnings) report.warning(w)
    } catch (err) {
      report.error(`Could not read "${fileName}"`, { detail: errorDetail(err) })
    }
  }, [addAlignment])

  // Queued, one question at a time: with a single slot, a second large file
  // dropped with the first took its place and the first never opened.
  const [manyQueue, setManyQueue] = useState<{ source: string; count: number; open: (n: number) => void }[]>([])
  const openRecordsAsking = useCallback((source: string, n: number, open: (n: number) => void) => {
    if (n <= MANY_RECORDS) open(n)
    else setManyQueue(q => [...q, { source, count: n, open }])
  }, [])

  /** Open documents as tabs: one into the place, several into a folder of their own inside it. */
  const placeTabs = useCallback((docs: DocumentState[], folderName: string, place: Place | undefined): string[] => {
    const tabIds = docs.map(d => openDocumentState(d))
    const store = useEditorStore.getState()
    if (tabIds.length > 1) {
      const folderId = store.createFolder(folderName, place?.() ?? null)
      for (const id of tabIds) store.moveTabToFolder(id, folderId)
    } else if (tabIds.length === 1) {
      const folder = place?.()
      if (folder) store.moveTabToFolder(tabIds[0], folder)
    }
    return tabIds
  }, [openDocumentState])

  /**
   * Open records as tabs, several of them in one folder. Records identical
   * to an open sequence are not opened again: a lone one is shown instead,
   * and the notice offers to open copies.
   */
  const openDocsInFolder = useCallback((
    docs: DocumentState[], source: string, folderName: string,
    { noun = 'sequences', from = `"${source}"`, place, report = directReporter }: OpenContext & { noun?: string; from?: string } = {},
  ) => {
    const tabs = useEditorStore.getState().tabs
    const fresh: DocumentState[] = []
    const twins: { doc: DocumentState; tabId: string }[] = []
    for (const d of docs) {
      const twin = openTwin(d, tabs)
      if (twin) twins.push({ doc: d, tabId: twin.id })
      else fresh.push(d)
    }
    if (twins.length > 0) {
      if (fresh.length === 0 && twins.length === 1) useEditorStore.getState().setActiveTab(twins[0].tabId)
      report.duplicates(twins.map(t => t.doc), () => { placeTabs(twins.map(t => t.doc), folderName, place) })
    }
    if (fresh.length === 0) return
    openRecordsAsking(source, fresh.length, n => {
      const tabIds = placeTabs(fresh.slice(0, n), folderName, place)
      report.opened(tabIds.length)
      if (tabIds.length > 1) report.success(`Opened ${tabIds.length.toLocaleString('en-US')} ${noun} from ${from}`)
    })
  }, [openRecordsAsking, placeTabs])

  /**
   * GFF3: the sequences of a ##FASTA section open with their features;
   * features for a seqid with no sequence in the file are added to the open
   * sequence of that name, each sequence's as one undo step.
   */
  const openGff3 = useCallback((text: string, source: string, ctx: OpenContext) => {
    const report = ctx.report ?? directReporter
    const read = readGff3(text)
    if (read.warnings.length > 0) {
      report.warning(`${count(read.warnings.length, 'line', 'lines')} in "${source}" could not be read`, { detail: read.warnings.slice(0, 5).join('\n') })
    }
    const docs = gff3Documents(read)
    if (docs.length > 0) openDocsInFolder(docs, source, source.replace(/\.[^.]+$/, ''), ctx)
    const store = useEditorStore.getState()
    const missing: string[] = []
    for (const seqid of new Set([...read.features.keys(), ...read.primers.keys()])) {
      if (read.sequences.has(seqid)) continue
      const tab = matchSeqid(seqid, store.tabs)
      if (!tab) { missing.push(seqid); continue }
      const features = read.features.get(seqid) ?? []
      const primers = read.primers.get(seqid) ?? []
      store.setActiveTab(tab.id)
      if (features.length > 0) useEditorStore.getState().addAnnotations(features)
      if (primers.length > 0) useEditorStore.getState().addPrimers(primers)
      const added = [
        ...(features.length > 0 ? [count(features.length, 'feature', 'features')] : []),
        ...(primers.length > 0 ? [count(primers.length, 'primer', 'primers')] : []),
      ]
      report.info(`Added ${added.join(' and ')} from "${source}" to ${tab.doc.name}`)
    }
    if (missing.length > 0) {
      report.warning(`No open sequence named ${listed(missing.slice(0, 4).map(m => `"${m}"`))}${missing.length > 4 ? ' and others' : ''} for the features in "${source}"`, {
        detail: 'Features go onto the open sequence their seqid names. Open it first, or use a GFF3 file with a ##FASTA section.',
      })
    }
    if (docs.length === 0 && read.features.size === 0 && read.primers.size === 0) report.error(`No features found in "${source}"`)
  }, [openDocsInFolder])

  /**
   * Open text as what it holds: an alignment, GenBank, EMBL or GFF3
   * records, or FASTA and bare sequence. Shared by text files and the
   * clipboard, which used to have a reader of its own that knew no
   * alignments and took any run of letters, prose included, for a protein.
   */
  const openText = useCallback((text: string, fileName: string, fromClipboard = false, ctx: OpenContext = {}) => {
    const report = ctx.report ?? directReporter
    const source = fromClipboard ? 'clipboard' : fileName
    const subject = fromClipboard ? 'The clipboard' : `"${fileName}"`
    const where = fromClipboard ? 'the clipboard' : `"${fileName}"`
    const defaultName = fromClipboard ? 'Pasted' : fileName.replace(/\.[^.]+$/, '')
    const folderName = fromClipboard ? 'Pasted sequences' : defaultName
    const tag = (docs: DocumentState[]) => (fromClipboard
      ? docs.map(d => ({ ...d, metadata: { ...d.metadata, origin: 'paste' as const } }))
      : docs)
    const open = (docs: DocumentState[]) => openDocsInFolder(tag(docs), source, folderName, { from: where, ...ctx })

    if (looksLikeGff3(text) || /\.(gff|gff3)$/i.test(fileName)) {
      openGff3(text, source, ctx)
      return
    }
    // EMBL, whatever the extension: rewritten as GenBank and read as GenBank.
    if (looksLikeEmbl(text)) {
      const warnings: string[] = []
      const docs = parseEmbl(text, warnings)
      reportGenBankWarnings(source, warnings, report)
      open(docs)
      return
    }
    if (looksLikeAlignmentFile(text, fileName)) {
      openAlignmentFile(text, fileName, ctx)
      return
    }

    // GenBank text, whatever the extension (.txt, .seq): read it as
    // GenBank, not as FASTA where every header line became "bases".
    if (text.trimStart().startsWith('LOCUS')) {
      const warnings: string[] = []
      const docs = parseGenBankMulti(text, warnings)
      reportGenBankWarnings(source, warnings, report)
      open(docs)
      return
    }

    // Validate content looks like sequence data (skip for FASTA)
    const fasta = text.trimStart().startsWith('>')
    if (text.length > 0 && !SEQUENCE_CHARS.test(text) && !fasta) {
      report.error(`${subject} does not look like sequence data`, { detail: 'Expected DNA, RNA or protein letters, FASTA, GenBank or EMBL.' })
      return
    }

    const proteinFile = /\.faa$/i.test(fileName)
    const read = readFasta(text, defaultName, proteinFile)
    // Every letter is an amino-acid code, so words pass as a protein unless
    // they are caught here. A FASTA header or a .faa file says it is one.
    if (!fasta && !proteinFile && read.proteins.length > 0 && looksLikeWords(text)) {
      report.error(`${subject} does not look like sequence data`, { detail: 'It reads as words, not as DNA, RNA or protein letters.' })
      return
    }
    reportFastaSkips(source, read, report)
    const { records, proteins, unreadable } = read
    if (records.length === 0 && proteins.length === 0) {
      if (unreadable.length === 0) report.error(`No sequence data found in ${where}`)
      return
    }

    const doc = (rec: FastaRecord, alphabet?: 'protein'): DocumentState => ({
      ...recordName(rec),
      sequence: new Sequence(rec.bases, 'linear', alphabet),
      annotations: [],
    })
    open([...records.map(r => doc(r)), ...proteins.map(r => doc(r, 'protein'))])
  }, [openAlignmentFile, openDocsInFolder, openGff3])

  /**
   * Open what a Geneious export holds: its sequences as tabs and its oligos
   * in the primer library, filed together in a folder named after the
   * Geneious folder, with one summary of what was opened and what was not.
   */
  const openGeneious = useCallback(async (result: GeneiousImport, source: string, { place, report = directReporter }: OpenContext = {}) => {
    // Structures go through the structure reader first, which keeps their
    // coordinates for the 3D view, so everything in the file opens together.
    const skipped = [...result.skipped]
    const structureDocs: DocumentState[] = []
    for (const s of result.structures) {
      try {
        const docs = proteinsFromStructure(await structureFromFile(s.fileName, s.text), s.name)
        if (docs.length > 0) structureDocs.push(...docs)
        else skipped.push({ kind: 'structure', name: s.name })
      } catch {
        skipped.push({ kind: 'unreadable', name: s.name })
      }
    }
    const sequences = [...result.sequences, ...structureDocs]

    openRecordsAsking(source, sequences.length, n => {
      const store = () => useEditorStore.getState()
      const docs = sequences.slice(0, n)
      const tabIds = docs.map(d => openDocumentState(d))
      // Reads come in trimmed as they were in Geneious, or by quality when
      // they were not. Adding them makes one the open item; a sequence
      // opened from the same file stays the open one.
      const readIds = result.traces.length > 0
        ? store().addSequencingReads(result.traces.map(t => {
          const [trimStart, trimEnd] = t.trim ?? initialTrim(t.data)
          return { data: t.data, trimStart, trimEnd, trimBy: t.trim ? 'the trim saved in the Geneious file' : initialTrimRule(t.data) }
        }))
        : []
      if (readIds.length > 0 && tabIds.length > 0) store().setActiveTab(tabIds[tabIds.length - 1])
      // Alignments are filed quietly; one is shown only when nothing else was opened.
      const alignmentIds = result.alignments.map((a, i) => addAlignment(
        { ...a.doc, origin: { ...a.doc.origin, file: source } },
        { name: a.name, activate: tabIds.length === 0 && readIds.length === 0 && i === 0 },
      ))
      const oligoIds = result.oligos.length > 0 ? store().addLibraryOligos(result.oligos) : []
      // Enzyme sets are saved by the names the enzyme database uses; one
      // already saved under the same name with the same enzymes is not saved again.
      const enzymeLines: string[] = []
      let setsSaved = 0
      let setsAlready = 0
      for (const set of result.enzymeSets) {
        const { known, missing } = resolveEnzymeNames(set.enzymes)
        if (known.length === 0) { skipped.push({ kind: 'enzymeSet', name: set.name }); continue }
        if (missing.length > 0) {
          enzymeLines.push(`${count(missing.length, 'enzyme', 'enzymes')} of "${set.name}" not in the enzyme database, so left out (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ', …' : ''})`)
        }
        if (store().enzymeSets.some(s => s.name === set.name && s.enzymes.join() === known.join())) { setsAlready++; continue }
        store().addEnzymeSet(set.name, known)
        setsSaved++
      }
      const uids = [
        ...tabIds.map(id => store().tabs.find(t => t.id === id)).filter(t => t !== undefined)
          .map(t => toUid(t.doc.sequence.alphabet === 'protein' ? 'protein' : 'sequence', t.id)),
        ...readIds.map(id => toUid('read', id)),
        ...alignmentIds.map(id => toUid('alignment', id)),
        ...oligoIds.map(id => toUid('oligo', id)),
      ]
      if (uids.length > 1) {
        const folderId = store().createFolder(result.folder || source.replace(/\.[^.]+$/, ''), place?.() ?? null)
        for (const uid of uids) store().moveItemToFolder(uid, folderId)
      } else if (uids.length === 1) {
        const folder = place?.()
        if (folder) store().moveItemToFolder(uids[0], folder)
      }
      report.opened(uids.length)
      // A structure opened last is the open item: show it as one.
      if (docs.length > 0 && docs[docs.length - 1].metadata?.structure) store().setViewMode('structure')

      const proteins = docs.filter(d => d.sequence.alphabet === 'protein').length
      const opened: string[] = []
      if (docs.length > proteins) opened.push(count(docs.length - proteins, 'sequence', 'sequences'))
      if (proteins > 0) opened.push(count(proteins, 'protein', 'proteins'))
      if (readIds.length > 0) opened.push(count(readIds.length, 'chromatogram', 'chromatograms'))
      if (alignmentIds.length > 0) opened.push(count(alignmentIds.length, 'alignment', 'alignments'))
      const lines = [...describeSkipped(skipped), ...enzymeLines]
      const already = result.oligos.length - oligoIds.length
      if (already > 0) lines.unshift(`${count(already, 'oligo was', 'oligos were')} already in the primer library`)
      if (setsAlready > 0) lines.unshift(`${count(setsAlready, 'enzyme set was', 'enzyme sets were')} already saved`)
      const detail = lines.length > 0 ? lines.join('\n') : undefined
      // Genome links are listed on request, each a click from the Fetch
      // dialog; the notice stays up until it is dismissed so the list can be had.
      const links = skipped.filter(s => s.kind === 'genome' && s.accession)
      const linkOptions = links.length > 0
        ? { action: { label: 'Show links', onClick: () => handlers.current.onGenomeLinks(source, links) }, duration: 0 }
        : {}

      const extras: string[] = []
      if (oligoIds.length > 0) extras.push(`${count(oligoIds.length, 'oligo', 'oligos')} added to the primer library`)
      if (setsSaved > 0) extras.push(`${count(setsSaved, 'enzyme set', 'enzyme sets')} saved`)
      if (opened.length === 0 && extras.length === 0) {
        if ((already > 0 || setsAlready > 0) && skipped.length === 0) report.info(`Nothing new in "${source}"`, { detail })
        else report.error(`Nothing in "${source}" could be opened`, { detail, ...linkOptions })
        return
      }
      const message = opened.length === 0
        ? `${extras.join('; ')} from "${source}"`
        : `Opened ${listed(opened)} from "${source}"${extras.map(e => `; ${e}`).join('')}`
      if (lines.length > 0) report.warning(message, { detail, ...linkOptions })
      else if (uids.length > 1 || setsSaved > 0) report.success(message)
    })
  }, [openRecordsAsking, openDocumentState, addAlignment])

  // Per file, summed for the one progress bar: with a single value, the
  // first of several files to finish hid the bar while the rest still ran.
  const parsing = useRef(new Map<File, { bytesRead: number; totalBytes: number }>())
  const [parseProgress, setParseProgress] = useState<{ bytesRead: number; totalBytes: number; files: number } | null>(null)
  const trackParse = useCallback((file: File, p: { bytesRead: number; totalBytes: number } | null) => {
    if (p) parsing.current.set(file, p)
    else parsing.current.delete(file)
    const all = [...parsing.current.values()]
    setParseProgress(all.length === 0 ? null : {
      bytesRead: all.reduce((n, x) => n + x.bytesRead, 0),
      totalBytes: all.reduce((n, x) => n + x.totalBytes, 0),
      files: all.length,
    })
  }, [])

  /** Open one file. Resolves when its items are open (or it has failed and said why). */
  const handleFileOpen = useCallback((given: File, ctx: OpenContext = {}): Promise<void> => {
    const report = ctx.report ?? directReporter
    // Named, so a gzipped file can open what is inside it the same way.
    const run = async (file: File): Promise<void> => {
      const fail = (err?: unknown) => report.error(`Could not read "${file.name}"`, { detail: errorDetail(err) })
      if (!canOpen(file.name)) {
        report.error(`Can't open "${file.name}"`, { detail: SUPPORTED_FORMATS_HINT })
        return
      }

      try {
        // Gzipped records and references: unpacked, then opened as the file inside.
        if (COMPRESSED_RECORDS.test(file.name) || COMPRESSED_FASTA.test(file.name)) {
          const bytes = gunzipSync(new Uint8Array(await readFile(file, 'buffer')))
          await run(new File([bytes], file.name.replace(/\.gz$/i, '')))
          return
        }

        // Session file - route to session import flow (".JSON" too)
        if (/\.json$/i.test(file.name)) {
          const json = await readFile(file, 'text')
          // Quick check if it's a session file (has the format marker)
          if (json.includes('"seqnexus-session"')) {
            handlers.current.onSessionFile(file.name, json, importSessionFromJson(json))
          } else {
            report.error(`"${file.name}" is not a SeqNexus session file`)
          }
          return
        }

        if (/\.(pdb|ent|cif|mmcif)$/i.test(file.name)) {
          // A structure: each distinct protein chain opens as a protein with
          // the structure attached, shown in the 3D view.
          const base = file.name.replace(/\.[^.]+$/, '')
          const docs = proteinsFromStructure(await structureFromFile(file.name, await readFile(file, 'text')), base)
          if (docs.length === 0) {
            report.error(`"${file.name}" has no protein chains`, { detail: 'Nucleic acids, ligands and waters are not opened as sequences.' })
            return
          }
          openDocsInFolder(docs, file.name, base, { noun: 'proteins', ...ctx })
          useEditorStore.getState().setViewMode('structure')
          return
        }

        if (GENBANK_FILE.test(file.name)) {
          // GenBank or GenPept - streaming parser for large files (supports multi-record)
          trackParse(file, { bytesRead: 0, totalBytes: file.size })
          try {
            const { docs, warnings } = await parseGenbankFile(file, p => trackParse(file, p))
            reportGenBankWarnings(file.name, warnings, report)
            openDocsInFolder(docs, file.name, file.name.replace(/\.[^.]+$/, ''), ctx)
          } finally {
            trackParse(file, null)
          }
          return
        }

        if (/\.dna$/i.test(file.name)) {
          // SnapGene binary format
          const doc = parseSnapGene(await readFile(file, 'buffer'))
          openDocsInFolder([{ ...doc, metadata: { ...doc.metadata, origin: 'snapgene' } }], file.name, file.name.replace(/\.[^.]+$/, ''), ctx)
          return
        }

        if (/\.geneious$/i.test(file.name)) {
          // A Geneious folder export: every document in it, each as what it is.
          await openGeneious(readGeneious(await readFile(file, 'buffer')), file.name, ctx)
          return
        }

        if (isTraceFile(file.name)) {
          // Sanger chromatogram (.ab1/.scf). Batches go through handleFilesOpen.
          await importTraceFiles([file], { folder: ctx.place })
          return
        }

        if (/\.(fastq|fq)$/i.test(file.name)) {
          // FASTQ. Opened as plain sequences, not chromatograms: the format
          // carries quality scores but no trace, and fabricating one would show
          // the user a peak plot that never existed. Mean quality is kept in the
          // description so the information is reported rather than dropped.
          const defaultName = file.name.replace(/\.[^.]+$/, '')
          const records = parseFastq(await readFile(file, 'text'))
          if (records.length === 0) {
            report.error(`No reads found in "${file.name}"`)
            return
          }
          const docs: DocumentState[] = records.map(rec => ({
            name: rec.name || defaultName,
            description: `FASTQ read · ${rec.bases.length} bp · mean Q${meanQuality(rec.qualityScores)}`,
            sequence: new Sequence(rec.bases, 'linear'),
            annotations: [],
          }))
          openDocsInFolder(docs, file.name, defaultName, { noun: 'reads', ...ctx })
          return
        }

        // FASTA, plain text, EMBL, GFF3 or an alignment
        openText(await readFile(file, 'text'), file.name, false, ctx)
      } catch (err) {
        fail(err)
      }
    }
    return run(given)
  }, [openText, openDocsInFolder, openGeneious, trackParse])

  /**
   * Open several files. Sanger traces are imported together, so a plate
   * lands in one folder with one summary instead of a toast per well; the
   * rest report once, in one summary, when there is more than one.
   */
  const handleFilesOpen = useCallback((given: File[], opts: ImportOptions = {}) => {
    let all = withoutCompanions(given.filter(f => !isSystemFile(f.name)))
    // Several files at once (a folder, most often) get one notice for what
    // could not be opened: a toast per file pushed the import's own summary
    // off screen. A single file keeps its own message from handleFileOpen.
    if (given.length > 1) {
      const unsupported = all.filter(f => !canOpen(f.name))
      if (unsupported.length > 0) {
        const names = unsupported.map(f => f.name)
        notify.warning(`Skipped ${unsupported.length} ${unsupported.length === 1 ? 'file' : 'files'} that SeqNexus cannot open`, {
          detail: `${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''}\n${SUPPORTED_FORMATS_HINT}`,
        })
      }
      all = all.filter(f => canOpen(f.name))
    }

    // Directories become folders, made as their first item is filed.
    const folders = folderMaker(opts.into ?? null)
    const pathOf = (f: File) => opts.paths?.get(f) ?? (f.webkitRelativePath || f.name)
    const placeOf = (f: File): Place => folders.placeFor(pathOf(f))

    // Read alignments become mappings, through a dialog that picks their references.
    const mapped = all.filter(f => MAPPED_READS.test(f.name))
    if (mapped.length > 0) handlers.current.onAlignmentFiles(mapped, placeOf)
    const files = all.filter(f => !mapped.includes(f))

    // Chromatograms: one batch per directory, filed into its folder.
    const traceGroups = new Map<string, File[]>()
    for (const f of files.filter(f => isTraceFile(f.name))) {
      const key = directoryOf(pathOf(f)).join('/')
      traceGroups.set(key, [...(traceGroups.get(key) ?? []), f])
    }
    for (const group of traceGroups.values()) {
      const place = placeOf(group[0])
      // With no folder to go to, a plate gets a folder of its own, as before.
      const hasFolder = opts.into != null || directoryOf(pathOf(group[0])).length > 0
      void importTraceFiles(group, hasFolder ? { folder: place } : {})
    }

    // NGS reads go to the import dialog as read sets. A small uncompressed
    // FASTQ is opened as sequences, as before, unless it holds many records;
    // a gzipped FASTA of a few sequences is a reference and opens as one.
    const gzFasta = files.filter(f => COMPRESSED_FASTA.test(f.name))
    const ngs = files.filter(f => isNgsByName(f) && !gzFasta.includes(f))
    const smallFastq = files.filter(f => !isNgsByName(f) && /\.(fastq|fq)$/i.test(f.name))
    const direct = files.filter(f => !isTraceFile(f.name) && !ngs.includes(f) && !smallFastq.includes(f) && !gzFasta.includes(f))

    const batch = all.length > 1 ? batchReporter() : null
    const report = batch ?? directReporter
    let opened = direct.length
    const jobs: Promise<void>[] = direct.map(f => handleFileOpen(f, { place: placeOf(f), report }))
    if (ngs.length > 0 || smallFastq.length > 0 || gzFasta.length > 0) {
      jobs.push((async () => {
        const reads = [...ngs]
        for (const f of smallFastq) {
          const n = countRecords(await readFile(f, 'text').catch(() => ''))
          if (n > NGS_FEW_RECORDS) reads.push(f)
          else { opened++; await handleFileOpen(f, { place: placeOf(f), report }) }
        }
        for (const f of gzFasta) {
          if (await isCompressedReference(f)) { opened++; await handleFileOpen(f, { place: placeOf(f), report }) }
          else reads.push(f)
        }
        if (reads.length > 0) handlers.current.onReadFiles(reads, placeOf)
      })())
    }
    if (batch) void Promise.allSettled(jobs).then(() => batch.finish(opened))
  }, [handleFileOpen])

  /** Answered: the next file's question, if any, comes up. */
  const closeManyRecords = useCallback(() => setManyQueue(q => q.slice(1)), [])
  const manyRecords = manyQueue[0] ?? null

  /** Open pasted text, read the way a text file is. */
  const openPastedText = useCallback((text: string) => openText(text, 'Pasted', true), [openText])

  return { handleFileOpen, handleFilesOpen, openPastedText, parseProgress, manyRecords, closeManyRecords }

}
