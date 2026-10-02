import './FetchModal.css'
/**
 * Modal for fetching sequences from NCBI by accession.
 *
 * Addgene and SnapGene were offered too, but neither site lets another
 * website download its files (no CORS), so those buttons failed every time.
 * The dialog now says how to get their files in instead.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { fetchNCBI, ncbiRecordSummary } from '../fetch/ncbi'
import { parseGenbankFile } from '../workers/genbank-parser'
import { notify } from '../toast'
import type { DocumentState } from '../models/Document'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface Props {
  open: boolean
  onClose: () => void
  onFetched: (doc: DocumentState) => void
}

/** Records longer than this are confirmed before downloading. */
const LARGE_RECORD_BP = 10_000_000

function formatBp(bp: number): string {
  if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(1)} Mb`
  if (bp >= 1000) return `${(bp / 1000).toFixed(1)} kb`
  return `${bp} bp`
}

export default function FetchModal({ open, onClose, onFetched }: Props) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** A record over LARGE_RECORD_BP, waiting for the user to confirm. */
  const [large, setLarge] = useState<{ accession: string; length: number; title: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery('')
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
      if (!confirmedLarge) {
        const summary = await ncbiRecordSummary(trimmed)
        if (summary && summary.length > LARGE_RECORD_BP) {
          setLarge({ accession: trimmed, ...summary })
          return
        }
      }
      setLarge(null)

      const gbText = await fetchNCBI(trimmed)
      // Large records are parsed in the worker, off the main thread.
      const { docs, warnings } = await parseGenbankFile(new File([gbText], `${trimmed}.gb`))
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
  }, [query, loading, onFetched, onClose])

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
          <h3 className="modal-title" id="fetch-modal-title">Import from NCBI</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="modal-body">
          <div className="fetch-input-group">
            <label className="fetch-label">Nucleotide accession</label>
            <input
              ref={inputRef}
              className="input fetch-input"
              type="text"
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              placeholder="e.g. L09137.2, NM_001301717, M13mp18"
              disabled={loading}
            />
            <div className="fetch-auto-hint">
              For Addgene or SnapGene plasmids, download the GenBank or .dna file from their site, then drag it into SeqNexus.
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
              Fetching from NCBI…
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
