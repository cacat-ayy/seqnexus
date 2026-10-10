/**
 * Opening files: which reader a file goes to by its name and contents, the
 * folder that a multi-record file lands in, and the hand-offs to the session,
 * read set and read alignment import dialogs. Shared by drag and drop, the
 * Open dialog and the explorer.
 */

import { useCallback, useRef, useState } from 'react'
import { useEditorStore } from '../store'
import type { DocumentState } from '../models/Document'
import { Sequence } from '../models/Sequence'
import { readFasta, type FastaRead } from '../io/fasta'
import { parseGenBankMulti } from '../io/genbank'
import { parseGenbankFile } from '../workers/genbank-parser'
import { parseSnapGene } from '../io/snapgene'
import { describeSkipped, readGeneious, type GeneiousImport, type GeneiousSkipped } from '../io/geneious'
import { resolveEnzymeNames } from '../enzymes/sets'
import { toUid } from '../explorer/types'
import { importTraceFiles, initialTrim, isTraceFile } from '../sanger/import'
import { parseFastq, meanQuality } from '../io/fastq'
import { countRecords, isNgsByName, NGS_FEW_RECORDS } from '../ngs/peek'
import { structureFromFile } from '../structure/sources'
import { proteinsFromStructure } from '../structure/attach'
import { isReadFile } from '../ngs/detect'
import { importSessionFromJson, type RestoredSession } from '../persistence'
import { ALIGNMENT_ONLY_EXTENSIONS, detectFormat, fastaLooksAligned, readAlignment } from '../msa/formats'
import { notify } from '../toast'

/** Every file extension the drop zone and the Open dialog accept. */
export const SUPPORTED_EXTENSIONS = /\.(gb|gbk|genbank|gp|gpt|genpept|pdb|ent|cif|mmcif|dna|geneious|fasta|fa|fas|fna|faa|fastq|fq|seq|txt|ab1|abi|abif|scf|json|aln|clustal|clw|phy|phylip|ph|nex|nexus|nxs|meg|mega|sto|stk|stockholm|pir|nbrf|ali|msf|afa|a2m|mfa)$/i
/** What a plain-text file has to look like to be read as bases or residues. */
const SEQUENCE_CHARS = /^[A-Za-z*\s\n\r>;.\-\d]+$/

export const SUPPORTED_FORMATS_HINT =
  'Supported: GenBank (.gb), GenPept (.gp), SnapGene (.dna), Geneious (.geneious), FASTA (.fasta, .fa, .faa), '
  + 'FASTQ (.fastq, .fq), AB1 (.ab1), SCF (.scf), plain text (.txt), structures (.pdb, .cif), read alignments (.bam, .sam), and alignments in '
  + 'Clustal (.aln), PHYLIP (.phy), NEXUS (.nex), MEGA (.meg), Stockholm (.sto), PIR (.pir) and MSF (.msf).'

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

/** Parser and reader failures, reduced to something fit for a detail line. */
export const errorDetail = (err: unknown): string | undefined =>
  err instanceof Error ? err.message : err ? String(err) : undefined

/** Tell the user about the FASTA records that were not opened: those with characters that are not sequence codes. */
export function reportFastaSkips(source: string, { unreadable }: FastaRead): void {
  if (unreadable.length > 0) {
    notify.warning(`${unreadable.length} record${unreadable.length === 1 ? '' : 's'} in "${source}" could not be read`, {
      detail: `They contain characters that are not sequence codes: ${unreadable.slice(0, 5).join(', ')}${unreadable.length > 5 ? ', …' : ''}`,
    })
  }
}

/** One standing notice for features a GenBank import couldn't take in as written. */
export function reportGenBankWarnings(source: string, warnings: string[]): void {
  if (warnings.length === 0) return
  const shown = warnings.slice(0, 5).join('\n')
  const more = warnings.length > 5 ? `\n…and ${warnings.length - 5} more` : ''
  notify.warning(
    `${warnings.length} ${warnings.length === 1 ? 'feature' : 'features'} in "${source}" could not be read exactly as written`,
    { detail: shown + more },
  )
}

