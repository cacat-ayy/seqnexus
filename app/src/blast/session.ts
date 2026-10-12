/**
 * The BLAST drawer's state, the searches that run from it, and the hand-off
 * to NCBI's own site.
 *
 * Searches run at EMBL-EBI (see ebi.ts): since August 2026 NCBI's BLAST
 * server lets only NCBI's own pages read its answers, and EMBL-EBI answers
 * any page. A search outlives the drawer: it is started here, followed here
 * and kept on the document's tab here, whether the drawer is open, collapsed
 * or closed and whichever document is showing. One runs at a time.
 *
 * EMBL-EBI publishes no polling interval; its own sample clients check every
 * 3 seconds. The drawer checks after 5 seconds, then every 10, and every 30
 * once a search has queued for 10 minutes (EMBL-EBI's queue can be long), and
 * gives up following after two hours, leaving a link to the job.
 *
 * NCBI's collections (core_nt, RefSeq, nr) are reached by handing the search
 * to NCBI's site in a new tab, where it runs and shows its results; the
 * result file NCBI lets you download can then be brought back in.
 */

import { create } from 'zustand'
import { useEditorStore, selectionSegments } from '../store'
import { notify } from '../toast'
import { STORAGE_KEYS } from '../storage/keys'
import { ncbiTaxid } from '../fetch/ncbi'
import { submitEbi, ebiStatus, ebiResult, ebiJobError, ebiJobUrl } from './ebi'
import { parseEbiXml } from './ebi-parser'
import { parseBlastJson } from './parser'
import { DEFAULT_SETTINGS, entrezQuery, taxidIn, usesMatrix } from './params'
import { ncbiDatabaseFor } from './databases'
import { fingerprint, queryBases } from './query'
import {
  PROTEIN_QUERY_PROGRAMS, type BlastProgram, type BlastQuery, type BlastResult, type BlastSearch, type BlastSettings,
} from './types'

const FIRST_CHECK = 5_000
const POLL_INTERVAL = 10_000
const SLOW_POLL_INTERVAL = 30_000
const SLOW_AFTER = 10 * 60 * 1000
const GIVE_UP_AFTER = 2 * 60 * 60 * 1000
/** Times a finished result may fail to download before the search is given up. */
const MAX_FETCH_FAILURES = 3

/** The drawer's height when it has never been resized, and its bounds. */
export const DRAWER_DEFAULT_HEIGHT = 320
export const DRAWER_MIN_HEIGHT = 140

/** A search being run: what it is for, and how far it has got. */
export interface BlastRun {
  tabId: string
  queryName: string
  queryLabel: string
  program: string
  /** EMBL-EBI's job id, once it has one. */
  rid: string | null
  startedAt: number
  /** One line for the drawer: submitting, queued, running, retrying, fetching. */
  status: string
  /** When the next status check is due (ms since epoch), 0 while none is. */
  nextCheckAt: number
}

/** A query other than the document or its selection: a coding feature's translation, for blastp. */
export interface TranslationQuery {
  label: string
  protein: string
  query: BlastQuery
}

export type QuerySource = 'whole' | 'selection' | 'translation'

/** The settings as chosen in the drawer. */
export type SettingsDraft = BlastSettings

/** A search handed to NCBI's site, remembered so its result file can be placed on the sequence. */
interface NcbiHandoff {
  queryName: string
  query: BlastQuery
  settings: BlastSettings
  /** Bases or residues sent: the result file's query length is matched against this. */
  length: number
}

/** The settings last used, each field checked, the default standing in for anything unreadable. */
function savedDraft(): SettingsDraft {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.blastSettings) ?? 'null') as Partial<Record<keyof SettingsDraft, unknown>> | null
    if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS
    const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
    const num = (v: unknown, d: number) => {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
      return Number.isFinite(n) && n > 0 ? n : d
    }
    const low = raw.lowComplexity
    return {
      program: (typeof raw.program === 'string' ? raw.program : DEFAULT_SETTINGS.program) as BlastProgram,
      database: str(raw.database, DEFAULT_SETTINGS.database),
      evalue: num(raw.evalue, DEFAULT_SETTINGS.evalue),
      maxHits: num(raw.maxHits, DEFAULT_SETTINGS.maxHits),
      excludeSynthetic: raw.excludeSynthetic === true,
      organism: str(raw.organism, ''),
      matrix: str(raw.matrix, ''),
      lowComplexity: low === 'on' || low === 'off' ? low : 'default',
    }
  } catch { return DEFAULT_SETTINGS }
}

