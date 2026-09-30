/**
 * Getting oligo lists in and out of the library.
 *
 * Import takes pasted text or a file in any of the shapes primers are kept
 * in (see library-io.ts) and shows what it understood before anything is
 * added, including the lines it could not read. Export writes CSV, FASTA or
 * a vendor order sheet.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useExitAnimation } from '../../hooks/useExitAnimation'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import {
  parseOligoList, toCsv, toFasta, toOrderSheet, DEFAULT_ORDER,
  type ExportableOligo, type ParsedOligo,
} from '../../primers/library-io'
import { downloadText } from '../../utils/download'
import './primers.css'

function Modal({ open, title, onClose, children, footer }: {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  footer: React.ReactNode
}) {
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)
  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null
  return (
    <div
      className={closing ? 'modal-backdrop closing' : 'modal-backdrop'}
      onAnimationEnd={onAnimationEnd}
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose() }}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      tabIndex={-1}
    >
      <div className="modal-dialog nsm-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

export function OligoImportDialog({ open, onClose, onImport, targetLabel }: {
  open: boolean
  onClose: () => void
  onImport: (oligos: ParsedOligo[], where: 'library' | 'sequence') => void
  /** Name of the open sequence, when adding there is possible. */
  targetLabel?: string
}) {
  const [text, setText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) setText('') }, [open])

  const parsed = useMemo(() => parseOligoList(text), [text])
  const readFile = useCallback((file: File) => {
    file.text().then(setText)
  }, [])

  const add = (where: 'library' | 'sequence') => {
    if (parsed.oligos.length === 0) return
    onImport(parsed.oligos, where)
  }

  return (
    <Modal
      open={open}
      title="Add oligos"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          {targetLabel && (
            <button className="btn" disabled={parsed.oligos.length === 0} onClick={() => add('sequence')}>
              Add to {targetLabel}
            </button>
          )}
          <button className="btn btn-primary" disabled={parsed.oligos.length === 0} onClick={() => add('library')}>
            Add {parsed.oligos.length || ''} to library
          </button>
        </>
      }
    >
      <label className="nsm-label">
        Oligos
        <textarea
          className="input nsm-textarea"
          rows={8}
          spellCheck={false}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={'Paste a list: "name sequence" per line, a CSV/TSV with Name and Sequence columns, or FASTA.\n\nM13F\tTGTAAAACGACGGCCAGT\nM13R\tCAGGAAACAGCTATGAC'}
        />
      </label>
      <div className="ol-file-row">
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>Choose file…</button>
        <span className="wb-hint">.csv, .tsv, .txt or FASTA</span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,.fa,.fasta,.fas,text/*"
          hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = '' }}
        />
      </div>
      {parsed.oligos.length > 0 && (
        <table className="ol-preview" aria-label="Oligos found">
          <thead><tr><th>Name</th><th>Sequence</th><th>nt</th></tr></thead>
          <tbody>
            {parsed.oligos.slice(0, 50).map((o, i) => (
              <tr key={i}>
                <td>{o.name}{o.role === 'probe' ? ' (probe)' : ''}</td>
                <td className="oligo-seq">{o.sequence}</td>
                <td>{o.sequence.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {parsed.oligos.length > 50 && <div className="wb-hint">…and {parsed.oligos.length - 50} more</div>}
      {parsed.skipped.length > 0 && (
        <div className="pl-error ol-skipped">
          Skipped {parsed.skipped.length} line{parsed.skipped.length === 1 ? '' : 's'}:{' '}
          {parsed.skipped.slice(0, 5).map(s => `line ${s.line} (${s.reason})`).join('; ')}
          {parsed.skipped.length > 5 ? '…' : ''}
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------

type ExportFormat = 'csv' | 'fasta' | 'order'

export function OligoExportDialog({ open, onClose, oligos, baseName }: {
  open: boolean
  onClose: () => void
  oligos: readonly ExportableOligo[]
  baseName: string
}) {
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [scale, setScale] = useState(DEFAULT_ORDER.scale)
  const [purification, setPurification] = useState(DEFAULT_ORDER.purification)

  const download = () => {
    const safe = baseName.replace(/[^\w.-]+/g, '_') || 'oligos'
    if (format === 'csv') downloadText(toCsv(oligos), `${safe}.csv`, 'text/csv')
    else if (format === 'fasta') downloadText(toFasta(oligos), `${safe}.fasta`, 'text/plain')
    else downloadText(toOrderSheet(oligos, { scale, purification }), `${safe}_order.tsv`, 'text/tab-separated-values')
    onClose()
  }

  return (
    <Modal
      open={open}
      title={`Export ${oligos.length} oligo${oligos.length === 1 ? '' : 's'}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={oligos.length === 0} onClick={download}>Download</button>
        </>
      }
    >
      <label className="nsm-label">
        Format
        <select className="input nsm-input" value={format} onChange={e => setFormat(e.target.value as ExportFormat)}>
          <option value="csv">CSV (name, sequence, length, role, notes)</option>
          <option value="fasta">FASTA</option>
          <option value="order">Order sheet (tab-separated)</option>
        </select>
      </label>
      {format === 'order' && (
        <>
          <div className="ol-order-row">
            <label className="nsm-label">
              Scale
              <input className="input nsm-input" value={scale} onChange={e => setScale(e.target.value)} />
            </label>
            <label className="nsm-label">
              Purification
              <input className="input nsm-input" value={purification} onChange={e => setPurification(e.target.value)} />
            </label>
          </div>
          <div className="wb-hint">
            Columns Name, Sequence, Scale, Purification, as bulk-entry forms such as IDT’s take them.
            Scale and purification are passed through as typed: use your vendor’s codes, and check
            the sheet against the vendor’s current template before ordering.
          </div>
        </>
      )}
    </Modal>
  )
}
