import './FetchDialog.css'
/**
 * Modal for fetching sequences by accession: NCBI Nucleotide, NCBI Protein
 * (GenPept) and UniProtKB. The source is guessed from the accession's
 * shape as it is typed and can be overridden. Several accessions, separated
 * by commas or spaces, are fetched one after another.
 *
 * A single accession is looked up as it is typed (debounced), and the
 * record's title and length shown under the box, so a typo is caught
 * before anything is downloaded. The last few accessions fetched are kept
 * in this browser and offered when the box is empty.
 *
 * Addgene and SnapGene were offered too, but neither site lets another
 * website download its files (no CORS), so those buttons failed every time.
 * The dialog now says how to get their files in instead.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { X } from 'lucide-react'
import { fetchNCBI, ncbiRecordSummary, looksLikeNcbiProtein } from '../fetch/ncbi'
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

/** What a lookup of the typed accession found. */
type Preview =
  | { accession: string; status: 'loading' }
  | { accession: string; status: 'found'; title: string; length: number; unit: 'bp' | 'aa' }
  | { accession: string; status: 'missing'; where: string }

/** Records longer than this are confirmed before downloading. */
const LARGE_RECORD_BP = 10_000_000

type Source = 'nucleotide' | 'protein' | 'uniprot'

interface LargeRecord { accession: string; length: number; title: string }

const SOURCES: { id: Source; label: string; hint: string; placeholder: string }[] = [
  { id: 'nucleotide', label: 'NCBI Nucleotide', hint: 'Nucleotide accession', placeholder: 'e.g. L09137.2, NM_001301717, M13mp18' },
  { id: 'protein', label: 'NCBI Protein', hint: 'Protein accession', placeholder: 'e.g. NP_000509.1, AAA59172.1' },
  { id: 'uniprot', label: 'UniProt', hint: 'UniProt accession or entry name', placeholder: 'e.g. P69905, HBA_HUMAN' },
]

/** Which source an accession's shape points to. */
function guessSource(text: string): Source {
  if (looksLikeUniProt(text)) return 'uniprot'
  if (looksLikeNcbiProtein(text)) return 'protein'
  return 'nucleotide'
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

  const accessions = useMemo(() => [...new Set(query.split(/[\s,;]+/).filter(Boolean))], [query])
  const source: Source = chosen ?? guessSource(accessions[0] ?? '')
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

  // Look the one accession up, once typing pauses. Several accessions, or
  // a fetch under way, show no preview.
  const single = accessions.length === 1 ? accessions[0] : null
  useEffect(() => {
    if (!open || !single || loading || single.length < 4) { setPreview(null); return }
    const src = chosen ?? guessSource(single)
    let live = true
    const timer = setTimeout(() => {
      setPreview({ accession: single, status: 'loading' })
      const lookup = src === 'uniprot' ? uniProtSummary(single) : ncbiRecordSummary(single, src)
      lookup.then(summary => {
        if (!live) return
        if (summary) {
          setPreview({ accession: single, status: 'found', title: summary.title, length: summary.length, unit: src === 'nucleotide' ? 'bp' : 'aa' })
        } else if (src === 'uniprot') {
          setPreview({ accession: single, status: 'missing', where: 'UniProtKB' })
        } else {
          // NCBI gave no summary without saying the accession is unknown: say nothing.
          setPreview(null)
        }
      }).catch(() => {
        // ncbiRecordSummary throws only when NCBI says there is no such accession.
        if (live) setPreview(src === 'uniprot' ? null : { accession: single, status: 'missing', where: SOURCES.find(x => x.id === src)!.label })
      })
    }, PREVIEW_DELAY_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [open, single, chosen, loading])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    setError(null)
    setLarge(null)
  }, [])

  const handleFetch = useCallback(async (confirmedLarge = false) => {
    if (accessions.length === 0 || loading) return
    const gen = generation.current
    const current = () => generation.current === gen

    setLoading(true)
    setError(null)

    /** Each accession's source: the one chosen, or the one its shape points to. */
    const sourceOf = (acc: string): Source => chosen ?? guessSource(acc)
    try {
      if (!confirmedLarge) {
        const big: LargeRecord[] = []
        for (const acc of accessions) {
          const src = sourceOf(acc)
          if (src === 'uniprot') continue
          const summary = await ncbiRecordSummary(acc, src)
          if (summary && summary.length > LARGE_RECORD_BP) big.push({ accession: acc, ...summary })
        }
        if (!current()) return
        if (big.length > 0) {
          setLarge(big)
          return
        }
      }
      setLarge(null)

      const docs: DocumentState[] = []
      const failed: { accession: string; message: string }[] = []
      for (const acc of accessions) {
        const src = sourceOf(acc)
        try {
          if (src === 'uniprot') {
            docs.push(await fetchUniProt(acc))
          } else {
            const gbText = await fetchNCBI(acc, src)
            // Large records are parsed in the worker, off the main thread.
            const { docs: parsed, warnings } = await parseGenbankFile(new File([gbText], `${acc}.${src === 'protein' ? 'gp' : 'gb'}`))
            const doc = parsed[0]
            if (warnings.length > 0) {
              notify.warning(`${warnings.length} ${warnings.length === 1 ? 'feature' : 'features'} in "${doc.name}" could not be read exactly as written`, {
                detail: warnings.slice(0, 5).join('\n') + (warnings.length > 5 ? `\n…and ${warnings.length - 5} more` : ''),
              })
            }
            docs.push(doc)
          }
        } catch (err) {
          failed.push({ accession: acc, message: friendlyError(err) })
        }
        if (!current()) return
      }

      if (docs.length > 0) {
        onFetched(docs)
        const ok = accessions.filter(acc => !failed.some(f => f.accession === acc))
        setRecent(saveRecent(ok.map((acc, i) => ({ accession: acc, title: docs[i]?.description || docs[i]?.name || '' }))))
      }
      if (failed.length === 0) {
        onClose()
        return
      }
      // What failed stays in the box, ready to correct and fetch again.
      setQuery(failed.map(f => f.accession).join(', '))
      setError(failed.length === 1 && docs.length === 0
        ? failed[0].message
        : failed.map(f => `${f.accession}: ${f.message}`).join('\n'))
    } catch (err) {
      if (current()) setError(friendlyError(err))
    } finally {
      if (current()) setLoading(false)
    }
  }, [accessions, loading, chosen, onFetched, onClose])

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
                {preview.status === 'loading' && <><span className="fetch-spinner fetch-spinner-sm" /> Looking up {preview.accession}…</>}
                {preview.status === 'found' && (
                  <>
                    <span className="fetch-preview-title">{preview.title || preview.accession}</span>
                    {preview.length > 0 && <span className="fetch-preview-len">{preview.unit === 'bp' ? formatBp(preview.length) : `${preview.length.toLocaleString()} aa`}</span>}
                  </>
                )}
                {preview.status === 'missing' && <>No record {preview.accession} in {preview.where}</>}
              </div>
            )}
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
              <div className="fetch-spinner" />
              Fetching {accessions.length > 1 ? `${accessions.length} records` : `from ${sourceInfo.label}`}…
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
              disabled={accessions.length === 0 || loading}
            >
              {accessions.length > 1 ? `Fetch ${accessions.length}` : 'Fetch'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
