/**
 * The report of an NGS mapping, shown on its assembly's overview: how many
 * reads mapped and paired properly, depth and breadth of coverage per
 * reference, coverage along each reference, fragment lengths and mapping
 * qualities, and how the mapping was made.
 */

import './ReadSetWorkspace.css'
import { useEditorStore } from '../../store'
import type { NgsMapping } from '../../assembly/container'
import { PRESET_LABEL } from '../../ngs/mapper'
import { HistogramChart } from './charts'

const nf = new Intl.NumberFormat()
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

export default function MappingReport({ ngs }: { ngs: NgsMapping }) {
  const r = ngs.report
  const readSet = useEditorStore(s => s.readSets.find(x => x.id === ngs.readSetId) ?? null)
  const one = r.references.length === 1 ? r.references[0] : null
  return (
    <>
      <div className="ngs-tiles">
        <Tile label="Reads mapped" value={pct(r.reads ? r.mapped / r.reads : 0)} detail={`${nf.format(r.mapped)} of ${nf.format(r.reads)}`} />
        {r.properlyPaired !== null && <Tile label="Properly paired" value={pct(r.properlyPaired)} detail="of mapped reads" />}
        {one && <Tile label="Mean depth" value={`${one.meanDepth.toFixed(1)}×`} />}
        {one && <Tile label="Covered" value={pct(one.breadth1)} detail={`${pct(one.breadth10)} at 10× or more`} />}
      </div>

      <section className="ngs-card">
        <div className="ngs-card-title">References</div>
        <table className="rs-table">
          <thead>
            <tr>
              <th>Reference</th><th className="num">Length</th><th className="num">Reads</th>
              <th className="num">Mean depth</th><th className="num">Covered</th><th className="num">At 10×+</th>
            </tr>
          </thead>
          <tbody>
            {r.references.map(x => (
              <tr key={x.name} className="ngs-static">
                <td className="rs-name">{x.name}{x.circular ? <span className="aw-muted"> circular</span> : null}</td>
                <td className="num">{nf.format(x.length)} bp</td>
                <td className="num">{nf.format(x.mappedReads)}</td>
                <td className="num">{x.meanDepth.toFixed(1)}×</td>
                <td className="num">{pct(x.breadth1)}</td>
                <td className="num">{pct(x.breadth10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="ngs-charts">
        {r.references.map(x => (
          <HistogramChart key={x.name} title={`Coverage along ${x.name}`} subtitle={`Mean depth in ${nf.format(x.binSize)} bp windows`}
            hist={{ edges: [...x.coverageBins.map((_, i) => i * x.binSize + 1), x.length + 1], counts: x.coverageBins }}
            binLabel={(lo, hi) => `${nf.format(lo)} to ${nf.format(Math.min(hi - 1, x.length))}`}
            unit="× mean depth" share={false} format={v => v.toFixed(1)} />
        ))}
        {r.insertSizes && r.insertSizes.counts.length > 0 && (
          <HistogramChart title="Fragment length" subtitle="Proper pairs, outer distance between the mates" hist={r.insertSizes}
            binLabel={(lo, hi) => `${nf.format(lo)} to ${nf.format(hi - 1)} bp`} unit="pairs" />
        )}
        <HistogramChart title="Mapping quality" subtitle="Primary alignments by MAPQ" hist={r.mapq}
          binLabel={lo => `MAPQ ${lo}`} tickLabel={v => String(v)} />
      </div>

      <section className="ngs-card">
        <div className="ngs-card-title">How it was made</div>
        <dl className="ngs-facts">
          <dt>Reads</dt>
          <dd>{readSet
            ? <button className="ngs-link" onClick={() => useEditorStore.getState().setActiveReadSet(readSet.id)}>{readSet.name}</button>
            : <span>{ngs.readSetName} <span className="aw-muted">(deleted)</span></span>}</dd>
          <dt>Mapper</dt><dd>minimap2 2.22, {PRESET_LABEL[r.preset]}, primary and supplementary alignments, no secondary</dd>
          <dt>Coverage</dt><dd className="aw-muted">Aligned bases of every alignment, whatever its mapping quality; deletions not counted.</dd>
          <dt>Stored</dt><dd>{nf.format(r.alignmentChunks)} {r.alignmentChunks === 1 ? 'part' : 'parts'} of alignments, {(r.storedBytes / 1024 / 1024).toFixed(1)} MB; the bases stay in the read set</dd>
        </dl>
      </section>
    </>
  )
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="ngs-tile">
      <div className="ngs-tile-label">{label}</div>
      <div className="ngs-tile-value">{value}</div>
      {detail && <div className="ngs-tile-detail">{detail}</div>}
    </div>
  )
}
