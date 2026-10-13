import './ExportDialog.css'
/**
 * Unified export modal for all item types: sequences, sequencing reads,
 * alignments, read alignments, and contigs.
 *
 * Format options adapt to the item kind. Mixed-kind selections always
 * export as separate files in each item's default format.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Check, X } from 'lucide-react'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { defaultFormatForKind, formatsForKind, type ExportFormat, type ExportItemKind } from './exportFormats'
import { useBackdropDismiss } from '../hooks/useBackdropDismiss'

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

export type ExportMode = 'combined' | 'separate' | 'zip'

const MODE_LABEL: Record<ExportMode, string> = { combined: 'Combined file', separate: 'Separate files', zip: 'One ZIP' }
const MODE_HINT: Record<ExportMode, string> = {
  combined: 'Every item in one file of this format',
  separate: 'A file per item; the browser may ask before saving several',
  zip: 'A file per item, packed into one ZIP: one download',
}

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
  /** The sequence being exported is a protein: no SnapGene format. */
  protein?: boolean
  /** What the chosen format will leave out that the user would not expect, said before writing. */
  warningsFor?: (format: ExportFormat) => string[]
  onExport: (format: ExportFormat, filename: string, mode: ExportMode) => void
  onClose: () => void
}

export default function ExportDialog({ open, defaultName, annotationCount, itemKind, kindCounts, count = 1, itemNames, protein = false, warningsFor, onExport, onClose }: Props) {
  const isMixed = itemKind === 'mixed'
  const singleKind: ExportItemKind = isMixed ? 'sequence' : itemKind
  const formats = isMixed ? [] : formatsForKind(singleKind, protein)

  const [chosen, setFormat] = useState<ExportFormat>(defaultFormatForKind(singleKind))
  const [filename, setFilename] = useState('')
  const [mode, setMode] = useState<ExportMode>('combined')
  const inputRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)

  // The formats on offer: one sequence can also go out as its feature table.
  const shown = formats.filter(f => count <= 1 || !f.annotationsOnly)
  // The dialog stays mounted, so a choice from an earlier export may not be
  // on offer now (SnapGene for a protein, GFF3 for several sequences): what
  // is written is always a format the dialog shows.
  const format: ExportFormat = shown.some(f => f.id === chosen) ? chosen : (shown[0]?.id ?? defaultFormatForKind(singleKind))
  const currentFmt = shown.find(f => f.id === format)

  // Several items go into one file where the format holds several, or into
  // separate files, or into one ZIP of those files (one download, not one
  // per item).
  const modes: ExportMode[] = count <= 1 && !isMixed ? ['combined']
    : isMixed || currentFmt?.separateOnly ? ['separate', 'zip']
    : ['combined', 'separate', 'zip']
  const effectiveMode: ExportMode = modes.includes(mode) ? mode : modes[0]
  const named = effectiveMode !== 'separate'

  // Each export starts from the kind's default format.
  useEffect(() => {
    if (open && !isMixed) setFormat(defaultFormatForKind(singleKind))
  }, [open, singleKind, isMixed])

  // Update filename when the format, the output or defaultName changes
  useEffect(() => {
    if (effectiveMode === 'zip') {
      setFilename(`${defaultName}.zip`)
    } else if (isMixed) {
      setFilename('')
    } else {
      const ext = currentFmt?.ext ?? formatsForKind(singleKind)[0]?.ext ?? ''
      setFilename(`${defaultName}${ext}`)
    }
  }, [format, defaultName, currentFmt, isMixed, singleKind, effectiveMode])

  // Reset mode when opening
  useEffect(() => {
    if (open) setMode('combined')
  }, [open])

  // Focus and select the name part on open (when there is one name)
  useEffect(() => {
    if (!open || !named) return
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
  }, [open, named])

  const handleExport = useCallback(() => {
    if (!named) {
      onExport(format, '', 'separate')
    } else {
      const trimmed = filename.trim()
      if (!trimmed) return
      onExport(format, effectiveMode === 'zip' && !/\.zip$/i.test(trimmed) ? `${trimmed}.zip` : trimmed, effectiveMode)
    }
  }, [format, filename, effectiveMode, named, onExport])

  const { onMouseDown: handleBackdropClickDown, onClick: handleBackdropClick } = useBackdropDismiss(onClose)

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
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onMouseDown={handleBackdropClickDown} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
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
                {shown.map(fmt => {
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

          {/* What the chosen format keeps */}
          {!isMixed && currentFmt?.keeps && (
            <ul className="export-keeps" aria-label="What this file keeps">
              {currentFmt.keeps.map(x => (
                <li key={x.label} className={x.kept ? 'kept' : 'lost'} title={x.detail}>
                  {x.kept ? <Check size={11} aria-label="Kept:" /> : <X size={11} aria-label="Left out:" />}
                  {x.label}
                </li>
              ))}
            </ul>
          )}
          {open && !isMixed && warningsFor?.(format).map(w => (
            <div key={w} className="export-format-note">{w}</div>
          ))}

          {/* Mixed-kind default format note */}
          {isMixed && (
            <div className="export-info-note">
              Each item is written in its kind&apos;s default format: GenBank for sequences, FASTQ for reads, aligned FASTA for alignments and contigs.
            </div>
          )}

          {/* Annotations-only warning */}
          {!isMixed && currentFmt?.annotationsOnly && annotationCount === 0 && (
            <div className="export-format-note">
              This sequence has no annotations. The exported file will be empty.
            </div>
          )}

          {/* Output: one file, separate files, or one ZIP of them */}
          {modes.length > 1 && (
            <>
              <div className="export-filename-label">Output</div>
              <div className="seg export-mode-toggle">
                {modes.map(m => (
                  <button
                    key={m}
                    className={effectiveMode === m ? 'active' : ''}
                    onClick={() => setMode(m)}
                    title={MODE_HINT[m]}
                  >
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Filename or file preview */}
          {named ? (
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
              {effectiveMode === 'zip' && (
                <div className="export-file-preview-more">{count} files inside, one per item</div>
              )}
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