/** How many of the optional settings differ from their defaults, for the Options button. */
export function changedOptions(d: SettingsDraft): number {
  let n = 0
  if (d.evalue !== DEFAULT_SETTINGS.evalue) n++
  if (d.maxHits !== DEFAULT_SETTINGS.maxHits) n++
  if (d.excludeSynthetic) n++
  if (d.organism.trim()) n++
  if (d.matrix) n++
  if (d.lowComplexity !== 'default') n++
  return n
}

interface BlastUiState {
  run: BlastRun | null
  /** Why the last search failed, on the tab it was run from, with a link to the job when there is one. */
  failure: { tabId: string; message: string; url: string | null } | null
  /**
   * The search the drawer shows on each tab, by id; null shows none (a
   * search is being set up). A tab not listed shows its newest search.
   */
  shown: Record<string, string | null>
  /** Results came in while the drawer was closed, and have not been looked at. */
  unseen: boolean

  open: boolean
  collapsed: boolean
  maximized: boolean
  height: number

  querySource: QuerySource
  translation: TranslationQuery | null
  draft: SettingsDraft
  /** Searches handed to NCBI's site, newest last, per tab. */
  handoffs: Record<string, NcbiHandoff[]>
  /** Entries for the alignment dialog, waiting for App to open it. */
  alignRequest: AlignRequest | null
  /** Bumped to move focus to the Search button (after a feature asks to be searched). */
  focusRequest: number
}

function savedHeight(): number {
  try {
    const n = parseInt(localStorage.getItem(STORAGE_KEYS.blastDrawerHeight) ?? '', 10)
    return Number.isFinite(n) && n >= DRAWER_MIN_HEIGHT ? n : DRAWER_DEFAULT_HEIGHT
  } catch { return DRAWER_DEFAULT_HEIGHT }
}

export const useBlastStore = create<BlastUiState>(() => ({
  run: null,
  failure: null,
  shown: {},
  unseen: false,
  open: false,
  collapsed: false,
  maximized: false,
  height: savedHeight(),
  querySource: 'whole',
  translation: null,
  focusRequest: 0,
  draft: savedDraft(),
  handoffs: {},
  alignRequest: null,
}))

const set = useBlastStore.setState
const get = useBlastStore.getState

// --- Drawer ---

export function openDrawer(): void {
  set({ open: true, collapsed: false, unseen: false })
}

export function closeDrawer(): void {
  set({ open: false, maximized: false })
}

export function toggleDrawer(): void {
  if (get().open) closeDrawer()
  else openDrawer()
}

export function setCollapsed(collapsed: boolean): void {
  set({ collapsed, ...(collapsed ? { maximized: false } : {}) })
}

export function setMaximized(maximized: boolean): void {
  set({ maximized, ...(maximized ? { collapsed: false } : {}) })
}

export function setDrawerHeight(height: number): void {
  const h = Math.max(DRAWER_MIN_HEIGHT, Math.round(height))
  set({ height: h })
  try { localStorage.setItem(STORAGE_KEYS.blastDrawerHeight, String(h)) } catch { /* quota: the height is a nicety */ }
}

/** Show one of a tab's searches, or none (null) to set up a new one. */
export function showSearch(tabId: string, rid: string | null): void {
  set(s => ({ shown: { ...s.shown, [tabId]: rid } }))
}

/** Change the settings, kept for the next session as they are chosen. */
export function updateDraft(patch: Partial<SettingsDraft>): void {
  const draft = { ...get().draft, ...patch }
  set({ draft })
  try { localStorage.setItem(STORAGE_KEYS.blastSettings, JSON.stringify(draft)) } catch { /* quota: settings are a nicety */ }
}

