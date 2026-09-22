import './FetchModal.css'
/**
 * Modal for fetching sequences from NCBI, Addgene, or SnapGene by accession/ID.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { fetchNCBI } from '../fetch/ncbi'
import { fetchAddgene } from '../fetch/addgene'
import { fetchSnapGene } from '../fetch/snapgene'
import { parseGenBank } from '../io/genbank'
import type { DocumentState } from '../models/Document'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'

export type FetchSource = 'ncbi' | 'addgene' | 'snapgene'

interface Props {
  open: boolean
  onClose: () => void
  onFetched: (doc: DocumentState) => void
}

/** Auto-detect the source from user input. */
function detectSource(input: string): FetchSource {
  const trimmed = input.trim()
  if (!trimmed) return 'ncbi'

  // Addgene: starts with # or is purely numeric with 4+ digits
  if (/^#\d+$/.test(trimmed) || /^\d{4,}$/.test(trimmed)) {
    return 'addgene'
  }

  // SnapGene: contains "snapgene" or is a URL to snapgene.com
  if (/snapgene/i.test(trimmed)) {
    return 'snapgene'
  }

  // Default: NCBI nucleotide
  return 'ncbi'
}

const SOURCE_LABELS: Record<FetchSource, string> = {
  ncbi: 'NCBI',
  addgene: 'Addgene',
  snapgene: 'SnapGene',
}

export default function FetchModal({ open, onClose, onFetched }: Props) {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<FetchSource>('ncbi')
  const [autoDetected, setAutoDetected] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setSource('ncbi')
      setAutoDetected(true)
      setLoading(false)
      setError(null)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Auto-detect source as user types
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    setError(null)
    if (autoDetected) {
      setSource(detectSource(value))
    }
  }, [autoDetected])

  // Manual source override
  const handleSourceChange = useCallback((s: FetchSource) => {
    setSource(s)
    setAutoDetected(false)
  }, [])

  const handleFetch = useCallback(async () => {
    const trimmed = query.trim()
    if (!trimmed || loading) return

    setLoading(true)
    setError(null)

    try {
      let gbText: string

      switch (source) {
        case 'ncbi':
          gbText = await fetchNCBI(trimmed)
          break
        case 'addgene':
          gbText = await fetchAddgene(trimmed)
          break
        case 'snapgene':
          gbText = await fetchSnapGene(trimmed)
          break
      }

      const doc = parseGenBank(gbText)
      onFetched(doc)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [query, source, loading, onFetched, onClose])

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
          <h3 className="modal-title" id="fetch-modal-title">Import from NCBI / Addgene</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="modal-body">
          <div className="fetch-input-group">
            <label className="fetch-label">Accession or ID</label>
            <input
              ref={inputRef}
              className="input fetch-input"
              type="text"
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              placeholder="e.g. M13mp18, NM_001301717, #12345"
              disabled={loading}
            />
            {query.trim() && autoDetected && (
              <div className="fetch-auto-hint">
                Detected: {SOURCE_LABELS[source]}
              </div>
            )}
          </div>

          {/* Source selector */}
          <div className="fetch-source-row">
            <span className="fetch-source-label">Source:</span>
            <div className="toggle-group">
              {(['ncbi', 'addgene', 'snapgene'] as FetchSource[]).map(s => (
                <button
                  key={s}
                  className={`toggle-btn ${source === s ? 'active' : ''}`}
                  onClick={() => handleSourceChange(s)}
                  disabled={loading}
                >
                  {SOURCE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="fetch-error">{error}</div>
          )}

          {/* Loading */}
          {loading && (
            <div className="fetch-loading">
              <div className="fetch-spinner" />
              Fetching from {SOURCE_LABELS[source]}…
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={loading}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleFetch}
            disabled={!query.trim() || loading}
          >
            Fetch
          </button>
        </div>
      </div>
    </div>
  )
}
