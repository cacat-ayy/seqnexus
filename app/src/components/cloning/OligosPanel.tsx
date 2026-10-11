/**
 * The oligos this design needs ordering.
 *
 * Each part is amplified with a pair whose 5' tails carry whatever the method
 * needs: a homology arm copied from the neighbouring part, or the enzyme's
 * site, a spacer and the overhang that decides where the part goes. The
 * binding half is sized by the app's own primer designer, so these melt where
 * the rest of its primers do.
 *
 * A Type IIS part that already carries its sites, which is what a part out of
 * a kit or a previous assembly is, needs nothing ordered for it: it says so
 * and the overhangs it is built around are kept for its neighbours.
 *
 * Nothing here changes the design: it says what to order to build it.
 */

import { useMemo } from 'react'
import { Copy, Download, FlaskConical, Library } from 'lucide-react'
import { notify } from '../../toast'
import { downloadText } from '../../utils/download'
import { useEditorStore } from '../../store'
import { getEnzyme } from '../../enzymes/db'
import { planJunctionReads } from '../../cloning/verify'
import type { Assembly } from '../../cloning/product'
import { designAssemblyOligos, planTypeIISOligos, type OligoPair, type OligoTarget } from '../../cloning/oligos'
import {
  partBases,
  partLength,
  partTopology,
  vectorsFirst,
  type CloningDesign,
  type DesignPart,
} from '../../cloning/design'

interface Props {
  design: CloningDesign
  /** The construct these oligos are for, when one has formed. */
  product?: Assembly | null
  onClose: () => void
}

/** A part as something to amplify. A whole plasmid is opened at its origin. */
function targetOf(part: DesignPart): OligoTarget {
  const bases = part.bases
  const circular = partTopology(part) === 'circular'
  if (part.region) {
    return { name: part.name, template: bases, topology: part.topology, start: part.region.start, end: part.region.end }
  }
  if (circular) {
    // Round the whole plasmid from one point, which is how a backbone is
    // amplified when it is not being cut out.
    return { name: part.name, template: bases, topology: 'circular', start: 0, end: 0 }
  }
  return { name: part.name, template: bases, topology: 'linear', start: 0, end: bases.length }
}

function fastaOf(pairs: OligoPair[]): string {
  const lines: string[] = []
  for (const pair of pairs) {
    for (const oligo of [pair.forward, pair.reverse]) {
      if (!oligo.sequence) continue
      lines.push(`>${oligo.name}`, oligo.sequence)
    }
  }
  return lines.join('\n')
}