export interface FileImportHandlers {
  /** A session file was read and parsed: show the import dialog for it. */
  onSessionFile: (filename: string, json: string, session: RestoredSession) => void
  /** NGS read files, and FASTQs with many records, go to the read set import dialog. */
  onReadFiles: (files: File[]) => void
  /** BAM and SAM files go to the read alignment import dialog. */
  onAlignmentFiles: (files: File[]) => void
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
  const openAlignmentFile = useCallback((text: string, fileName: string) => {
    try {
      const { doc, warnings } = readAlignment(text, fileName)
      addAlignment(doc, { name: fileName.replace(/\.[^.]+$/, '') })
      for (const w of warnings) notify.warning(w)
    } catch (err) {
      notify.error(`Could not read "${fileName}"`, { detail: errorDetail(err) })
    }
  }, [addAlignment])

  /**
   * A file with more records than this asks before opening: each record is a
   * tab, and a FASTQ of tens of thousands of reads would freeze the page.
   */
  const [manyRecords, setManyRecords] = useState<{ source: string; count: number; open: (n: number) => void } | null>(null)
  const openRecordsAsking = useCallback((source: string, count: number, open: (n: number) => void) => {
    if (count <= MANY_RECORDS) open(count)
    else setManyRecords({ source, count, open })
  }, [])

  /** Open records as tabs, several of them in one folder. */
  const openDocsInFolder = useCallback((docs: DocumentState[], source: string, folderName: string, noun = 'sequences') => {
    openRecordsAsking(source, docs.length, n => {
      const tabIds = docs.slice(0, n).map(d => openDocumentState(d))
      if (tabIds.length > 1) {
        const folderId = useEditorStore.getState().createFolder(folderName)
        for (const id of tabIds) useEditorStore.getState().moveTabToFolder(id, folderId)
        notify.success(`Opened ${tabIds.length.toLocaleString()} ${noun} from "${source}"`)
      }
    })
  }, [openRecordsAsking, openDocumentState])

  /**
   * Open what a Geneious export holds: its sequences as tabs and its oligos
   * in the primer library, filed together in a folder named after the
   * Geneious folder, with one summary of what was opened and what was not.
   */
  const openGeneious = useCallback(async (result: GeneiousImport, source: string) => {
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
      const count = (k: number, one: string, many: string) => `${k.toLocaleString()} ${k === 1 ? one : many}`
      const docs = sequences.slice(0, n)
      const tabIds = docs.map(d => openDocumentState(d))
      // Reads come in trimmed as they were in Geneious, or by quality when
      // they were not. Adding them makes one the open item; a sequence
      // opened from the same file stays the open one.
      const readIds = result.traces.length > 0
        ? store().addSequencingReads(result.traces.map(t => {
          const [trimStart, trimEnd] = t.trim ?? initialTrim(t.data)
          return { data: t.data, trimStart, trimEnd }
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
      const items = tabIds.length + readIds.length + alignmentIds.length + oligoIds.length
      if (items > 1) {
        const folderId = store().createFolder(result.folder || source.replace(/\.[^.]+$/, ''))
        for (const id of tabIds) store().moveTabToFolder(id, folderId)
        for (const id of readIds) store().moveItemToFolder(toUid('read', id), folderId)
        for (const id of alignmentIds) store().moveItemToFolder(toUid('alignment', id), folderId)
        for (const id of oligoIds) store().moveItemToFolder(toUid('oligo', id), folderId)
      }
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
        if ((already > 0 || setsAlready > 0) && skipped.length === 0) notify.info(`Nothing new in "${source}"`, { detail })
        else notify.error(`Nothing in "${source}" could be opened`, { detail, ...linkOptions })
        return
      }
      const message = opened.length === 0
        ? `${extras.join('; ')} from "${source}"`
        : `Opened ${listed(opened)} from "${source}"${extras.map(e => `; ${e}`).join('')}`
      if (lines.length > 0) notify.warning(message, { detail, ...linkOptions })
      else if (items > 1 || setsSaved > 0) notify.success(message)
    })
  }, [openRecordsAsking, openDocumentState, addAlignment])

  const [parseProgress, setParseProgress] = useState<{ bytesRead: number; totalBytes: number } | null>(null)

