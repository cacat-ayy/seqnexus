/**
 * Building many constructs from the same design.
 *
 * Each position in the assembly becomes a bin, and a bin can hold more than
 * one part. The run is every way of taking one part from each (which is what
 * a combinatorial library is), and a vector against a list of inserts is just
 * the two-bin case of the same thing.
 *
 * Parts can be read from a spreadsheet, because a library is usually already
 * written down as one, and the table of what came out goes back to a file.
 */

import { useCallback, useRef, useState } from 'react'
import { Download, FileUp, FolderPlus, Play, Trash2, X } from 'lucide-react'
import { notify } from '../../toast'
import { saveText } from '../../utils/download'
import {
  combinationCount,
  summarise,
  type BulkResult,
  type BulkRow,
  type DesignBin,
} from '../../cloning/bulk'
import { parsePartList, productTableCsv, productsFasta } from '../../cloning/bulk-io'
import { partLength, type CloningDesign, type DesignPart } from '../../cloning/design'
import { startBulk } from '../../workers/cloning'
import { partColor } from './colors'
import { formatBp } from '../../utils/format'

interface Props {
  design: CloningDesign
  bins: DesignBin[]
  onBinsChange: (bins: DesignBin[]) => void
  /** Open one construct as a sequence. */
  onOpenRow: (row: BulkRow) => void
  /** Keep every construct that came out as designed. */
  onSaveRows: (rows: BulkRow[], folderName: string) => void
}

const LIMIT = 500

