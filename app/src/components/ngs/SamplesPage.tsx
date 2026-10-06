/**
 * The samples of an NGS mapping, side by side: each sample's figures and
 * clone verification verdict, and the samples × variants matrix
 * (ngs/samples.ts). Variants are found per sample in the background
 * (ngs/calls.ts), once; samples not yet looked at say so.
 */

import './SamplesPage.css'
import './MappingViewer.css'
import './ReadSetWorkspace.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleCheck, CircleX, Download, ExternalLink, Plus, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react'
import { useEditorStore, type Assembly } from '../../store'
import { notify } from '../../toast'
import { downloadText } from '../../utils/download'
import { getReadChunk } from '../../storage/idb'
import { startCallVariants } from '../../workers/readset'
import type { NgsMapping } from '../../assembly/container'
import type { CoverageLevel } from '../../ngs/alignments'
import { MappingSource } from '../../ngs/view'
import { siteVariants, technologyOfPreset, variantPresetOf, type SiteCall } from '../../ngs/calls'
import { differingRows, matrixCsv, samplesMatrix, verifySample } from '../../ngs/samples'
import { refFeatures } from '../../assembly/features'
import { PRESET_NAME, VARIANT_PRESETS, variantFilters, type Variant, type VariantPreset } from '../../assembly/variants'
import { DEFAULT_VERIFY, STATUS_LABEL, type VerifyReport, type VerifySettings, type VerifyStatus } from '../../assembly/verify'

const nf = new Intl.NumberFormat()
const pct = (x: number) => `${(x * 100).toFixed(1)}%`
/** Rows of the matrix drawn at once. */
const MATRIX_ROWS = 2000

interface RefData { calls: SiteCall[] | null; coverage: Uint32Array; levels: CoverageLevel[]; bases: string }
interface SampleData { sample: NgsMapping; refs: RefData[] }

interface Props {
  assembly: Assembly
  onOpen: (storageId: string, page: 'reads' | 'report', ref?: number, pos?: number) => void
  onAdd: () => void
}