/** Put every optional setting back to its default, keeping the program and database. */
export function resetOptions(): void {
  const { program, database } = get().draft
  updateDraft({ ...DEFAULT_SETTINGS, program, database })
}

export function setQuerySource(source: QuerySource): void {
  set({ querySource: source, ...(source !== 'translation' ? { translation: null } : {}) })
}

/**
 * Open the drawer ready to search the selection (a feature asked to be
 * BLASTed: it has been selected), with the Search button focused.
 */
export function prepareSelectionSearch(tabId: string): void {
  set(s => ({ querySource: 'selection', translation: null, focusRequest: s.focusRequest + 1, shown: { ...s.shown, [tabId]: null } }))
  openDrawer()
}

/** Open the drawer ready to search a coding feature's translation with blastp. */
export function prepareTranslationSearch(tabId: string, translation: TranslationQuery): void {
  set(s => ({ querySource: 'translation', translation, focusRequest: s.focusRequest + 1, shown: { ...s.shown, [tabId]: null } }))
  openDrawer()
}

// --- Running a search at EMBL-EBI ---

let token = 0
let pollTimer: ReturnType<typeof setTimeout> | null = null

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

function patchRun(patch: Partial<BlastRun>) {
  const run = get().run
  if (run) set({ run: { ...run, ...patch } })
}

export interface BlastRequest {
  tabId: string
  queryName: string
  /** The bases or residues sent. */
  sequence: string
  query: BlastQuery
  settings: BlastSettings
}

/** Start a search. A search already running is no longer followed: there is one at a time. */
export async function startBlast(req: BlastRequest): Promise<void> {
  stopPolling()
  const mine = ++token
  const stale = () => mine !== token
  set({
    failure: null,
    run: {
      tabId: req.tabId, queryName: req.queryName, queryLabel: req.query.label, program: req.settings.program,
      rid: null, startedAt: Date.now(), status: 'Submitting the search to EMBL-EBI', nextCheckAt: 0,
    },
  })

  const fail = (message: string, jobId: string | null) => {
    stopPolling()
    set({ run: null, failure: { tabId: req.tabId, message, url: jobId ? ebiJobUrl(jobId) : null } })
  }

  // EMBL-EBI limits a search by taxid only: a name is looked up first.
  let taxid: string | null = null
  if (req.settings.organism.trim()) {
    taxid = taxidIn(req.settings.organism)
    if (!taxid) {
      patchRun({ status: `Looking up ${req.settings.organism.trim()} in NCBI Taxonomy` })
      try {
        taxid = await ncbiTaxid(req.settings.organism)
      } catch (err) {
        if (!stale()) fail(err instanceof Error ? err.message : 'The organism could not be looked up.', null)
        return
      }
      if (stale()) return
    }
  }

  let jobId: string
  try {
    jobId = await submitEbi({ ...req.settings, query: req.sequence }, taxid)
  } catch (err) {
    if (!stale()) fail(err instanceof Error ? err.message : 'The search could not be submitted to EMBL-EBI.', null)
    return
  }
  if (stale()) return
  patchRun({ rid: jobId, status: 'Queued at EMBL-EBI' })

  const schedule = (ms: number) => {
    patchRun({ nextCheckAt: Date.now() + ms })
    pollTimer = setTimeout(check, ms)
  }
  const nextInterval = () => (Date.now() - (get().run?.startedAt ?? Date.now()) > SLOW_AFTER ? SLOW_POLL_INTERVAL : POLL_INTERVAL)

  let fetchFailures = 0
  const check = async () => {
    pollTimer = null
    if (stale()) return
    patchRun({ nextCheckAt: 0 })
    const run = get().run
    if (run && Date.now() - run.startedAt > GIVE_UP_AFTER) {
      fail('The search was still not done after two hours and is no longer followed here. It may still finish at EMBL-EBI.', jobId)
      return
    }

    let status
    try {
      status = await ebiStatus(jobId)
    } catch (err) {
      console.warn('BLAST status error:', err)
      if (stale()) return
      patchRun({ status: 'Connection problem, retrying' })
      schedule(nextInterval())
      return
    }
    if (stale()) return
    if (status === 'ERROR' || status === 'FAILURE' || status === 'NOT_FOUND') {
      const reason = status === 'NOT_FOUND' ? null : await ebiJobError(jobId)
      if (stale()) return
      fail(status === 'NOT_FOUND'
        ? 'EMBL-EBI no longer knows this search.'
        : `EMBL-EBI could not run the search${reason ? `: ${reason}` : '.'}`, jobId)
      return
    }
    if (status !== 'FINISHED') {
      patchRun({ status: status === 'QUEUED' ? 'Queued at EMBL-EBI' : 'Running at EMBL-EBI' })
      schedule(nextInterval())
      return
    }

    patchRun({ status: 'Fetching the results' })
    let xml: string
    try {
      xml = await ebiResult(jobId, 'xml')
    } catch (err) {
      if (stale()) return
      if (++fetchFailures >= MAX_FETCH_FAILURES) {
        fail(`The results could not be downloaded (${err instanceof Error ? err.message : 'network error'}).`, jobId)
      } else {
        patchRun({ status: 'Could not download the results, retrying' })
        schedule(POLL_INTERVAL)
      }
      return
    }
    if (stale()) return

    let result: BlastResult
    try {
      result = parseEbiXml(xml, req.settings.program, req.settings.database)
    } catch (err) {
      fail(`EMBL-EBI's results could not be read (${err instanceof Error ? err.message : 'unknown format'}).`, jobId)
      return
    }
    finish(req, jobId, result)
  }

  schedule(FIRST_CHECK)
}

