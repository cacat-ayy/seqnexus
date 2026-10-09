import './ExportDialog.css'
/**
 * Unified export modal for all item types: sequences, sequencing reads,
 * alignments, read alignments, and contigs.
 *
 * Format options adapt to the item kind. Mixed-kind selections always
 * export as separate files in each item's default format.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { defaultFormatForKind, formatsForKind, type ExportFormat, type ExportItemKind } from './exportFormats'

export type { ExportFormat, ExportItemKind } from './exportFormats'

function kindLabel(kind: ExportItemKind, plural: boolean): string {
  switch (kind) {
    case 'sequence': return plural ? 'Sequences' : 'Sequence'
    case 'read': return plural ? 'Sequencing Reads' : 'Sequencing Read'
    case 'alignment': return plural ? 'Alignments' : 'Alignment'
    case 'read-alignment': return plural ? 'Read Alignments' : 'Read Alignment'
    case 'contig': return plural ? 'Contigs' : 'Contig'
  }
}

export type ExportMode = 'combined' | 'separate'

interface Props {
  open: boolean
  defaultName: string
  annotationCount: number
  /** What kind of items are being exported. 'mixed' for heterogeneous selections. */
  itemKind: ExportItemKind | 'mixed'
  /** Breakdown of selected item counts by kind (for mixed selections). */
  kindCounts?: Partial<Record<ExportItemKind, number>>
  count?: number
  /** Names of individual items (for separate export preview). */
  itemNames?: string[]
  onExport: (format: ExportFormat, filename: string, mode: ExportMode) => void
  onClose: () => void
}

export default function ExportDialog({ open, defaultName, annotationCount, itemKind, kindCounts, count = 1, itemNames, onExport, onClose }: Props) {
  const isMixed = itemKind === 'mixed'
  const singleKind: ExportItemKind = isMixed ? 'sequence' : itemKind
  const formats = isMixed ? [] : formatsForKind(singleKind)

  const [format, setFormat] = useState<ExportFormat>(defaultFormatForKind(singleKind))
  const [filename, setFilename] = useState('')
  const [mode, setMode] = useState<ExportMode>('combined')
  const inputRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)

  const currentFmt = formats.find(f => f.id === format)

  const effectiveMode = isMixed ? 'separate'
    : count <= 1 ? 'combined'
    : (currentFmt?.separateOnly ? 'separate' : mode)

  // Reset format when item kind changes
  useEffect(() => {
    if (!isMixed) setFormat(defaultFormatForKind(singleKind))
  }, [singleKind, isMixed])

  // Update filename when format or defaultName changes
  useEffect(() => {
    if (isMixed) {
      setFilename('')
    } else {
      const ext = currentFmt?.ext ?? formatsForKind(singleKind)[0]?.ext ?? ''
      setFilename(`${defaultName}${ext}`)
    }
  }, [format, defaultName, currentFmt, isMixed, singleKind])

  // Reset mode when opening
  useEffect(() => {
    if (open) setMode('combined')
  }, [open])

  // Focus and select the name part on open (only for combined mode)
  useEffect(() => {
    if (!open || effectiveMode === 'separate') return
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      const dotIdx = el.value.lastIndexOf('.')
      if (dotIdx > 0) {
        el.setSelectionRange(0, dotIdx)
      } else {
        el.select()
      }
    })
  }, [open, effectiveMode])

  const handleExport = useCallback(() => {
    if (effectiveMode === 'separate') {
      onExport(format, '', 'separate')
    } else {
      const trimmed = filename.trim()
      if (trimmed) onExport(format, trimmed, 'combined')
    }
  }, [format, filename, effectiveMode, onExport])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  // Title
  let title: string
  if (isMixed) {
    title = `Export ${count} Items`
  } else if (count > 1) {
    title = `Export ${count} ${kindLabel(singleKind, true)}`
  } else {
    title = `Export ${kindLabel(singleKind, false)}`
  }

  // Mixed-kind summary line
  const mixedSummary = isMixed && kindCounts ? (
    Object.entries(kindCounts)
      .filter(([, n]) => n && n > 0)
      .map(([k, n]) => `${n} ${kindLabel(k as ExportItemKind, n! > 1).toLowerCase()}`)
      .join(', ')
  ) : null

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal-dialog export-modal" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
        <div className="modal-header">
          <h3 className="modal-title" id="export-modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* Mixed-kind summary */}
          {isMixed && mixedSummary && (
            <div className="export-mixed-summary">{mixedSummary}</div>
          )}

          {/* Format selection: only for uniform kinds */}
          {!isMixed && (
            <>
              <div className="export-format-label">Format</div>
              <div className="export-format-list">
                {formats.filter(f => count <= 1 || !f.annotationsOnly).map(fmt => {
                  const Icon = fmt.icon
                  return (
                    <button
                      key={fmt.id}
                      className={`export-format-card ${format === fmt.id ? 'selected' : ''}`}
                      onClick={() => setFormat(fmt.id)}
                    >
                      <Icon size={16} className="export-format-icon" />
                      <div className="export-format-info">
                        <div className="export-format-name">
                          {fmt.label}
                          <span className="export-format-ext">{fmt.ext}</span>
                        </div>
                        <div className="export-format-desc">{fmt.description}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {/* Mixed-kind default format note */}
          {isMixed && (
            <div className="export-format-note" style={{ marginTop: 0 }}>
              Each item will be exported in its default format (GenBank for sequences, FASTA for reads, Aligned FASTA for alignments).
            </div>
          )}

          {/* Annotations-only warning */}
          {!isMixed && currentFmt?.annotationsOnly && annotationCount === 0 && (
            <div className="export-format-note">
              This sequence has no annotations. The exported file will be empty.
            </div>
          )}

          {/* Combined / Separate toggle for bulk export (uniform kind only) */}
          {!isMixed && count > 1 && !currentFmt?.separateOnly && (
            <>
              <div className="export-filename-label">Output</div>
              <div className="toggle-group export-mode-toggle">
                <button
                  className={`toggle-btn ${effectiveMode === 'combined' ? 'active' : ''}`}
                  onClick={() => setMode('combined')}
                >
                  Combined file
                </button>
                <button
                  className={`toggle-btn ${effectiveMode === 'separate' ? 'active' : ''}`}
                  onClick={() => setMode('separate')}
                >
                  Separate files
                </button>
              </div>
            </>
          )}

          {/* Filename or file preview */}
          {effectiveMode === 'combined' ? (
            <>
              <div className="export-filename-label">Filename</div>
              <input
                ref={inputRef}
                className="input export-filename-input"
                type="text"
                value={filename}
                onChange={e => setFilename(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleExport()
                  }
                }}
                spellCheck={false}
              />
            </>
          ) : (
            <>
              <div className="export-filename-label">Files</div>
              <div className="export-file-preview">
                {(itemNames ?? []).slice(0, 5).map((name, i) => (
                  <div key={i} className="export-file-preview-item">
                    {name}
                  </div>
                ))}
                {(itemNames?.length ?? 0) > 5 && (
                  <div className="export-file-preview-more">
                    +{(itemNames?.length ?? 0) - 5} more
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleExport}
            disabled={effectiveMode === 'combined' && !filename.trim()}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  )
}