export default function SamplesPage({ assembly, onOpen, onAdd }: Props) {
  const samples = useMemo(() => (assembly.samples ?? []).filter(s => s.report.version === 2), [assembly.samples])
  const refsMeta = useMemo(() => samples[0]?.report.references ?? [], [samples])
  const [version, setVersion] = useState(0)
  const [data, setData] = useState<SampleData[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setError(null)
    Promise.all(samples.map(async sample => {
      const src = new MappingSource({ get: getReadChunk }, sample.storageId, sample.report.references)
      const refs = await Promise.all(sample.report.references.map(async (_, r) => {
        const [calls, coverage, levels, bases] = await Promise.all([src.calls(r), src.coverage(r), src.summaries(r), src.reference(r)])
        return { calls, coverage, levels, bases }
      }))
      return { sample, refs }
    })).then(d => { if (live) setData(d) }).catch(err => { if (live) setError(err instanceof Error ? err.message : String(err)) })
    return () => { live = false }
  }, [samples, version])

  // ---- Finding variants where they are missing ----
  const missing = useMemo(() => (data ? data.filter(d => d.refs.some(r => r.calls === null)).map(d => d.sample) : []), [data])
  const [finding, setFinding] = useState<{ at: number; of: number; frac: number } | null>(null)
  const findAll = useCallback(async () => {
    const list = missing
    for (let k = 0; k < list.length; k++) {
      const s = list[k]
      setFinding({ at: k + 1, of: list.length, frac: 0 })
      try {
        await startCallVariants({ type: 'call-variants', storageId: s.storageId, references: s.report.references.map(r => ({ name: r.name, length: r.length, circular: r.circular })) },
          (d, t) => setFinding(f => (f ? { ...f, frac: t ? d / t : 0 } : f))).promise
      } catch (err) {
        notify.error(`Finding variants in ${s.readSetName} failed`, { detail: err instanceof Error ? err.message : String(err) })
        break
      }
    }
    setFinding(null)
    setVersion(v => v + 1)
  }, [missing])

  // ---- Thresholds and verification settings ----
  const technology = technologyOfPreset(samples[0]?.report.preset ?? null)
  const [preset, setPreset] = useState<VariantPreset>(variantPresetOf(technology))
  const settings = VARIANT_PRESETS[preset]
  const [onlyDiffering, setOnlyDiffering] = useState(false)
  const [verify, setVerify] = useState<VerifySettings>({ ...DEFAULT_VERIFY, minDepth: 10 })

  // The reference's features, when it is open and the length mapped to.
  const tabs = useEditorStore(s => s.tabs)
  const features = useMemo(() => refsMeta.map(r => {
    const t = r.tabId ? tabs.find(x => x.id === r.tabId) : undefined
    return t && t.doc.sequence.length === r.length ? refFeatures(t.doc.annotations.map(a => a.toData())) : null
  }), [refsMeta, tabs])

  // Every sample's candidate variants, per reference.
  const variants = useMemo(() => data?.map(d => d.refs.map((r, i) => (r.calls
    ? siteVariants(r.calls, r.bases, features[i] ?? [], technologyOfPreset(d.sample.report.preset))
    : null))) ?? null, [data, features])

  const verdicts = useMemo(() => data?.map((d, si) => d.sample.report.references.map((ref, r): VerifyReport | null => {
    const vs = variants?.[si]?.[r]
    if (!vs) return null
    return verifySample({
      reference: { name: ref.name, length: ref.length, circular: ref.circular },
      reads: d.sample.report.mapped,
      coverage: d.refs[r].coverage,
      levels: d.refs[r].levels,
      variants: vs,
      features: features[r] ?? [],
      settings: verify,
    })
  })) ?? null, [data, variants, features, verify])

  const matrix = useMemo(() => {
    if (!data || !variants || variants.some(v => v.some(x => x === null))) return null
    const rows = refsMeta.flatMap((_, r) => samplesMatrix(data.map((d, si) => ({ variants: variants[si][r]!, coverage: d.refs[r].coverage })), settings).map(row => ({ ref: r, row })))
    return onlyDiffering ? rows.filter(x => differingRows([x.row], settings).length > 0) : rows
  }, [data, variants, refsMeta, settings, onlyDiffering])

  const exportMatrix = () => {
    if (!matrix) return
    downloadText(matrixCsv(matrix.map(m => m.row), samples.map(s => s.readSetName), row => refsMeta[matrix.find(m => m.row === row)!.ref].name),
      `${assembly.name.replace(/[\\/:*?"<>|\s]+/g, '_')}_samples.csv`, 'text/csv')
  }

  const remove = (s: NgsMapping) => {
    const undo = useEditorStore.getState().removeSample(assembly.id, s.storageId)
    if (undo) notify.success(`Took ${s.readSetName} out of the mapping`, { action: { label: 'Undo', onClick: undo } })
  }

  const passing = (si: number) => {
    const vs = variants?.[si]
    if (!vs || vs.some(v => v === null)) return null
    return vs.reduce((n, list) => n + list!.filter(v => variantFilters(v, settings).length === 0).length, 0)
  }
  const verdictOf = (si: number): { status: VerifyStatus; detail: string } | null => {
    const vr = verdicts?.[si]
    if (!vr || vr.some(x => x === null)) return null
    const rank: Record<VerifyStatus, number> = { verified: 0, incomplete: 1, differences: 2 }
    const worst = vr.reduce((w, x) => (rank[x!.verdict] > rank[w] ? x!.verdict : w), 'verified' as VerifyStatus)
    const detail = vr.map(x => {
      const r = x!
      const feats = r.features.length
        ? r.features.map(f => `${f.feature.name}: ${STATUS_LABEL[f.status].toLowerCase()}${f.differences.length ? ` (${f.differences.map(d => d.coding?.protein ?? `${d.ref || '-'}${d.position}${d.alt || '-'}`).join(', ')})` : f.covered < 1 ? ` (${pct(f.covered)} covered)` : ''}`)
        : [`whole reference ${pct(r.covered)} covered, ${r.differences.length} differences`]
      return `${r.reference.name}: ${feats.join('; ')}`
    }).join('\n')
    return { status: worst, detail }
  }
  const noFeatures = features.every(f => !f || f.filter(x => x.type !== 'source' && x.type !== 'variation').length === 0)

  if (samples.length === 0) return <div className="ao-body"><p className="aw-note">These samples were mapped by an earlier version and have nothing to compare. Run them again.</p></div>
  return (
    <div className="ao-body sp">
      {error && <p className="aw-note ngs-warn-note">{error}</p>}
      <section className="ngs-card">
        <div className="sp-head">
          <div className="ngs-card-title">Samples</div>
          <span className="aw-spacer" />
          <button className="aw-btn" onClick={onAdd} title="Map more read sets to the same references"><Plus size={13} /> Add samples…</button>
        </div>
        <table className="rs-table">
          <thead>
            <tr>
              <th>Sample</th><th className="num">Reads</th><th className="num">Mapped</th><th className="num">Mean depth</th><th className="num">Covered</th>
              <th className="num" title={`Variants passing the ${PRESET_NAME[preset]} thresholds`}>Variants</th>
              <th title="Clone verification against the reference's features (or the whole reference)">Verification</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {samples.map((s, si) => {
              const r = s.report
              const depth = r.references.reduce((n, x) => n + x.meanDepth * x.length, 0) / Math.max(1, r.references.reduce((n, x) => n + x.length, 0))
              const covered = r.references.reduce((n, x) => n + x.breadth1 * x.length, 0) / Math.max(1, r.references.reduce((n, x) => n + x.length, 0))
              const n = passing(si)
              const vd = verdictOf(si)
              return (
                <tr key={s.storageId} className="ngs-open-row" onClick={() => onOpen(s.storageId, 'reads')} title="Show this sample's reads">
                  <td className="rs-name">{s.readSetName}{r.primers ? <span className="ao-tag" title={`${nf.format(r.primers.clipped)} alignments had a primer clipped`}>primers clipped</span> : null}</td>
                  <td className="num">{nf.format(r.reads)}</td>
                  <td className="num">{pct(r.reads ? r.mapped / r.reads : 0)}</td>
                  <td className="num">{depth.toFixed(1)}×</td>
                  <td className="num">{pct(covered)}</td>
                  <td className="num">{n === null ? <span className="aw-muted">not found yet</span> : nf.format(n)}</td>
                  <td>
                    {vd ? (
                      <span className={`sp-verdict ${vd.status}`} title={vd.detail}>
                        {vd.status === 'verified' ? <CircleCheck size={12} /> : vd.status === 'differences' ? <CircleX size={12} /> : <TriangleAlert size={12} />}
                        {STATUS_LABEL[vd.status]}
                      </span>
                    ) : <span className="aw-muted">-</span>}
                  </td>
                  <td className="ao-actions" onClick={e => e.stopPropagation()}>
                    <button className="aw-icon-btn" onClick={() => onOpen(s.storageId, 'report')} title="The sample's report" aria-label={`Report of ${s.readSetName}`}><ExternalLink size={13} /></button>
                    {samples.length > 1 && (
                      <button className="aw-icon-btn" onClick={() => remove(s)} title="Take this sample out of the mapping" aria-label={`Remove ${s.readSetName}`}><Trash2 size={13} /></button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {missing.length > 0 && (
          <div className="sp-find">
            {finding ? (
              <>
                <span className="aw-note">Finding variants in sample {finding.at} of {finding.of}… {Math.round(finding.frac * 100)}%</span>
                <div className="ngs-progress"><div style={{ width: `${Math.round(finding.frac * 100)}%` }} /></div>
              </>
            ) : (
              <>
                <span className="aw-note">{missing.length === samples.length ? 'Variants have not been looked for yet.' : `${missing.length} of ${samples.length} samples have not had their variants looked for.`} The matrix and the verdicts need them.</span>
                <button className="btn btn-sm btn-primary" onClick={findAll}>Find variants in {missing.length === 1 ? 'it' : `all ${missing.length}`}</button>
              </>
            )}
          </div>
        )}
        <div className="sp-verify">
          <ShieldCheck size={13} />
          <span>Verification: covered by at least</span>
          <input className="mv-num" type="number" min={1} max={100000} value={verify.minDepth} aria-label="Reads needed over every base"
            onChange={e => setVerify(v => ({ ...v, minDepth: Math.max(1, Math.round(Number(e.target.value) || 1)) }))} />
          <span>reads</span>
          <label className="aw-check small"><input type="checkbox" checked={verify.bothStrands} onChange={e => setVerify(v => ({ ...v, bothStrands: e.target.checked }))} /> on both strands</label>
          <span className="aw-muted">
            {noFeatures
              ? `· open ${refsMeta.map(r => r.name).join(', ')} to check its features one by one; the whole reference is checked now`
              : '· every feature of the reference is checked; a difference is a variant most reads carry'}
          </span>
        </div>
      </section>

      <section className="ngs-card">
        <div className="sp-head">
          <div className="ngs-card-title">Variants across samples</div>
          <select className="select aw-select" value={preset} aria-label="Thresholds" onChange={e => setPreset(e.target.value as VariantPreset)}>
            {(Object.keys(VARIANT_PRESETS) as VariantPreset[]).map(k => <option key={k} value={k}>{PRESET_NAME[k]} thresholds</option>)}
          </select>
          <label className="aw-check small"><input type="checkbox" checked={onlyDiffering} onChange={e => setOnlyDiffering(e.target.checked)} /> Only where samples differ</label>
          <span className="aw-spacer" />
          <button className="aw-btn" onClick={exportMatrix} disabled={!matrix?.length}><Download size={13} /> CSV</button>
        </div>
        {!matrix ? (
          <p className="aw-note">{data ? 'Find the variants of every sample first.' : 'Reading the samples…'}</p>
        ) : matrix.length === 0 ? (
          <p className="aw-note">{onlyDiffering ? 'The samples agree wherever any of them has a variant.' : 'No variant passes the thresholds in any sample.'}</p>
        ) : (
          <div className="sp-matrix-wrap">
            <table className="sp-matrix">
              <thead>
                <tr>
                  {refsMeta.length > 1 && <th>Reference</th>}
                  <th className="num">Position</th><th>Change</th><th>Effect</th>
                  {samples.map(s => <th key={s.storageId} className="sp-sample" title={s.readSetName}>{s.readSetName}</th>)}
                </tr>
              </thead>
              <tbody>
                {matrix.slice(0, MATRIX_ROWS).map(({ ref, row }) => (
                  <tr key={`${ref}:${row.key}`}>
                    {refsMeta.length > 1 && <td>{refsMeta[ref].name}</td>}
                    <td className="num">{nf.format(row.variant.position)}</td>
                    <td className="sp-change">{row.label}</td>
                    <td className="sp-effect">{effectText(row.variant)}</td>
                    {row.cells.map((c, si) => (
                      <td key={si} className={`sp-cell${c.passes ? ' passes' : ''}${c.frequency === null ? ' blank' : ''}`}
                        style={c.frequency ? { '--freq': `${Math.round(c.frequency * 100)}%` } as React.CSSProperties : undefined}
                        title={c.frequency === null
                          ? `${samples[si].readSetName}: ${c.depth} ${c.depth === 1 ? 'read covers' : 'reads cover'} it, too few to say`
                          : `${samples[si].readSetName}: ${nf.format(c.count)} of ${nf.format(c.depth)} reads (${(c.frequency * 100).toFixed(1)}%)${c.passes ? '' : c.frequency > 0 ? ', below the thresholds' : ''}. Click to see the reads.`}
                        onClick={() => onOpen(samples[si].storageId, 'reads', ref, row.variant.position - 1)}>
                        {c.frequency === null ? '' : `${Math.round(c.frequency * 100)}%`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {matrix.length > MATRIX_ROWS && <p className="aw-note">Showing the first {nf.format(MATRIX_ROWS)} of {nf.format(matrix.length)} rows; the CSV has all of them.</p>}
          </div>
        )}
        <p className="aw-note">
          A cell is the share of that sample&apos;s reads carrying the variant; strong where it passes the thresholds there. Blank: fewer
          than {settings.minCoverage} reads cover the position, so the sample cannot say.
        </p>
      </section>
    </div>
  )
}

function effectText(v: Variant): string {
  if (v.coding) return `${v.coding.protein} ${v.coding.effect.toLowerCase()}`
  return v.features[0] ?? ''
}