/** Keep the finished search with its document and show it there. */
function finish(req: BlastRequest, jobId: string, result: BlastResult) {
  stopPolling()
  const search: BlastSearch = {
    rid: jobId, service: 'ebi', createdAt: Date.now(), queryName: req.queryName,
    settings: req.settings, query: req.query, result,
  }
  const editor = useEditorStore.getState()
  const tab = editor.tabs.find(t => t.id === req.tabId)
  set(s => ({ run: null, shown: { ...s.shown, [req.tabId]: jobId }, unseen: !s.open }))
  if (!tab) {
    notify.warning(`The BLAST results for ${req.queryName} came in after it was closed`, {
      detail: `They can still be opened at EMBL-EBI for a while: ${ebiJobUrl(jobId)}`, duration: 0,
    })
    return
  }
  editor.addBlastSearch(req.tabId, search)
  if (!get().open) {
    const hits = result.hits.length
    notify.success(`BLAST found ${hits} ${hits === 1 ? 'hit' : 'hits'} for ${req.queryName}`, {
      action: {
        label: 'Show',
        onClick: () => {
          if (useEditorStore.getState().activeTabId !== req.tabId) useEditorStore.getState().setActiveTab(req.tabId)
          openDrawer()
        },
      },
    })
  }
}

/** Stop following the running search. EMBL-EBI finishes it anyway; nothing is kept. */
export function cancelBlast(): void {
  token++
  stopPolling()
  set({ run: null })
}

/** Forget the last failure (the user dismissed it, or started over). */
export function clearFailure(): void {
  set({ failure: null })
}

// --- Handing a search to NCBI's site ---

const NCBI_BLAST_URL = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi'

/**
 * Run the search on NCBI's own site, in a new tab, against NCBI's standard
 * collection (core_nt, or nr for a protein database). NCBI's search form
 * submits with CMD=Request, which starts the search at once and leads to
 * NCBI's usual results page; a form posted from the page is a navigation,
 * which NCBI's August 2026 restriction does not touch. Must be called from a
 * click, or a popup blocker may stop the new tab.
 */
