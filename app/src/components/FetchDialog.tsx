import './FetchDialog.css'
/**
 * Modal for fetching sequences by accession: NCBI Nucleotide, NCBI Protein
 * (GenPept) and UniProtKB. The source is guessed from the accession's
 * shape as it is typed and can be overridden.
 *
 * Addgene and SnapGene were offered too, but neither site lets another
 * website download its files (no CORS), so those buttons failed every time.
 * The dialog now says how to get their files in instead.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { X } from 'lucide-react'
import { fetchNCBI, ncbiRecordSummary, looksLikeNcbiProtein, type NcbiDatabase } from '../fetch/ncbi'
import { fetchUniProt, looksLikeUniProt } from '../fetch/uniprot'
import { parseGenbankFile } from '../workers/genbank-parser'
import { notify } from '../toast'
import type { DocumentState } from '../models/Document'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { formatBp } from '../utils/format'

interface Props {
  open: boolean
  onClose: () => void
  onFetched: (doc: DocumentState) => void
}

/** Records longer than this are confirmed before downloading. */
const LARGE_RECORD_BP = 10_000_000

type Source = 'nucleotide' | 'protein' | 'uniprot'

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

export default function FetchDialog({ open, onClose, onFetched }: Props) {
  const [query, setQuery] = useState('')
  /** The source chosen by hand; null follows the guess. */
  const [chosen, setChosen] = useState<Source | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** A record over LARGE_RECORD_BP, waiting for the user to confirm. */
  const [large, setLarge] = useState<{ accession: string; length: number; title: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)

  const source: Source = chosen ?? guessSource(query)
  const sourceInfo = useMemo(() => SOURCES.find(s => s.id === source)!, [source])

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setChosen(null)
      setLoading(false)
      setError(null)
      setLarge(null)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    setError(null)
    setLarge(null)
  }, [])

  const handleFetch = useCallback(async (confirmedLarge = false) => {
    const trimmed = query.trim()
    if (!trimmed || loading) return

    setLoading(true)
    setError(null)

    try {
      if (source === 'uniprot') {
        onFetched(await fetchUniProt(trimmed))
        onClose()
        return
      }
      const db: NcbiDatabase = source
      if (!confirmedLarge) {
        const summary = await ncbiRecordSummary(trimmed, db)
        if (summary && summary.length > LARGE_RECORD_BP) {
          setLarge({ accession: trimmed, ...summary })
          return
        }
      }
      setLarge(null)

      const gbText = await fetchNCBI(trimmed, db)
      // Large records are parsed in the worker, off the main thread.
      const { docs, warnings } = await parseGenbankFile(new File([gbText], `${trimmed}.${db === 'protein' ? 'gp' : 'gb'}`))
      const doc = docs[0]
      if (warnings.length > 0) {
        notify.warning(`${warnings.length} ${warnings.length === 1 ? 'feature' : 'features'} in "${doc.name}" could not be read exactly as written`, {
          detail: warnings.slice(0, 5).join('\n') + (warnings.length > 5 ? `\n…and ${warnings.length - 5} more` : ''),
        })
      }
      onFetched(doc)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [query, loading, source, onFetched, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      e.preventDefault()
      handleFetch()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [handleFetch, loading, onClose])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
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
            <div className="fetch-auto-hint">
              {source === 'uniprot'
                ? 'The entry opens as a protein with its UniProt features (chains, domains, sites, modifications, disulfides, variants).'
                : source === 'protein'
                  ? 'The GenPept record opens as a protein with its regions and sites.'
                  : 'For Addgene or SnapGene plasmids, download the GenBank or .dna file from their site, then drag it into SeqNexus.'}
            </div>
          </div>

          {/* Large record: confirm first */}
          {large && (
            <div className="fetch-error">
              {large.accession} is {formatBp(large.length)}
              {large.title ? ` (${large.title})` : ''}. Records this large can take minutes to download and may make
              the page unresponsive.
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="fetch-error">{error}</div>
          )}

          {/* Loading */}
          {loading && (
            <div className="fetch-loading">
              <div className="fetch-spinner" />
              Fetching from {sourceInfo.label}…
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={loading}>Cancel</button>
          {large ? (
            <button className="btn btn-primary" onClick={() => handleFetch(true)} disabled={loading}>
              Download {formatBp(large.length)} anyway
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => handleFetch()}
              disabled={!query.trim() || loading}
            >
              Fetch
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