  const handleFileOpen = useCallback((file: File) => {
    // Validate file extension
    if (!SUPPORTED_EXTENSIONS.test(file.name) && !isReadFile(file.name)) {
      notify.error(`Can't open "${file.name}"`, { detail: SUPPORTED_FORMATS_HINT })
      return
    }

    // Session file - route to session import flow
    if (file.name.match(/\.seqnexus\.json$/i) || (file.name.endsWith('.json') && file.size > 0)) {
      const reader = new FileReader()
      reader.onload = () => {
        const json = reader.result as string
        // Quick check if it's a session file (has the format marker)
        if (json.includes('"seqnexus-session"')) {
          try {
            handlers.current.onSessionFile(file.name, json, importSessionFromJson(json))
          } catch (e) {
            notify.error(`Could not read "${file.name}"`, { detail: errorDetail(e) })
          }
        } else {
          notify.error(`"${file.name}" is not a SeqNexus session file`)
        }
      }
      reader.readAsText(file)
      return
    }

    if (file.name.match(/\.(pdb|ent|cif|mmcif)$/i)) {
      // A structure: each distinct protein chain opens as a protein with
      // the structure attached, shown in the 3D view.
      const reader = new FileReader()
      reader.onload = () => {
        const base = file.name.replace(/\.[^.]+$/, '')
        structureFromFile(file.name, String(reader.result)).then(fetched => {
          const docs = proteinsFromStructure(fetched, base)
          if (docs.length === 0) {
            notify.error(`"${file.name}" has no protein chains`, { detail: 'Nucleic acids, ligands and waters are not opened as sequences.' })
            return
          }
          openDocsInFolder(docs, file.name, base, 'proteins')
          useEditorStore.getState().setViewMode('structure')
        }).catch(err => notify.error(`Could not read "${file.name}"`, { detail: errorDetail(err) }))
      }
      reader.readAsText(file)
      return
    }

    if (file.name.match(/\.(gb|gbk|genbank|gp|gpt|genpept)$/i)) {
      // GenBank or GenPept - streaming parser for large files (supports multi-record)
      setParseProgress({ bytesRead: 0, totalBytes: file.size })
      parseGenbankFile(file, (p) => setParseProgress(p))
        .then(({ docs, warnings }) => {
          reportGenBankWarnings(file.name, warnings)
          openDocsInFolder(docs, file.name, file.name.replace(/\.[^.]+$/, ''))
          setParseProgress(null)
        })
        .catch((err) => {
          setParseProgress(null)
          notify.error(`Could not read "${file.name}"`, { detail: errorDetail(err) })
        })
    } else if (file.name.match(/\.dna$/i)) {
      // SnapGene binary format
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const doc = parseSnapGene(reader.result as ArrayBuffer)
          openDocumentState({ ...doc, metadata: { ...doc.metadata, origin: 'snapgene' } })
        } catch (err) {
          notify.error(`Could not read "${file.name}"`, { detail: errorDetail(err) })
        }
      }
      reader.onerror = () => notify.error(`Could not read "${file.name}"`)
      reader.readAsArrayBuffer(file)
    } else if (file.name.match(/\.geneious$/i)) {
      // A Geneious folder export: every document in it, each as what it is.
      const reader = new FileReader()
      reader.onload = () => {
        let result: GeneiousImport
        try {
          result = readGeneious(reader.result as ArrayBuffer)
        } catch (err) {
          notify.error(`Could not read "${file.name}"`, { detail: errorDetail(err) })
          return
        }
        void openGeneious(result, file.name)
      }
      reader.onerror = () => notify.error(`Could not read "${file.name}"`)
      reader.readAsArrayBuffer(file)
    } else if (isTraceFile(file.name)) {
      // Sanger chromatogram (.ab1/.scf). Batches go through handleFilesOpen.
      void importTraceFiles([file])
    } else if (file.name.match(/\.(fastq|fq)$/i)) {
      // FASTQ. Opened as plain sequences, not chromatograms: the format
      // carries quality scores but no trace, and fabricating one would show
      // the user a peak plot that never existed. Mean quality is kept in the
      // description so the information is reported rather than dropped.
      const reader = new FileReader()
      reader.onload = () => {
        const defaultName = file.name.replace(/\.[^.]+$/, '')
        let records
        try {
          records = parseFastq(reader.result as string)
        } catch (err) {
          notify.error(`Could not read "${file.name}"`, { detail: errorDetail(err) })
          return
        }
        if (records.length === 0) {
          notify.error(`No reads found in "${file.name}"`)
          return
        }

        const docs: DocumentState[] = records.map(rec => ({
          name: rec.name || defaultName,
          description: `FASTQ read · ${rec.bases.length} bp · mean Q${meanQuality(rec.qualityScores)}`,
          sequence: new Sequence(rec.bases, 'linear'),
          annotations: [],
        }))
        openDocsInFolder(docs, file.name, defaultName, 'reads')
      }
      reader.onerror = () => notify.error(`Could not read "${file.name}"`)
      reader.readAsText(file)
    } else {
      // FASTA, plain text, or an alignment
      const reader = new FileReader()
      reader.onload = () => {
        const text = reader.result as string
        if (looksLikeAlignmentFile(text, file.name)) {
          openAlignmentFile(text, file.name)
          return
        }
        const defaultName = file.name.replace(/\.[^.]+$/, '')

        // GenBank text, whatever the extension (.txt, .seq): read it as
        // GenBank, not as FASTA where every header line became "bases".
        if (text.trimStart().startsWith('LOCUS')) {
          const warnings: string[] = []
          const docs = parseGenBankMulti(text, warnings)
          reportGenBankWarnings(file.name, warnings)
          openDocsInFolder(docs, file.name, defaultName)
          return
        }

        // Validate content looks like sequence data (skip for FASTA)
        if (text.length > 0 && !SEQUENCE_CHARS.test(text) && !text.trimStart().startsWith('>')) {
          notify.error(`"${file.name}" does not look like sequence data`, { detail: 'Expected DNA, RNA or protein letters, FASTA, or GenBank.' })
          return
        }

        const read = readFasta(text, defaultName, /\.faa$/i.test(file.name))
        reportFastaSkips(file.name, read)
        const { records, proteins, unreadable } = read
        if (records.length === 0 && proteins.length === 0) {
          if (unreadable.length === 0) notify.error(`No sequence data found in "${file.name}"`)
          return
        }

        openDocsInFolder(
          [
            ...records.map(rec => ({ name: rec.name, sequence: new Sequence(rec.bases, 'linear'), annotations: [] })),
            ...proteins.map(rec => ({ name: rec.name, sequence: new Sequence(rec.bases, 'linear', 'protein'), annotations: [] })),
          ],
          file.name,
          defaultName,
        )
      }
      reader.onerror = () => notify.error(`Could not read "${file.name}"`)
      reader.readAsText(file)
    }
  }, [openDocumentState, openAlignmentFile, openDocsInFolder, openGeneious])

  /**
   * Open several files. Sanger traces are imported together, so a plate
   * lands in one folder with one summary instead of a toast per well.
   */
  const handleFilesOpen = useCallback((all: File[]) => {
    // Read alignments become mappings, through a dialog that picks their references.
    const mapped = all.filter(f => /\.(bam|sam)$/i.test(f.name))
    if (mapped.length > 0) handlers.current.onAlignmentFiles(mapped)
    const files = all.filter(f => !mapped.includes(f))
    const traces = files.filter(f => isTraceFile(f.name))
    if (traces.length > 0) void importTraceFiles(traces)
    // NGS reads go to the import dialog as read sets. A small uncompressed
    // FASTQ is opened as sequences, as before, unless it holds many records.
    const ngs = files.filter(isNgsByName)
    const smallFastq = files.filter(f => !isNgsByName(f) && /\.(fastq|fq)$/i.test(f.name))
    for (const f of files) {
      if (!isTraceFile(f.name) && !ngs.includes(f) && !smallFastq.includes(f)) handleFileOpen(f)
    }
    if (ngs.length === 0 && smallFastq.length === 0) return
    void (async () => {
      const many: File[] = []
      for (const f of smallFastq) {
        const n = countRecords(await f.text().catch(() => ''))
        if (n > NGS_FEW_RECORDS) many.push(f)
        else handleFileOpen(f)
      }
      const all = [...ngs, ...many]
      if (all.length > 0) handlers.current.onReadFiles(all)
    })()
  }, [handleFileOpen])

  const closeManyRecords = useCallback(() => setManyRecords(null), [])

  return { handleFileOpen, handleFilesOpen, parseProgress, manyRecords, closeManyRecords }

}