export function searchAtNcbi(req: BlastRequest): void {
  const { settings: s } = req
  const program = s.program
  const fields: Record<string, string> = {
    CMD: 'Request',
    PAGE_TYPE: 'BlastSearch',
    PROGRAM: program === 'megablast' ? 'blastn' : program,
    DATABASE: ncbiDatabaseFor(program),
    QUERY: `>${req.queryName} ${req.query.label}\n${req.sequence}`,
    EXPECT: String(s.evalue),
    HITLIST_SIZE: String(s.maxHits),
    MAX_NUM_SEQ: String(s.maxHits),
    JOB_TITLE: `${req.queryName}: ${req.query.label}`,
  }
  if (program === 'megablast') fields.MEGABLAST = 'on'
  const entrez = entrezQuery(s)
  if (entrez) fields.ENTREZ_QUERY = entrez
  if (s.matrix && usesMatrix(program)) fields.MATRIX_NAME = s.matrix
  if (s.lowComplexity !== 'default') fields.FILTER = s.lowComplexity === 'on' ? 'L' : 'F'

  const form = document.createElement('form')
  form.method = 'POST'
  form.action = NCBI_BLAST_URL
  form.target = '_blank'
  form.rel = 'noopener'
  form.style.display = 'none'
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
  form.remove()

  const handoff: NcbiHandoff = {
    queryName: req.queryName, query: req.query, length: req.sequence.length,
    settings: { ...s, database: ncbiDatabaseFor(program) },
  }
  set(st => ({ handoffs: { ...st.handoffs, [req.tabId]: [...(st.handoffs[req.tabId] ?? []), handoff].slice(-10) } }))
}

/**
 * Bring in a result file downloaded from NCBI's site (Download All, then
 * Single-file JSON) as one of the open sequence's searches.
 *
 * The file says how long the query was but not where it lay in the sequence,
 * so it is matched, in this order, to the latest search handed to NCBI from
 * this sequence with the same length, then to the whole sequence, then to the
 * selection. A file that matches none is kept and read, but its hits are not
 * placed on the sequence.
 */
export function importNcbiResult(tabId: string, text: string): BlastSearch {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This is not a JSON file. On NCBI\'s results page, choose Download All, then Single-file JSON.')
  }
  const result = parseBlastJson(raw)
  const editor = useEditorStore.getState()
  const tab = editor.tabs.find(t => t.id === tabId)
  if (!tab) throw new Error('The sequence to add the result to is no longer open.')
  const doc = tab.doc
  const program = (result.program || 'blastn') as BlastProgram

  const handoff = [...(get().handoffs[tabId] ?? [])].reverse().find(h => h.length === result.queryLen)
  let query: BlastQuery
  let settings: BlastSettings
  if (handoff) {
    query = handoff.query
    settings = handoff.settings
  } else {
    settings = { ...DEFAULT_SETTINGS, program, database: result.database || ncbiDatabaseFor(program), maxHits: result.hits.length || DEFAULT_SETTINGS.maxHits }
    const seq = doc.sequence
    const protein = PROTEIN_QUERY_PROGRAMS.includes(program)
    const selSegs = selectionSegments(tab.selection, seq.topology, seq.length)
    const selLen = selSegs.reduce((n, [s, e]) => n + e - s, 0)
    const asQuery = (label: string, segments: [number, number][]): BlastQuery =>
      ({ label, segments, seqLength: seq.length, fingerprint: fingerprint(queryBases(seq, segments)) })
    if (result.queryLen === seq.length && protein === (seq.alphabet === 'protein')) query = asQuery('Whole sequence', [[0, seq.length]])
    else if (selLen > 0 && result.queryLen === selLen) query = asQuery('Selection', selSegs.map(([s, e]) => [s, e]))
    else query = { label: 'Imported from NCBI', segments: [], seqLength: seq.length, fingerprint: '' }
  }
  const search: BlastSearch = {
    rid: `ncbi-${Date.now().toString(36)}`, service: 'ncbi', createdAt: Date.now(),
    queryName: handoff?.queryName ?? doc.name, settings, query, result,
  }
  editor.addBlastSearch(tabId, search)
  showSearch(tabId, search.rid)
  return search
}

// --- Handing a hit to the alignment workbench ---

export interface AlignRequest {
  entries: { id: string; name: string; bases: string; source: 'pasted' }[]
}

/** Ask App to open the alignment dialog with these entries (App owns that dialog). */
export function requestAlignment(entries: AlignRequest['entries']): void {
  useBlastStore.setState({ alignRequest: { entries } })
}

export function clearAlignRequest(): void {
  useBlastStore.setState({ alignRequest: null })
}
