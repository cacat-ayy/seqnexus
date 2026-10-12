/**
 * What can be done with a BLAST hit beyond reading it: open its record as a
 * document, align it with the query, copy or download it.
 */

import { useEditorStore } from '../store'
import { notify } from '../toast'
import { fetchNCBI } from '../fetch/ncbi'
import { fetchUniProt } from '../fetch/uniprot'
import { parseGenbankFile } from '../workers/genbank-parser'
import { copyText } from '../utils/clipboard'
import { downloadText } from '../utils/download'
import { queryBases } from './query'
import { formatEvalue } from './format'
import { uniprotFromAlphaFold } from './databases'
import { importNcbiResult, openDrawer } from './session'
import { hitsAreProtein, type BlastHit, type BlastSearch } from './types'

/** Records longer than this are confirmed before they are fetched, as in the Fetch dialog. */
const LARGE_RECORD = 10_000_000

/** A hit's best HSP's subject, ungapped: the stretch of the record that aligned. */
function alignedSubject(hit: BlastHit): string {
  return (hit.hsps[0]?.hseq ?? '').replace(/[-.]/g, '')
}

/** "ACC:from-to" for the stretch of a hit's record its best HSP covers. */
function subjectRange(hit: BlastHit): string {
  const h = hit.hsps[0]
  return h ? `${hit.accession}:${h.hitFrom}-${h.hitTo}` : hit.accession
}

function fastaRecord(header: string, seq: string): string {
  const lines = seq.match(/.{1,70}/g) ?? ['']
  return `>${header}\n${lines.join('\n')}\n`
}

/** The aligned stretch of each hit as FASTA, in the order given. */
export function hitsFasta(hits: BlastHit[]): string {
  return hits.map(h => fastaRecord(
    `${subjectRange(h)} ${h.description}${h.sciName ? ` [${h.sciName}]` : ''}`,
    alignedSubject(h),
  )).join('')
}

const csvCell = (v: string | number) => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The hit table as CSV: one row per hit, its best HSP's numbers, coverage over all of them. */
export function hitsCsv(search: BlastSearch): string {
  const head = [
    'Accession', 'Description', 'Organism', 'Max score (bits)', 'E-value', 'Identity (%)', 'Query coverage (%)',
    'Alignment length', 'Query from', 'Query to', 'Subject from', 'Subject to', 'Subject strand', 'Subject length', 'HSPs',
  ]
  const rows = search.result.hits.map(h => {
    const b = h.hsps[0]
    return [
      h.accession, h.description, h.sciName, b ? Math.round(b.bitScore) : '', b ? formatEvalue(b.evalue) : '',
      (h.topIdentity * 100).toFixed(1), (h.queryCoverage * 100).toFixed(0), b?.alignLen ?? '',
      b?.queryFrom ?? '', b?.queryTo ?? '', b?.hitFrom ?? '', b?.hitTo ?? '',
      b ? (b.hitStrand > 0 ? 'Plus' : 'Minus') : '', h.length, h.hsps.length,
    ].map(csvCell).join(',')
  })
  return [head.join(','), ...rows].join('\n') + '\n'
}

