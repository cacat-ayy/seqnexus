/**
 * Bulk action bar for the feature sidebar.
 *
 * Appears only while features are selected. Every action routes through a
 * plural store action so it lands as a single undoable step — the whole point
 * of the batch layer underneath.
 */

import { useState, useRef, useCallback } from 'react'
import { Trash2, Eye, EyeOff, Copy, Download, X } from 'lucide-react'
import type { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { useEditorStore } from '../store'
import { FEATURE_TYPES } from '../utils/annotation-constants'
import { annotationBases } from '../utils/annotation-sequence'
import { downloadText } from '../utils/download'
import { writeGff3 } from '../io/gff3'
import { writeCsv } from '../io/csv'
import './FeatureBulkBar.css'

interface Props {
  /** The selected annotations, in list order. */
  selected: Annotation[]
  onClear: () => void
  onRequestDelete: () => void
  onCopyFeedback?: (msg: string) => void
}

export default function FeatureBulkBar({
  selected, onClear, onRequestDelete, onCopyFeedback,
}: Props) {
  const doc = useEditorStore(s => s.doc)
  const hiddenIds = useEditorStore(s => s.hiddenAnnotationIds)
  const updateAnnotations = useEditorStore(s => s.updateAnnotations)
  const setAnnotationsVisibility = useEditorStore(s => s.setAnnotationsVisibility)
  const readOnly = useEditorStore(s => s.readOnly)

  const [exportOpen, setExportOpen] = useState(false)
  const colorDragKey = useRef<string | null>(null)

  const ids = selected.map(a => a.id)
  const count = selected.length
  const hiddenSet = new Set(hiddenIds)
  const allHidden = count > 0 && selected.every(a => hiddenSet.has(a.id))

  const handleType = useCallback((type: string) => {
    if (type) updateAnnotations(ids, { type })
  }, [ids, updateAnnotations])

  const handleVisibility = useCallback(() => {
    setAnnotationsVisibility(ids, !allHidden)
  }, [ids, allHidden, setAnnotationsVisibility])

  /** Selected features as a multi-record FASTA, in list order. */
  const handleCopy = useCallback(() => {
    const fasta = selected
      .map(a => `>${a.name || a.id} ${a.start + 1}..${a.end}\n${annotationBases(a, doc.sequence)}`)
      .join('\n')
    navigator.clipboard.writeText(fasta)
      .then(() => onCopyFeedback?.(`Copied ${count} feature${count === 1 ? '' : 's'}`))
      .catch(e => console.warn('Clipboard write failed:', e))
  }, [selected, doc.sequence, count, onCopyFeedback])

  /**
   * The writers take a whole DocumentState, so a shallow clone carrying only
   * the selected annotations reuses them unchanged.
   */
  const exportSubset = useCallback((format: 'gff3' | 'csv') => {
    const subset: DocumentState = { ...doc, annotations: selected }
    const base = (doc.name || 'features').replace(/\.[^.]+$/, '')
    if (format === 'gff3') downloadText(writeGff3(subset), `${base}_features.gff3`, 'text/plain')
    else downloadText(writeCsv(subset), `${base}_features.csv`, 'text/csv')
    setExportOpen(false)
  }, [doc, selected])

  return (
    <div className="fbb" role="toolbar" aria-label={`${count} features selected`}>
      <span className="fbb-count">{count} selected</span>

      <div className="fbb-actions">
        <select
          className="fbb-type"
          value=""
          disabled={readOnly}
          onChange={e => { handleType(e.target.value); e.currentTarget.value = '' }}
          aria-label="Change type of selected features"
        >
          <option value="" disabled>Type…</option>
          {FEATURE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <label className="fbb-color" title="Change color of selected features">
          <span className="fbb-color-swatch" style={{ backgroundColor: selected[0]?.color ?? '#adb5bd' }} />
          <input
            type="color"
            className="fbb-color-input"
            disabled={readOnly}
            value={selected[0]?.color ?? '#adb5bd'}
            // Same coalescing rule as the group pickers: a drag fires on every
            // frame and must still collapse to one undo entry.
            onPointerDown={() => { colorDragKey.current = `bulk-color:${Date.now()}` }}
            onFocus={() => { colorDragKey.current = `bulk-color:${Date.now()}` }}
            onChange={e => updateAnnotations(
              ids,
              { color: e.target.value },
              { coalesceKey: colorDragKey.current ?? undefined },
            )}
          />
        </label>

        <button className="fbb-btn" onClick={handleVisibility}
          title={allHidden ? 'Show selected' : 'Hide selected'}>
          {allHidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>

        <button className="fbb-btn" onClick={handleCopy} title="Copy selected as FASTA">
          <Copy size={13} />
        </button>

        <div className="fbb-export">
          <button
            className="fbb-btn"
            onClick={() => setExportOpen(v => !v)}
            title="Export selected"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
          >
            <Download size={13} />
          </button>
          {exportOpen && (
            <div className="fbb-export-menu" role="menu">
              <button className="fbb-export-item" role="menuitem" onClick={() => exportSubset('gff3')}>GFF3</button>
              <button className="fbb-export-item" role="menuitem" onClick={() => exportSubset('csv')}>CSV</button>
            </div>
          )}
        </div>

        <button
          className="fbb-btn fbb-danger"
          onClick={onRequestDelete}
          disabled={readOnly}
          title="Delete selected"
        >
          <Trash2 size={13} />
        </button>

        <button className="fbb-btn" onClick={onClear} title="Clear selection">
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
