/**
 * The sample's sequence from a mapping (see siteConsensus in ngs/calls.ts):
 * the reference where the reads agree with it, their alleles where they do
 * not, N where too few reads cover. Opened as a new sequence or saved as
 * FASTA, for one reference or all of them.
 */

import { useEffect, useRef, useState } from 'react'
import { FileOutput, X } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useEditorStore } from '../../store'
import { notify } from '../../toast'
import { saveText } from '../../utils/download'
import { toFasta } from '../../sanger/edits'
import { DEFAULT_CONSENSUS_SETTINGS, siteConsensus, type ConsensusSettings } from '../../ngs/calls'
import type { MappingSource } from '../../ngs/view'
import { liftFeatures } from '../../ngs/denovo/compare'
import { Sequence } from '../../models/Sequence'
import { Annotation, type AnnotationData } from '../../models/Annotation'

const nf = new Intl.NumberFormat('en-US')
let remembered: ConsensusSettings = DEFAULT_CONSENSUS_SETTINGS

interface Props {
  source: MappingSource
  /** The reference shown, and the name of the mapping. */
  refIndex: number
  name: string
  /** Comes back to the mapping after opening sequences. */
  assemblyId: string
  /** A reference's features, carried over to its consensus. */
  featuresOf: (refIndex: number) => AnnotationData[]
  onClose: () => void
}

export default function ConsensusDialog({ source, refIndex, name, assemblyId, featuresOf, onClose }: Props) {
  const [s, setS] = useState(remembered)
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ length: number; masked: number; changed: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  const refs = source.refs
  const which = all ? refs.map((_, i) => i) : [refIndex]

  const build = async (i: number) => {
    const [bases, coverage, calls] = await Promise.all([source.reference(i), source.coverage(i), source.calls(i)])
    return { ref: refs[i], ...siteConsensus(bases, coverage, calls ?? [], s) }
  }

  useEffect(() => {
    remembered = s
    let alive = true
    build(refIndex).then(r => { if (alive) setPreview({ length: r.bases.length, masked: r.masked, changed: r.changed }) }).catch(() => {})
    return () => { alive = false }
  }, [s, refIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  const title = (i: number) => (refs.length > 1 ? `${name} ${refs[i].name} consensus` : `${name} consensus`)
  const describe = (r: Awaited<ReturnType<typeof build>>) =>
    `Consensus of ${name} on ${r.ref.name}: alleles reaching ${Math.round(s.threshold * 100)}% of the reads, N below ${s.minDepth} reads${s.iupac ? ', mixed bases as IUPAC codes' : ''}`

  const open = async () => {
    setBusy(true)
    try {
      const store = useEditorStore.getState()
      let last = ''
      let carried = 0
      const dropped: string[] = []
      const changed: string[] = []
      for (const i of which) {
        const r = await build(i)
        // The reference's features, moved past the reads' insertions and
        // deletions; one the reads delete entirely is left out.
        const lifted = liftFeatures(featuresOf(i).filter(f => f.type !== 'source'), { toContig: r.toConsensus, bases: r.bases }, r.ref.circular)
        carried += lifted.features.length
        dropped.push(...lifted.dropped)
        changed.push(...lifted.changed)
        last = store.openDocumentState({
          name: title(i),
          description: describe(r),
          sequence: new Sequence(r.bases, r.ref.circular ? 'circular' : 'linear'),
          annotations: lifted.features.map(f => new Annotation(f)),
          metadata: { origin: 'consensus' },
        })
      }
      store.setActiveAssembly(assemblyId)
      const detail = [
        dropped.length ? `Left out, deleted in the reads: ${dropped.join(', ')}` : '',
        changed.length ? `Length changed: ${changed.join(', ')}` : '',
      ].filter(Boolean).join('. ')
      const what = which.length === 1 ? 'Opened the consensus as a new sequence' : `Opened ${which.length} consensus sequences`
      notify.success(`${what}, with ${carried} ${carried === 1 ? 'feature' : 'features'}`,
        { ...(detail ? { detail } : {}), action: { label: 'Show', onClick: () => useEditorStore.getState().setActiveTab(last) } })
      onClose()
    } catch (err) {
      notify.error('Could not build the consensus', { detail: err instanceof Error ? err.message : String(err) })
    } finally { setBusy(false) }
  }

  const save = async () => {
    setBusy(true)
    try {
      const parts: string[] = []
      for (const i of which) {
        const r = await build(i)
        parts.push(toFasta(title(i).replace(/\s+/g, '_'), r.bases))
      }
      saveText(parts.join(''), `${name.replace(/[\\/:*?"<>|\s]+/g, '_')}_consensus.fasta`)
      onClose()
    } catch (err) {
      notify.error('Could not build the consensus', { detail: err instanceof Error ? err.message : String(err) })
    } finally { setBusy(false) }
  }

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="aw-figure ngs-trim" ref={ref} role="dialog" aria-modal="true" aria-label="Consensus sequence"
        onKeyDown={e => { if (e.key === 'Escape' && !busy) onClose() }}>
        <div className="aw-popover-head">
          <FileOutput size={14} /> <span>Consensus sequence</span>
          <button className="aw-icon-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="ngs-trim-body aw-stack">
          <p className="aw-note">
            The reference with the reads&apos; alleles written in, as ivar consensus does it: at each position the alleles are taken,
            commonest first, until together they reach the threshold.
          </p>
          <label className="aw-field">
            <span>Threshold: alleles reaching {Math.round(s.threshold * 100)}% of the reads</span>
            <input type="range" min={0.5} max={1} step={0.05} value={s.threshold} onChange={e => setS({ ...s, threshold: Number(e.target.value) })} />
          </label>
          <label className="aw-field">
            <span>Write N where fewer reads than this cover</span>
            <input className="aw-text" type="number" min={0} max={100000} value={s.minDepth}
              onChange={e => setS({ ...s, minDepth: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
          </label>
          <label className="ngs-check">
            <input type="checkbox" checked={s.iupac} onChange={e => setS({ ...s, iupac: e.target.checked })} />
            Mixed positions as IUPAC codes (R for A or G, and so on)
          </label>
          {refs.length > 1 && (
            <label className="ngs-check">
              <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />
              Every reference ({refs.length}), not only {refs[refIndex].name}
            </label>
          )}
          {preview && (
            <p className="aw-note">
              {refs[refIndex].name}: {nf.format(preview.length)} bp, {nf.format(preview.changed)} {preview.changed === 1 ? 'position' : 'positions'} differ
              from the reference, {nf.format(preview.masked)} bp written as N.
            </p>
          )}
          <div className="tw-trim-actions">
            <button className="btn btn-sm" onClick={save} disabled={busy}>Save as FASTA</button>
            <button className="btn btn-sm btn-primary" onClick={open} disabled={busy}>Open as a sequence</button>
          </div>
        </div>
      </div>
    </div>
  )
}
