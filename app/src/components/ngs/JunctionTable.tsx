/**
 * Soft-clip junctions of a mapping (ngs/junctions.ts), docked under its
 * reads: where reads stop aligning together, how many, what their clipped
 * bases are and where those continue. A row moves the view there with the
 * soft-clipped bases shown.
 */

import { memo } from 'react'
import { Tags, X } from 'lucide-react'
import { describeJunction, MIN_CLIP, MIN_READS, MIN_SHARE, type Junction } from '../../ngs/junctions'
import type { CallState } from './VariantTable'

const nf = new Intl.NumberFormat('en-US')

interface Props {
  junctions: readonly Junction[] | null
  state: CallState
  onFind: () => void
  onSelect: (j: Junction) => void
  selected: number | null
  refIndex: number
  refNames: readonly string[]
  canAnnotate: boolean
  annotateTitle: string
  onAnnotate: (js: readonly Junction[]) => void
  onClose: () => void
}

function JunctionTable(p: Props) {
  return (
    <section className="vt" aria-label="Junctions">
      <div className="vt-bar">
        <span className="vt-title">Junctions</span>
        <span className="aw-muted">
          {p.junctions ? `${nf.format(p.junctions.length)} where ${MIN_READS} or more reads (and ${Math.round(MIN_SHARE * 100)}% of those covering) are clipped by ${MIN_CLIP}+ bases` : ''}
        </span>
        <span className="aw-spacer" />
        <button className="aw-tool-btn" onClick={() => p.junctions && p.onAnnotate(p.junctions)}
          disabled={p.state.kind !== 'ready' || !p.junctions?.length || !p.canAnnotate} title={p.annotateTitle}>
          <Tags size={13} /> Add to the reference
        </button>
        <button className="aw-icon-btn" onClick={p.onClose} title="Hide the junctions" aria-label="Hide the junctions"><X size={14} /></button>
      </div>
      {p.state.kind === 'none' && (
        <div className="vt-empty">
          <p className="aw-note">
            Junctions are positions where many reads stop aligning at the same base: the edges of long deletions, inversions,
            inserted DNA, or a plasmid&apos;s junction with its vector. Every read is looked at once; the result is kept with the mapping.
          </p>
          <button className="btn btn-sm btn-primary" onClick={p.onFind}>Find junctions</button>
        </div>
      )}
      {p.state.kind === 'running' && (
        <div className="vt-empty">
          <p className="aw-note">Looking at every read… {Math.round(p.state.progress * 100)}%</p>
          <div className="ngs-progress"><div style={{ width: `${Math.round(p.state.progress * 100)}%` }} /></div>
        </div>
      )}
      {p.state.kind === 'error' && <div className="vt-empty"><p className="aw-note ngs-warn-note">{p.state.message}</p><button className="btn btn-sm" onClick={p.onFind}>Try again</button></div>}
      {p.state.kind === 'ready' && p.junctions && (
        <div className="vt-body jt-body">
          {p.junctions.length === 0 && <p className="aw-note vt-none">No junctions: the reads align right through everywhere.</p>}
          {p.junctions.length > 0 && (
            <table className="jt">
              <thead>
                <tr><th className="num">Position</th><th>Reads continue</th><th className="num">Reads</th><th className="num">Share</th><th>Clipped bases</th><th>Suggests</th></tr>
              </thead>
              <tbody>
                {p.junctions.map((j, i) => (
                  <tr key={`${j.side}${j.pos}`} className={i === p.selected ? 'selected' : ''} onClick={() => p.onSelect(j)}>
                    <td className="num">{nf.format(j.pos + (j.side === 'left' ? 1 : 0))}</td>
                    <td>{j.side === 'left' ? 'to the left as something else' : 'to the right as something else'}</td>
                    <td className="num">{nf.format(j.reads)} <span className="aw-muted">{j.forward}+/{j.reverse}−</span></td>
                    <td className="num">{Math.round((j.reads / Math.max(1, j.depth)) * 100)}%</td>
                    <td className="jt-seq" title={j.clipped}>{j.side === 'left' ? [...j.clipped.slice(0, 24)].reverse().join('') : j.clipped.slice(0, 24)}{j.clipped.length > 24 ? '…' : ''}</td>
                    <td>{describeJunction(j, p.refIndex, p.refNames)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}

export default memo(JunctionTable)
