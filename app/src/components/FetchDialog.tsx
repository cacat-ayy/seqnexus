import './FetchDialog.css'
/**
 * Modal for fetching sequences by accession: NCBI Nucleotide, NCBI Protein
 * (GenPept) and UniProtKB. The source is guessed from the accession's
 * shape as it is typed and can be overridden. Several accessions, separated
 * by commas or spaces, are fetched one after another. NCBI Gene IDs, ranges
 * of accessions, regions and reverse complements are written as in SnapGene
 * (see fetch/accessionQuery.ts).
 *
 * A single entry is looked up as it is typed (debounced), and the record's
 * title and length shown under the box, so a typo is caught before
 * anything is downloaded. The last few entries fetched are kept in this
 * browser and offered when the box is empty.
 *
 * Addgene and SnapGene were offered too, but neither site lets another
 * website download its files (no CORS), so those buttons failed every time.
 * The dialog now says how to get their files in instead.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { X } from 'lucide-react'
import { fetchNCBI, ncbiRecordSummary, looksLikeNcbiProtein, ncbiGene } from '../fetch/ncbi'
import type { NcbiGene, NcbiPart } from '../fetch/ncbi'
import { parseAccessionQuery } from '../fetch/accessionQuery'
import type { AccessionRequest } from '../fetch/accessionQuery'
import { fetchUniProt, looksLikeUniProt, uniProtSummary } from '../fetch/uniprot'
import { parseGenbankFile } from '../workers/genbank-parser'
import { notify } from '../toast'
import type { DocumentState } from '../models/Document'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { formatBp } from '../utils/format'
import { useBackdropDismiss } from '../hooks/useBackdropDismiss'

interface Props {
  open: boolean
  onClose: () => void
  /** Every record fetched, in the order asked for. */
  onFetched: (docs: DocumentState[]) => void
  /** An accession to start with, such as a genome link from an imported file. */
  initialQuery?: string
}

/** The wait after the last keystroke before an accession is looked up. */
const PREVIEW_DELAY_MS = 450
/** Accessions remembered for the empty box. */
const RECENT_MAX = 8
const RECENT_KEY = 'seqnexus.fetch.recent'

interface Recent { accession: string; title: string }

/** The accessions fetched lately. A convenience: storage that is blocked or cleared just means none. */
function loadRecent(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(list)
      ? list.filter((r): r is Recent => typeof r?.accession === 'string' && typeof r?.title === 'string').slice(0, RECENT_MAX)
      : []
  } catch {
    return []
  }
}

function saveRecent(fetched: Recent[]): Recent[] {
  const seen = new Set(fetched.map(r => r.accession.toUpperCase()))
  const next = [...fetched, ...loadRecent().filter(r => !seen.has(r.accession.toUpperCase()))].slice(0, RECENT_MAX)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* storage blocked: nothing remembered */ }
  return next
}

/** What a lookup of the typed entry found, or why it can't be fetched. */
type Preview =
  | { accession: string; status: 'loading' }
  | { accession: string; status: 'found'; title: string; length: number; unit: 'bp' | 'aa'; detail?: string }
  | { accession: string; status: 'missing'; message: string }

/** Records longer than this are confirmed before downloading. */
const LARGE_RECORD_BP = 10_000_000

type Source = 'nucleotide' | 'protein' | 'uniprot'

interface LargeRecord { accession: string; length: number; title: string }

const SOURCES: { id: Source; label: string; hint: string; placeholder: string }[] = [
  { id: 'nucleotide', label: 'NCBI Nucleotide', hint: 'Accession, Gene ID or region', placeholder: 'e.g. L09137.2, NM_006178, or Gene ID 672' },
  { id: 'protein', label: 'NCBI Protein', hint: 'Protein accession', placeholder: 'e.g. NP_000509.1, AAA59172.1' },
  { id: 'uniprot', label: 'UniProt', hint: 'UniProt accession or entry name', placeholder: 'e.g. P69905, HBA_HUMAN' },
]