export default function LibraryPanel({ design, bins, onBinsChange, onOpenRow, onSaveRows }: Props) {
  const [result, setResult] = useState<BulkResult | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [template, setTemplate] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  const total = combinationCount(bins)
  const running = progress !== null

  const run = useCallback(() => {
    if (total === 0) return
    setResult(null)
    setProgress({ done: 0, total: Math.min(total, LIMIT) })
    const handle = startBulk(
      { design, bins, limit: LIMIT, ...(template.trim() ? { nameTemplate: template } : {}) },
      (done, count) => setProgress({ done, total: count }),
    )
    cancelRef.current = handle.cancel
    handle.promise
      .then(r => {
        setResult(r)
        const counts = summarise(r.rows)
        notify.success(`${counts.ok} of ${r.rows.length} came out as designed`)
      })
      .catch(err => notify.error(err instanceof Error ? err.message : String(err)))
      .finally(() => { setProgress(null); cancelRef.current = null })
  }, [design, bins, template, total])

  const stop = useCallback(() => {
    cancelRef.current?.()
    cancelRef.current = null
    setProgress(null)
  }, [])

  const importFile = useCallback(async (file: File) => {
    const text = await file.text()
    const { bins: read, skipped } = parsePartList(text)
    if (read.length === 0) {
      notify.error(skipped[0]?.reason ?? 'Nothing in that file could be read as a part list')
      return
    }
    onBinsChange(read)
    setResult(null)
    const parts = read.reduce((n, b) => n + b.parts.length, 0)
    notify.success(
      `${parts} parts in ${read.length} position${read.length === 1 ? '' : 's'}` +
      (skipped.length > 0 ? `; ${skipped.length} line${skipped.length === 1 ? '' : 's'} skipped` : ''),
    )
  }, [onBinsChange])

  const renameBin = (id: string, name: string) => {
    onBinsChange(bins.map(b => (b.id === id ? { ...b, name } : b)))
  }

  const removeBin = (id: string) => {
    onBinsChange(bins.filter(b => b.id !== id))
    setResult(null)
  }

  const removePart = (binId: string, partId: string) => {
    onBinsChange(bins.map(b => (b.id === binId ? { ...b, parts: b.parts.filter(p => p.id !== partId) } : b)))
    setResult(null)
  }

  const counts = result ? summarise(result.rows) : null
  const keepable = result ? result.rows.filter(r => r.verdict === 'ok') : []

  return (
    <div className="cw-library">
      <div className="cw-library-bar">
        <button className="cw-btn" onClick={() => fileRef.current?.click()} title="Read a part list from a spreadsheet">
          <FileUp size={13} /> Import parts
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt"
          hidden
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) void importFile(file)
            e.target.value = ''
          }}
        />
        <label className="cw-part-field cw-template">
          <span className="cw-part-label">Name</span>
          <input
            className="input"
            value={template}
            placeholder="{1}-{2}"
            aria-label="Naming template"
            onChange={e => setTemplate(e.target.value)}
          />
        </label>
        <span className="cw-spacer" />
        {running ? (
          <>
            <span className="cw-progress">{progress.done} / {progress.total}</span>
            <button className="cw-btn" onClick={stop}>Stop</button>
          </>
        ) : (
          <button className="cw-btn primary" onClick={run} disabled={total === 0}>
            <Play size={13} /> Build {total > 0 ? `${Math.min(total, LIMIT)} construct${total === 1 ? '' : 's'}` : ''}
          </button>
        )}
      </div>

      {total > LIMIT && (
        <p className="cw-blurb">
          These positions describe {total.toLocaleString()} constructs; the first {LIMIT} will be built.
        </p>
      )}

      <div className="cw-bins">
        {bins.length === 0 && (
          <p className="cw-hint">
            No positions yet. Add the parts to the design and switch here, or import a part list.
          </p>
        )}
        {bins.map((bin, binIndex) => (
          <div key={bin.id} className="cw-bin">
            <div className="cw-bin-head">
              <input
                className="cw-bin-name"
                value={bin.name}
                aria-label="Position name"
                onChange={e => renameBin(bin.id, e.target.value)}
              />
              <span className="cw-bin-count">
                {bin.parts.length} {bin.parts.length === 1 ? 'choice' : 'choices'}
              </span>
              <button className="cw-icon-btn" onClick={() => removeBin(bin.id)} title="Remove this position">
                <Trash2 size={13} />
              </button>
            </div>
            <div className="cw-bin-parts">
              {bin.parts.map((part: DesignPart) => (
                <span key={part.id} className="cw-chip">
                  <span className="cw-chip-dot" style={{ background: partColor(binIndex) }} aria-hidden="true" />
                  {part.name}
                  <span className="cw-chip-size">{formatBp(partLength(part))}</span>
                  <button
                    className="cw-chip-x"
                    onClick={() => removePart(bin.id, part.id)}
                    aria-label={`Remove ${part.name}`}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              {bin.parts.length === 0 && <span className="cw-hint">Nothing in this position</span>}
            </div>
          </div>
        ))}
      </div>

      {result && (
        <div className="cw-results">
          <div className="cw-results-bar">
            <span className="cw-results-counts">
              <strong>{counts!.ok}</strong> as designed
              {counts!.ambiguous > 0 && <> · {counts!.ambiguous} not as designed</>}
              {counts!.none > 0 && <> · {counts!.none} nothing</>}
            </span>
            <span className="cw-spacer" />
            <button
              className="cw-btn"
              disabled={keepable.length === 0}
              onClick={() => onSaveRows(keepable, 'Library')}
              title="Keep every construct that came out as designed"
            >
              <FolderPlus size={13} /> Keep {keepable.length}
            </button>
            <button
              className="cw-btn"
              onClick={() => saveText(productTableCsv(result), 'constructs.csv', 'text/csv')}
            >
              <Download size={13} /> Table
            </button>
            <button
              className="cw-btn"
              disabled={keepable.length === 0}
              onClick={() => saveText(productsFasta(result.rows), 'constructs.fasta', 'text/plain')}
            >
              <Download size={13} /> FASTA
            </button>
          </div>

          <div className="cw-table-wrap">
            <table className="cw-table">
              <thead>
                <tr>
                  <th>Construct</th>
                  {result.binNames.map((name, i) => <th key={i}>{name}</th>)}
                  <th>Size</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr
                    key={i}
                    className={`cw-row-${row.verdict}`}
                    onDoubleClick={() => row.product && onOpenRow(row)}
                    title={row.notes.join('\n')}
                  >
                    <td className="cw-cell-name">{row.name}</td>
                    {result.binNames.map((_, b) => <td key={b}>{row.partNames[b] ?? ''}</td>)}
                    <td className="cw-cell-size">{row.size > 0 ? formatBp(row.size) : '-'}</td>
                    <td>
                      {row.verdict === 'ok' && <span className="cw-tag good">as designed</span>}
                      {row.verdict === 'ambiguous' && <span className="cw-tag warn">not as designed</span>}
                      {row.verdict === 'none' && <span className="cw-tag">nothing</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cw-line-caption">Double-click a row to open that construct.</p>
        </div>
      )}
    </div>
  )
}