/** A file name from a search: the sequence, the program, the kind of file. */
export function searchFileName(search: BlastSearch, ext: string): string {
  const base = `${search.queryName} BLAST ${search.settings.program}`.replace(/[\\/:*?"<>|]+/g, '_').trim()
  return `${base}.${ext}`
}

export function copyHitFasta(hit: BlastHit): void {
  copyText(hitsFasta([hit]), `Copied ${hit.accession} as FASTA`)
}

export function downloadHitsFasta(search: BlastSearch, hits: BlastHit[]): void {
  downloadText(hitsFasta(hits), searchFileName(search, 'fasta'))
}

export function downloadHitsCsv(search: BlastSearch): void {
  downloadText(hitsCsv(search), searchFileName(search, 'csv'), 'text/csv')
}

/** Whether a search's hits can be opened as documents: not a structure archive's entries. */
export function canOpenRecord(search: BlastSearch): boolean {
  return search.service === 'ncbi' || search.result.database !== 'pdb'
}

/**
 * Fetch a hit's record and open it as a document of its own: a nucleotide
 * hit from NCBI (ENA's accessions are the same INSDC accessions, so one
 * fetch serves both services), a UniProt or AlphaFold DB hit from UniProt, a
 * protein hit of an NCBI search from NCBI. A record over 10 Mb (a
 * chromosome) is fetched only once confirmed.
 */
export async function openHitRecord(hit: BlastHit, search: BlastSearch, confirmed = false): Promise<void> {
  if (!confirmed && hit.length > LARGE_RECORD) {
    notify.info(`${hit.accession} is ${(hit.length / 1e6).toFixed(1)} Mb`, {
      detail: 'Opening it downloads the whole record and can take a while.',
      action: { label: 'Open anyway', onClick: () => { void openHitRecord(hit, search, true) } },
      duration: 0,
    })
    return
  }
  const program = search.result.program
  const protein = hitsAreProtein(program)
  const fromUniProt = protein && search.service === 'ebi'
  const key = `blast-open-${hit.accession}`
  notify.info(`Fetching ${hit.accession} from ${fromUniProt ? 'UniProt' : 'NCBI'}`, { key })
  try {
    if (fromUniProt) {
      const doc = await fetchUniProt(search.result.database === 'afdb' ? uniprotFromAlphaFold(hit.accession) : hit.accession)
      useEditorStore.getState().openDocumentState(doc)
    } else {
      const db = protein ? 'protein' : 'nucleotide'
      const text = await fetchNCBI(hit.accession, db)
      const { docs } = await parseGenbankFile(new File([text], `${hit.accession}.${db === 'protein' ? 'gp' : 'gb'}`))
      const doc = docs[0]
      if (!doc) throw new Error('The record could not be read')
      useEditorStore.getState().openDocumentState({ ...doc, metadata: { ...doc.metadata, origin: doc.metadata?.origin ?? 'ncbi' } })
    }
    notify.success(`Opened ${hit.accession}`, { key })
  } catch (err) {
    notify.error(`${hit.accession} could not be opened`, {
      detail: err instanceof Error ? err.message : String(err),
      key,
    })
  }
}

/**
 * Pick a result file downloaded from NCBI's site and bring it in as one of
 * the open sequence's searches (see importNcbiResult).
 */
export function importNcbiResultFile(tabId: string): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const search = importNcbiResult(tabId, await file.text())
      const hits = search.result.hits.length
      notify.success(`Imported ${hits} ${hits === 1 ? 'hit' : 'hits'} from NCBI`, search.query.segments.length > 0
        ? { detail: `Matched to ${search.query.label.toLowerCase()}.` }
        : { detail: 'Its query could not be matched to this sequence, so the hits are listed but not placed on it.' })
      openDrawer()
    } catch (err) {
      notify.error(`${file.name} could not be imported`, { detail: err instanceof Error ? err.message : String(err) })
    }
  }
  input.click()
}

/**
 * Whether a hit can be aligned with its query in the alignment workbench:
 * both must be the same kind of sequence (blastn and megablast, blastp, or a
 * coding feature's translation against proteins).
 */
export function canAlignWithQuery(search: BlastSearch): boolean {
  const p = search.settings.program
  if (search.query.translation) return p === 'blastp'
  return p === 'blastn' || p === 'megablast' || p === 'blastp'
}

/** The query and a hit's aligned stretch, as the alignment dialog takes them. */
export function alignmentEntries(search: BlastSearch, hit: BlastHit): { id: string; name: string; bases: string; source: 'pasted' }[] | null {
  if (!canAlignWithQuery(search)) return null
  const query = search.query.translation?.protein
    ?? queryBases(useEditorStore.getState().doc.sequence, search.query.segments)
  const stamp = Date.now()
  return [
    { id: `blast_q_${stamp}`, name: `${search.queryName} (${search.query.label})`, bases: query, source: 'pasted' },
    { id: `blast_h_${stamp}`, name: subjectRange(hit), bases: alignedSubject(hit), source: 'pasted' },
  ]
}