/** The forms the box takes besides a plain accession, as SnapGene writes them. Clicking one fills the box. */
const FORMATS: { example: string; meaning: string }[] = [
  { example: 'NM_006178, NM_008740.4', meaning: 'several records' },
  { example: '672', meaning: 'a Gene ID (or LOC104244181): the gene\'s region of its chromosome' },
  { example: 'AF027958 - AF027961', meaning: 'every record from the first to the last' },
  { example: 'NC_000072: 122552252..122565735', meaning: 'part of a record' },
  { example: 'AL589148.1 (COMPLEMENT)', meaning: 'the reverse complement' },
  { example: 'CP002686: COMPLEMENT(2459491..2463965)', meaning: 'the reverse complement of part' },
]

/** Which source an accession's shape points to. */
function guessSource(text: string): Source {
  if (looksLikeUniProt(text)) return 'uniprot'
  if (looksLikeNcbiProtein(text)) return 'protein'
  return 'nucleotide'
}

/** Where an entry is fetched from: a Gene ID always from NCBI Nucleotide. */
function sourceOf(r: AccessionRequest, chosen: Source | null): Source {
  return r.gene ? 'nucleotide' : chosen ?? guessSource(r.id)
}

/** An entry made concrete: what to download, how long it is, and what to call it. */
interface Plan {
  request: AccessionRequest
  source: Source
  accession: string
  part: NcbiPart
  /** Bases or residues in the download, when known before it starts. */
  length?: number
  title?: string
  /** For a Gene ID: the gene, which names the document. */
  gene?: NcbiGene
}

/** A region as GenBank writes it: "NC_000072:122552252..122565735", "X:complement(1..9)", "X (complement)". */
function partLabel(name: string, part: NcbiPart): string {
  if (part.start === undefined) return `${name} (complement)`
  const span = `${part.start}..${part.end}`
  return `${name}:${part.complement ? `complement(${span})` : span}`
}

/**
 * Work out what an entry downloads, without downloading it: a Gene ID is
 * looked up for its place on the genome, an NCBI record's summary gives its
 * length and checks that it exists and that the region lies inside it.
 */
async function planFor(r: AccessionRequest, chosen: Source | null): Promise<Plan> {
  if (r.gene) {
    const gene = await ncbiGene(r.id)
    const part = { start: gene.start, end: gene.end, complement: gene.complement }
    const title = [`${gene.symbol}${gene.description ? `: ${gene.description}` : ''}`, gene.organism && `(${gene.organism})`].filter(Boolean).join(' ')
    return { request: r, source: 'nucleotide', accession: gene.accession, part, length: gene.end - gene.start + 1, title, gene }
  }
  const source = sourceOf(r, chosen)
  if (source === 'uniprot') {
    if (r.region || r.complement) throw new Error('A UniProt entry is fetched whole. Choose NCBI Protein for part of a protein record.')
    return { request: r, source, accession: r.id, part: {} }
  }
  if (source === 'protein' && r.complement) throw new Error('A protein has no reverse complement.')
  const unit = source === 'protein' ? 'aa' : 'bp'
  let summary: Awaited<ReturnType<typeof ncbiRecordSummary>>
  try {
    summary = await ncbiRecordSummary(r.id, source)
  } catch {
    // It throws only when NCBI says the accession does not exist.
    throw new Error(`No record ${r.id} in ${SOURCES.find(s => s.id === source)!.label}.`)
  }
  if (!r.region) return { request: r, source, accession: r.id, part: { complement: r.complement }, length: summary?.length, title: summary?.title }
  const { start } = r.region
  let { end } = r.region
  if (summary) {
    const total = summary.length
    if (start > total) throw new Error(`${r.id} is ${total.toLocaleString('en-US')} ${unit} long, so it has no position ${start.toLocaleString('en-US')}.`)
    // NCBI cuts a region that runs past the end short; the name says so too.
    end = Math.min(end, total)
  }
  return { request: r, source, accession: r.id, part: { start, end, complement: r.complement }, length: end - start + 1, title: summary?.title }
}

