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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface Props {
  open: boolean
  onClose: () => void
  onExport: (filename: string, opts: SessionExportOptions) => void
}

export default function SessionExportModal({ open, onClose, onExport }: Props) {
  const tabs = useEditorStore(s => s.tabs)
  const reads = useEditorStore(s => s.sequencingReads)
  const alignments = useEditorStore(s => s.alignments)
  const readAlignments = useEditorStore(s => s.readAlignments)
  const contigs = useEditorStore(s => s.contigs)

  const [includeReads, setIncludeReads] = useState(true)
  const [includeAlignments, setIncludeAlignments] = useState(true)
  const [includeReadAlignments, setIncludeReadAlignments] = useState(true)
  const [filename, setFilename] = useState('session.seqnexus.json')

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setIncludeReads(reads.length > 0)
      setIncludeAlignments(alignments.length > 0)
      setIncludeReadAlignments(readAlignments.length > 0)
      setFilename('session.seqnexus.json')
    }
  }, [open, reads.length, alignments.length, readAlignments.length])

  const filenameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) setTimeout(() => filenameRef.current?.select(), 50)
  }, [open])

  const opts: SessionExportOptions = useMemo(() => ({
    includeReads,
    includeAlignments,
    includeReadAlignments,
  }), [includeReads, includeAlignments, includeReadAlignments])

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
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="session-export-modal-title" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3 className="modal-title" id="session-export-modal-title">Export Session</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
            Choose what to include in the session file.
          </p>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked disabled />
            <span>Sequences ({tabs.length})</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, opacity: reads.length === 0 ? 0.4 : 1 }}>
            <input
              type="checkbox"
              checked={includeReads}
              disabled={reads.length === 0}
              onChange={e => setIncludeReads(e.target.checked)}
            />
            <span>Sequencing reads ({reads.length})</span>
            {reads.length > 0 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>includes trace data</span>}
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, opacity: alignments.length === 0 ? 0.4 : 1 }}>
            <input
              type="checkbox"
              checked={includeAlignments}
              disabled={alignments.length === 0}
              onChange={e => setIncludeAlignments(e.target.checked)}
            />
            <span>Alignments ({alignments.length})</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, opacity: (readAlignments.length === 0 && contigs.length === 0) ? 0.4 : 1 }}>
            <input
              type="checkbox"
              checked={includeReadAlignments}
              disabled={readAlignments.length === 0 && contigs.length === 0}
              onChange={e => setIncludeReadAlignments(e.target.checked)}
            />
            <span>Read alignments ({readAlignments.length}) and contigs ({contigs.length})</span>
          </label>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              Estimated size: <strong>{formatBytes(estimatedSize)}</strong>
            </div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Filename
              <input
                ref={filenameRef}
                className="input"
                type="text"
                value={filename}
                onChange={e => setFilename(e.target.value)}
                style={{ width: '100%', marginTop: 4, fontSize: 13 }}
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
