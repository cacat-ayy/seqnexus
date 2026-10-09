/**
 * Modal for exporting the entire session as a .seqnexus.json file.
 *
 * Shows checkboxes for each data category with item counts and
 * an estimated file size. Sequences are always included.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { X, Download } from 'lucide-react'
import { useEditorStore } from '../store'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { estimateExportSize, type SessionExportOptions } from '../persistence'
import { formatBytes } from '../utils/format'
import './SessionDialog.css'

interface Props {
  open: boolean
  onClose: () => void
  onExport: (filename: string, opts: SessionExportOptions) => void
}

export default function SessionExportDialog({ open, onClose, onExport }: Props) {
  const tabs = useEditorStore(s => s.tabs)
  const reads = useEditorStore(s => s.sequencingReads)
  const alignments = useEditorStore(s => s.alignments)
  const contigs = useEditorStore(s => s.contigs)

  const [includeReads, setIncludeReads] = useState(true)
  const [includeAlignments, setIncludeAlignments] = useState(true)
  const [includeContigs, setIncludeContigs] = useState(true)
  const [filename, setFilename] = useState('session.seqnexus.json')

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setIncludeReads(reads.length > 0)
      setIncludeAlignments(alignments.length > 0)
      setIncludeContigs(contigs.length > 0)
      setFilename('session.seqnexus.json')
    }
  }, [open, reads.length, alignments.length, contigs.length])

  const filenameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) setTimeout(() => filenameRef.current?.select(), 50)
  }, [open])

  const opts: SessionExportOptions = useMemo(() => ({
    includeReads,
    includeAlignments,
    includeContigs,
  }), [includeReads, includeAlignments, includeContigs])

  const estimatedSize = useMemo(() => open ? estimateExportSize(opts) : 0, [opts, open])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  const handleExport = useCallback(() => {
    const name = filename.trim() || 'session.seqnexus.json'
    onExport(name.endsWith('.json') ? name : name + '.json', opts)
    onClose()
  }, [filename, opts, onExport, onClose])

  if (!visible) return null

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal-dialog session-dialog" role="dialog" aria-modal="true" aria-labelledby="session-export-modal-title">
        <div className="modal-header">
          <h3 className="modal-title" id="session-export-modal-title">Export Session</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body session-body">
          <p className="session-note">
            Choose what to include in the session file.
          </p>

          <label className="session-option">
            <input type="checkbox" checked disabled />
            <span>Sequences ({tabs.length})</span>
          </label>

          <label className={reads.length === 0 ? 'session-option is-empty' : 'session-option'}>
            <input
              type="checkbox"
              checked={includeReads}
              disabled={reads.length === 0}
              onChange={e => setIncludeReads(e.target.checked)}
            />
            <span>Sequencing reads ({reads.length})</span>
            {reads.length > 0 && <span className="session-option-hint">includes trace data</span>}
          </label>

          <label className={alignments.length === 0 ? 'session-option is-empty' : 'session-option'}>
            <input
              type="checkbox"
              checked={includeAlignments}
              disabled={alignments.length === 0}
              onChange={e => setIncludeAlignments(e.target.checked)}
            />
            <span>Alignments ({alignments.length})</span>
          </label>

          <label className={contigs.length === 0 ? 'session-option is-empty' : 'session-option'}>
            <input
              type="checkbox"
              checked={includeContigs}
              disabled={contigs.length === 0}
              onChange={e => setIncludeContigs(e.target.checked)}
            />
            <span>Contigs ({contigs.length})</span>
          </label>

          <div className="session-filename">
            <div className="session-size">
              Estimated size: <strong>{formatBytes(estimatedSize)}</strong>
            </div>
            <label className="session-field">
              Filename
              <input
                ref={filenameRef}
                className="input"
                type="text"
                value={filename}
                onChange={e => setFilename(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleExport() }}
              />
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleExport} disabled={tabs.length === 0}>
            <Download size={14} />
            Export
          </button>
        </div>
      </div>
    </div>
  )
}