/** What the preview says about a region or a gene, under the title. */
function planDetail(plan: Plan): string | undefined {
  const { part } = plan
  if (plan.gene) return `From ${partLabel(plan.accession, part)}`
  if (part.start === undefined) return part.complement ? 'Reverse complement of the whole record' : undefined
  const span = `${part.start.toLocaleString('en-US')}..${part.end!.toLocaleString('en-US')}`
  return part.complement ? `Reverse complement of ${span}` : `Positions ${span}`
}

/** A fetched part or gene named for what was asked; a whole record keeps its own name. */
function namedFor(doc: DocumentState, plan: Plan): DocumentState {
  const { gene, part } = plan
  if (gene) {
    const about = [gene.description, gene.organism].filter(Boolean).join(', ')
    return { ...doc, name: gene.symbol, description: `${about ? `${about}; ` : ''}${partLabel(gene.accession, part)}` }
  }
  if (part.start !== undefined || part.complement) return { ...doc, name: partLabel(doc.name, part) }
  return doc
}

/**
 * An error in words a user can act on. A browser that cannot reach the
 * server at all says only "Failed to fetch".
 */
function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof TypeError && /fetch|network|load/i.test(message)) {
    return 'The server could not be reached. Check the connection and try again.'
  }
  return message
}

export default function FetchDialog({ open, onClose, onFetched, initialQuery }: Props) {
  const [query, setQuery] = useState('')
  /** The source chosen by hand; null follows the guess. */
  const [chosen, setChosen] = useState<Source | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Records over LARGE_RECORD_BP, waiting for the user to confirm. */
  const [large, setLarge] = useState<LargeRecord[] | null>(null)
  /**
   * Bumped whenever the dialog opens or closes, so a fetch still running
   * when the user closed the dialog does not open its record afterwards.
   */
  const generation = useRef(0)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [recent, setRecent] = useState<Recent[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)

  const parsed = useMemo(() => parseAccessionQuery(query), [query])
  const requests = parsed.requests
  const source: Source = requests[0] ? sourceOf(requests[0], chosen) : chosen ?? 'nucleotide'
  const sourceInfo = useMemo(() => SOURCES.find(s => s.id === source)!, [source])

  // Focus input on open
  useEffect(() => {
    generation.current++
    if (open) {
      setQuery(initialQuery ?? '')
      setChosen(null)
      setLoading(false)
      setError(null)
      setLarge(null)
      setPreview(null)
      setRecent(loadRecent())
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open, initialQuery])

  // Look the one entry up, once typing pauses, or say why it can't be read.
  // Several entries, or a fetch under way, show no preview. Keyed by the
  // entry's standard text, so a stray space does not look it up again.
  const firstError = parsed.errors[0] ?? null
  const singleText = !firstError && requests.length === 1 ? requests[0].text : null
  const single = useMemo(() => singleText === null ? null : parseAccessionQuery(singleText).requests[0] ?? null, [singleText])
  useEffect(() => {
    const tooShort = single && !single.gene && single.id.length < 4
    if (!open || loading || (!firstError && (!single || tooShort))) { setPreview(null); return }
    let live = true
    const timer = setTimeout(() => {
      if (firstError) { setPreview({ accession: '', status: 'missing', message: firstError }); return }
      if (!single) return
      const src = sourceOf(single, chosen)
      setPreview({ accession: single.text, status: 'loading' })
      if (src === 'uniprot' && !single.region && !single.complement) {
        uniProtSummary(single.id).then(summary => {
          if (!live) return
          setPreview(summary
            ? { accession: single.text, status: 'found', title: summary.title, length: summary.length, unit: 'aa' }
            : { accession: single.text, status: 'missing', message: `No record ${single.id} in UniProtKB` })
        }).catch(() => { if (live) setPreview(null) })
        return
      }
      planFor(single, chosen).then(plan => {
        if (!live) return
        // NCBI gave no summary without saying the accession is unknown: say nothing.
        if (plan.length === undefined && !plan.title) { setPreview(null); return }
        setPreview({ accession: single.text, status: 'found', title: plan.title ?? '', length: plan.length ?? 0, unit: plan.source === 'nucleotide' ? 'bp' : 'aa', detail: planDetail(plan) })
      }).catch(err => {
        if (live) setPreview({ accession: single.text, status: 'missing', message: friendlyError(err).replace(/\.$/, '') })
      })
    }, PREVIEW_DELAY_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [open, single, firstError, chosen, loading])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    setError(null)
    setLarge(null)
  }, [])

  const handleFetch = useCallback(async (confirmedLarge = false) => {
    if (requests.length === 0 && parsed.errors.length === 0) return
    if (loading) return
    if (parsed.errors.length > 0) {
      setError(parsed.errors.join('\n'))
      return
    }
    const gen = generation.current
    const current = () => generation.current === gen

    setLoading(true)
    setError(null)

    const failed: { request: AccessionRequest; message: string }[] = []
    /** What went wrong, in the order the entries were typed. */
    const report = (docCount: number) => {
      const order = (r: AccessionRequest) => requests.indexOf(r)
      failed.sort((a, b) => order(a.request) - order(b.request))
      // What failed stays in the box, ready to correct and fetch again.
      setQuery(failed.map(f => f.request.text).join(', '))
      setError(failed.length === 1 && docCount === 0
        ? failed[0].message
        : failed.map(f => `${f.request.text}: ${f.message}`).join('\n'))
    }
    try {
      // Gene IDs and regions are resolved, and every NCBI record's size
      // checked, before anything is downloaded.
      const plans: Plan[] = []
      for (const r of requests) {
        try {
          plans.push(await planFor(r, chosen))
        } catch (err) {
          failed.push({ request: r, message: friendlyError(err) })
        }
        if (!current()) return
      }
      if (!confirmedLarge) {
        const big = plans.filter(p => p.source !== 'uniprot' && (p.length ?? 0) > LARGE_RECORD_BP)
        if (big.length > 0) {
          setLarge(big.map(p => ({ accession: p.request.text, length: p.length!, title: p.title ?? '' })))
          if (failed.length > 0) setError(failed.map(f => `${f.request.text}: ${f.message}`).join('\n'))
          return
        }
      }
      setLarge(null)

      const fetched: { request: AccessionRequest; doc: DocumentState }[] = []
      for (const plan of plans) {
        try {
          if (plan.source === 'uniprot') {
            fetched.push({ request: plan.request, doc: await fetchUniProt(plan.accession) })
          } else {
            const gbText = await fetchNCBI(plan.accession, plan.source, plan.part)
            // Large records are parsed in the worker, off the main thread.
            const { docs: parsedDocs, warnings } = await parseGenbankFile(new File([gbText], `${plan.accession}.${plan.source === 'protein' ? 'gp' : 'gb'}`))
            const doc = namedFor(parsedDocs[0], plan)
            if (warnings.length > 0) {
              notify.warning(`${warnings.length} ${warnings.length === 1 ? 'feature' : 'features'} in "${doc.name}" could not be read exactly as written`, {
                detail: warnings.slice(0, 5).join('\n') + (warnings.length > 5 ? `\n…and ${warnings.length - 5} more` : ''),
              })
            }
            fetched.push({ request: plan.request, doc })
          }
        } catch (err) {
          failed.push({ request: plan.request, message: friendlyError(err) })
        }
        if (!current()) return
      }

      if (fetched.length > 0) {
        onFetched(fetched.map(f => f.doc))
        setRecent(saveRecent(fetched.map(({ request, doc }) => ({ accession: request.text, title: doc.description || doc.name || '' }))))
      }
      if (failed.length === 0) {
        onClose()
        return
      }
      report(fetched.length)
    } catch (err) {
      if (current()) setError(friendlyError(err))
    } finally {
      if (current()) setLoading(false)
    }
  }, [requests, parsed.errors, loading, chosen, onFetched, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // A focused button answers Enter itself: Enter on Cancel must not fetch.
    if (e.key === 'Enter' && !loading && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault()
      // With the size warning up, Enter confirms it rather than asking again.
      handleFetch(large !== null)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [handleFetch, loading, large, onClose])

  const { onMouseDown: handleBackdropClickDown, onClick: handleBackdropClick } = useBackdropDismiss(onClose)

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onMouseDown={handleBackdropClickDown} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal-dialog fetch-modal" role="dialog" aria-modal="true" aria-labelledby="fetch-modal-title">
        {/* Header */}
        <div className="modal-header">
          <h3 className="modal-title" id="fetch-modal-title">Import by Accession</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="modal-body">
          <div className="fetch-sources" role="radiogroup" aria-label="Source">
            {SOURCES.map(s => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={source === s.id}
                className={`fetch-source ${source === s.id ? 'active' : ''}`}
                onClick={() => setChosen(s.id)}
                disabled={loading}
                title={chosen === null && source === s.id ? 'Guessed from the accession' : undefined}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="fetch-input-group">
            <label className="fetch-label">{sourceInfo.hint}</label>
            <input
              ref={inputRef}
              className="input fetch-input"
              type="text"
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              placeholder={sourceInfo.placeholder}
              disabled={loading}
            />
            {preview && (
              <div className={`fetch-preview fetch-preview-${preview.status}`} role="status" aria-live="polite">
                {preview.status === 'loading' && <><span className="spinner fetch-spinner fetch-spinner-sm" /> Looking up {preview.accession}…</>}
                {preview.status === 'found' && (
                  <>
                    <span className="fetch-preview-title">{preview.title || preview.accession}</span>
                    {preview.length > 0 && <span className="fetch-preview-len">{preview.unit === 'bp' ? formatBp(preview.length) : `${preview.length.toLocaleString('en-US')} aa`}</span>}
                  </>
                )}
                {preview.status === 'missing' && preview.message}
              </div>
            )}
            {preview?.status === 'found' && preview.detail && <div className="fetch-preview-detail">{preview.detail}</div>}
            {!query.trim() && recent.length > 0 && (
              <div className="fetch-recent">
                <span className="fetch-recent-label">Recent</span>
                {recent.map(r => (
                  <button key={r.accession} type="button" className="fetch-recent-chip" title={r.title || r.accession}
                    onClick={() => { handleQueryChange(r.accession); inputRef.current?.focus() }}>
                    {r.accession}
                  </button>
                ))}
              </div>
            )}
            <div className="fetch-auto-hint">
              {source === 'uniprot'
                ? 'The entry opens as a protein with its UniProt features (chains, domains, sites, modifications, disulfides, variants).'
                : source === 'protein'
                  ? 'The GenPept record opens as a protein with its regions and sites.'
                  : 'For Addgene or SnapGene plasmids, download the GenBank or .dna file from their site, then drag it into SeqNexus.'}
            </div>
            {source !== 'uniprot' && (
              <details className="fetch-formats">
                <summary>Gene IDs, ranges, regions and complements</summary>
                <ul>
                  {FORMATS.map(f => (
                    <li key={f.example}>
                      <button type="button" className="fetch-format-example" title="Put this in the box"
                        onClick={() => { handleQueryChange(f.example); inputRef.current?.focus() }} disabled={loading}>
                        {f.example}
                      </button>
                      <span>{f.meaning}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {/* Large records: confirm first */}
          {large && (
            <div className="fetch-warning" role="alert">
              {large.map(l => (
                <div key={l.accession}>
                  {l.accession} is {formatBp(l.length)}{l.title ? ` (${l.title})` : ''}.
                </div>
              ))}
              Records this large can take minutes to download and may make the page unresponsive.
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="fetch-error" role="alert">{error}</div>
          )}

          {/* Loading */}
          {loading && (
            <div className="fetch-loading">
              <div className="spinner fetch-spinner" />
              Fetching {requests.length > 1 ? `${requests.length} records` : `from ${sourceInfo.label}`}…
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          {/* Cancel works mid-fetch: the record is dropped when it arrives. */}
          <button className="btn" onClick={onClose}>Cancel</button>
          {large ? (
            <button className="btn btn-primary" onClick={() => handleFetch(true)} disabled={loading}>
              Download {formatBp(large.reduce((n, l) => n + l.length, 0))} anyway
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => handleFetch()}
              disabled={(requests.length === 0 && parsed.errors.length === 0) || loading}
            >
              {requests.length > 1 ? `Fetch ${requests.length}` : 'Fetch'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
