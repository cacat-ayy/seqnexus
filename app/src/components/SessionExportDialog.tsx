/**
 * Modal for exporting the entire session as a .seqnexus.json file.
 *
 * Shows checkboxes for each data category with item counts and
 * an estimated file size. Sequences are always included, and so are the
 * small kinds (gels, cloning designs, oligos, guides, enzyme sets), which
 * are listed so the file's contents are not a guess.
 *
 * NGS read sets are never written: their reads can run to hundreds of
 * megabytes. The dialog says so and lists them, each a click from its own
 * view, where Export as FASTQ keeps a copy. The option once called
 * "Sequencing reads" counted Sanger chromatograms only, so with read sets
 * open it showed 0 and was greyed out with no word about why.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { X, Download, Info } from 'lucide-react'
import { useEditorStore } from '../store'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { estimateExportSize, type SessionExportOptions } from '../persistence'
import { formatBytes } from '../utils/format'
import { useBackdropDismiss } from '../hooks/useBackdropDismiss'
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
  const readSets = useEditorStore(s => s.readSets)
  const gels = useEditorStore(s => s.gels)
  const clones = useEditorStore(s => s.clones)
  const oligos = useEditorStore(s => s.oligos)
  const guides = useEditorStore(s => s.guideLibrary)
  const enzymeSets = useEditorStore(s => s.enzymeSets)
  const assemblies = useEditorStore(s => s.assemblies)
  /**
   * The "contigs" option writes assemblies and their contigs together. It
   * counted contigs alone, so a workspace of NGS mappings (assemblies with
   * no contigs) had the option greyed out and the mappings left out.
   */
  /** NGS mappings: their mapped reads are stored in this browser, as a read set's are. */
  const ngsMappings = assemblies.filter(a => a.samples?.some(sample => sample.storageId)).length
  const assemblyCount = assemblies.length + contigs.filter(c => !assemblies.some(a => a.id === c.assemblyId)).length

  const [includeReads, setIncludeReads] = useState(true)
  const [includeAlignments, setIncludeAlignments] = useState(true)
  const [includeContigs, setIncludeContigs] = useState(true)
  const [filename, setFilename] = useState('session.seqnexus.json')

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setIncludeReads(reads.length > 0)
      setIncludeAlignments(alignments.length > 0)
      setIncludeContigs(assemblyCount > 0)
      setFilename('session.seqnexus.json')
    }
  }, [open, reads.length, alignments.length, assemblyCount])

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
  const { onMouseDown: handleBackdropClickDown, onClick: handleBackdropClick } = useBackdropDismiss(onClose)

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  const handleExport = useCallback(() => {
    const name = filename.trim() || 'session.seqnexus.json'
    onExport(name.endsWith('.json') ? name : name + '.json', opts)
    onClose()
  }, [filename, opts, onExport, onClose])

  if (!visible) return null

  const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`
  /** Written whatever the checkboxes say. */
  const always = ([
    [gels.length, 'gel', 'gels'],
    [clones.length, 'cloning design', 'cloning designs'],
    [oligos.length, 'oligo', 'oligos'],
    [guides.length, 'guide', 'guides'],
    [enzymeSets.length, 'enzyme set', 'enzyme sets'],
  ] as const).filter(([n]) => n > 0).map(([n, one, many]) => count(n, one, many))
  // Anything at all to write. Sequences used to be required, so a workspace
  // of reads, gels or assemblies could not be backed up.
  const empty = tabs.length + reads.length + alignments.length + contigs.length + assemblies.length
    + gels.length + clones.length + oligos.length + guides.length + enzymeSets.length === 0

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onMouseDown={handleBackdropClickDown} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
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
            <span>Sanger chromatograms ({reads.length})</span>
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

          <label className={assemblyCount === 0 ? 'session-option is-empty' : 'session-option'}>
            <input
              type="checkbox"
              checked={includeContigs}
              disabled={assemblyCount === 0}
              onChange={e => setIncludeContigs(e.target.checked)}
            />
            <span>Assemblies and mappings ({assemblyCount})</span>
          </label>

          {always.length > 0 && (
            <p className="session-note">Also included: {always.join(', ')}.</p>
          )}

          {(readSets.length > 0 || ngsMappings > 0) && (
            <div className="session-readsets" role="note">
              <div className="session-readsets-title">
                <Info size={14} />
                {readSets.length === 0 ? 'NGS reads stay' : readSets.length === 1 ? '1 NGS read set stays' : `${readSets.length} NGS read sets stay`} in this browser
              </div>
              <p className="session-readsets-text">
                NGS reads can run to hundreds of megabytes, so session files leave them out.
                {readSets.length > 0 && ' To keep a copy of a read set, open it and use Export as FASTQ.'}
                {ngsMappings > 0 && ` The reads behind ${ngsMappings === 1 ? 'the NGS mapping' : `the ${ngsMappings} NGS mappings`} are stored the same way: the file keeps ${ngsMappings === 1 ? 'its' : 'each'} record, not ${ngsMappings === 1 ? 'its' : 'their'} reads.`}
              </p>
              {readSets.length > 0 && <ul className="session-readsets-list">
                {readSets.map(rs => (
                  <li key={rs.id}>
                    <span className="session-readsets-name">{rs.name}</span>
                    <span className="session-option-hint">{rs.discardedAt ? 'reads deleted' : formatBytes(rs.storedBytes)}</span>
                    <button
                      className="session-link"
                      onClick={() => { onClose(); useEditorStore.getState().setActiveReadSet(rs.id) }}
                    >
                      Open
                    </button>
                  </li>
                ))}
              </ul>}
            </div>
          )}

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
          <button className="btn btn-primary" onClick={handleExport} disabled={empty}>
            <Download size={14} />
            Export
          </button>
        </div>
      </div>
    </div>
  )
}