function csvOf(pairs: OligoPair[]): string {
  const rows = [['Name', 'Sequence', 'Length', 'Binding Tm (°C)', 'Tail', 'Notes'].join(',')]
  for (const pair of pairs) {
    for (const oligo of [pair.forward, pair.reverse]) {
      if (!oligo.sequence) continue
      rows.push([
        oligo.name,
        oligo.sequence,
        String(oligo.sequence.length),
        oligo.tm.toFixed(1),
        oligo.tail,
        pair.warnings.join('; ').replace(/,/g, ';'),
      ].map(c => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
    }
  }
  return rows.join('\n')
}

export default function OligosPanel({ design, product, onClose }: Props) {
  const addLibraryOligos = useEditorStore(s => s.addLibraryOligos)
  const parts = useMemo(() => vectorsFirst(design.parts), [design.parts])

  // Both the pairs and the overhangs they were built around come out of one
  // pass: choosing a fresh overhang set on every render would hand back
  // different primers each time.
  const { pairs, overhangsUsed, overhangsFromParts } = useMemo(() => {
    const none = { pairs: [] as OligoPair[], overhangsUsed: [] as string[], overhangsFromParts: [] as string[] }
    if (parts.length === 0) return none
    const targets = parts.map(targetOf)

    if (design.method === 'golden-gate') {
      const enzyme = getEnzyme(design.typeIIS)
      if (!enzyme) return none
      const plan = planTypeIISOligos(
        parts.map((part, i) => ({
          target: targets[i],
          bases: partBases(part),
          topology: partTopology(part),
        })),
        enzyme,
      )
      return { pairs: plan.pairs, overhangsUsed: plan.chosen, overhangsFromParts: plan.fromParts }
    }

    if (design.method === 'homology') {
      return { ...none, pairs: designAssemblyOligos(targets, { kit: design.kit }) }
    }

    return none
  }, [parts, design.method, design.typeIIS, design.kit])
  // Reads that confirm the construct once it is built: one across each seam,
  // which is where a cloning reaction goes wrong.
  const verify = useMemo(() => (product ? planJunctionReads(product) : null), [product])

  const supported = design.method === 'homology' || design.method === 'golden-gate'
  const usable = pairs.filter(p => p.forward.sequence && p.reverse.sequence)

  const saveReads = () => {
    if (!verify) return
    const ids = addLibraryOligos(verify.reads.map(read => ({
      name: read.name,
      role: 'primer' as const,
      sequence: read.primer.sequence.toUpperCase(),
      notes: `Reads across junction ${read.junction + 1} at ${read.at}. Tm ${read.primer.tm.toFixed(1)} °C.`,
    })))
    notify.success(`${ids.length} sequencing primers added to the library`)
  }

  const save = () => {
    const incoming = usable.flatMap(pair => [pair.forward, pair.reverse]).map(o => ({
      name: o.name,
      sequence: o.sequence.toUpperCase(),
      role: 'primer' as const,
      notes: `Designed for cloning. Tail: ${o.tail || 'none'}. Binding Tm ${o.tm.toFixed(1)} °C.`,
    }))
    const ids = addLibraryOligos(incoming)
    notify.success(`${ids.length} oligos added to the library`)
  }

  return (
    <div className="cw-oligos">
      <div className="cw-library-bar">
        <FlaskConical size={14} className="cw-header-icon" />
        <strong className="cw-oligo-title">Oligos to order</strong>
        <span className="cw-spacer" />
        <button className="cw-btn" onClick={save} disabled={usable.length === 0}>
          <Library size={13} /> Add {usable.length * 2} to library
        </button>
        <button
          className="cw-btn"
          disabled={usable.length === 0}
          onClick={() => downloadText(csvOf(pairs), 'oligos.csv', 'text/csv')}
        >
          <Download size={13} /> CSV
        </button>
        <button
          className="cw-btn"
          disabled={usable.length === 0}
          onClick={() => {
            void navigator.clipboard?.writeText(fastaOf(pairs))
            notify.success('Oligos copied as FASTA')
          }}
        >
          <Copy size={13} /> Copy
        </button>
        <button className="cw-btn" onClick={onClose}>Done</button>
      </div>

      {!supported && (
        <p className="cw-hint">
          Oligos are designed for seamless assembly and Golden Gate. The other methods join
          sequences you already have rather than ones you amplify.
        </p>
      )}

      {supported && parts.length === 0 && (
        <p className="cw-hint">Add the parts first and the primers for them will appear here.</p>
      )}

      {overhangsFromParts.length > 0 && (
        <p className="cw-blurb">
          Overhangs the parts already carry: {overhangsFromParts.join(', ')}.
        </p>
      )}

      {overhangsUsed.length > 0 && (
        <p className="cw-blurb">
          Overhangs chosen so they do not cross-react: {overhangsUsed.join(', ')}.
        </p>
      )}

      {pairs.length > 0 && (
        <div className="cw-table-wrap">
          <table className="cw-table">
            <thead>
              <tr>
                <th>Oligo</th>
                <th>Sequence 5′→3′</th>
                <th>nt</th>
                <th>Tm</th>
              </tr>
            </thead>
            <tbody>
              {pairs.flatMap((pair, i) => (pair.ready
                // One row for a part that needs nothing ordered, rather than
                // two rows of blanks where its primers would have been.
                ? [(
                  <tr key={`${i}-ready`}>
                    <td className="cw-cell-name">{pair.partName}</td>
                    <td className="cw-oligo-seq"><span className="cw-hint">{pair.ready}</span></td>
                    <td className="cw-cell-size">-</td>
                    <td className="cw-cell-size">-</td>
                  </tr>
                )]
                : [pair.forward, pair.reverse].map((oligo, j) => (
                  <tr key={`${i}-${j}`}>
                    <td className="cw-cell-name">{oligo.name}</td>
                    <td className="cw-oligo-seq">
                      {oligo.sequence
                        ? <><span className="cw-oligo-tail">{oligo.tail}</span>{oligo.anneal}</>
                        : <span className="cw-hint">{pair.warnings[0] ?? 'Could not be designed'}</span>}
                    </td>
                    <td className="cw-cell-size">{oligo.sequence.length || '-'}</td>
                    <td className="cw-cell-size">{oligo.tm > 0 ? `${oligo.tm.toFixed(1)}` : '-'}</td>
                  </tr>
                ))))}
            </tbody>
          </table>
        </div>
      )}

      {verify && verify.reads.length > 0 && (
        <div className="cw-verify">
          <div className="cw-library-bar">
            <strong className="cw-oligo-title">Reads to confirm it</strong>
            <span className="cw-spacer" />
            <button className="cw-btn" onClick={saveReads}>
              <Library size={13} /> Add {verify.reads.length} to library
            </button>
          </div>
          <div className="cw-table-wrap">
            <table className="cw-table">
              <thead>
                <tr><th>Read</th><th>Primer 5′→3′</th><th>Tm</th><th>Covers</th></tr>
              </thead>
              <tbody>
                {verify.reads.map(read => (
                  <tr key={read.junction}>
                    <td className="cw-cell-name">Junction {read.junction + 1}</td>
                    <td className="cw-oligo-seq">{read.primer.sequence}</td>
                    <td className="cw-cell-size">{read.primer.tm.toFixed(1)}</td>
                    <td className="cw-cell-size">{read.at.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {verify.warnings.length > 0 && (
            <ul className="cw-warnings">
              {verify.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}

      {pairs.some(p => p.warnings.length > 0) && (
        <ul className="cw-warnings">
          {[...new Set(pairs.flatMap(p => p.warnings))].map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}

      {pairs.length > 0 && (
        <p className="cw-line-caption">
          {usable.length > 0 && 'The tail is shown in colour; the rest is what binds the template. '}
          Parts total {parts.reduce((n, p) => n + partLength(p), 0).toLocaleString()} bp,
          {' '}of which {usable.length === 0 ? 'none is' : `${usable.length} ${usable.length === 1 ? 'piece is' : 'pieces are'}`} amplified
          {pairs.some(p => p.ready) && ': the rest are ready to use as they are'}.
        </p>
      )}
    </div>
  )
}
