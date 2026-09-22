import './EnzymeTooltip.css'
/**
 * Shared enzyme hover tooltip with double-stranded cut-site diagram.
 * Supports both single CutSite and GroupedCutSite (isoschizomer groups).
 */

import type { CutSite } from '../enzymes/finder'
import type { GroupedCutSite } from './SequenceView'
import { complementBase } from '../models/complement'
import { useClampedPosition } from '../hooks/useClampedPosition'

const formatOverhang = (o: string) =>
  o === '5prime' ? "5' overhang" : o === '3prime' ? "3' overhang" : 'Blunt end'

const formatMethyl = (v?: string) => {
  if (!v || v === 'unknown') return '–'
  if (v === 'blocked') return 'Blocked'
  if (v === 'impaired') return 'Impaired'
  return 'Insensitive'
}

/**
 * Build a double-stranded cut-site diagram with caret markers on separate
 * lines above/below the strands.
 * Returns 4 lines: fwd caret, fwd strand, rev strand, rev caret.
 */
/** Minimum run length to collapse (shorter runs are left expanded). */
const MIN_COLLAPSE = 4

/**
 * A cell in the diagram grid. Each cell is either a single base or a collapsed
 * run like "N×10". Cells are rendered as inline-block so the 4 lines (fwd caret,
 * fwd strand, rev strand, rev caret) stay aligned.
 */
interface DiagramCell {
  fwd: string
  rev: string
  count: number // 1 for normal bases, >1 for collapsed runs
  fwdCut: boolean // ▼ caret between this cell and the previous one
  revCut: boolean // ▲ caret between this cell and the previous one
}

interface CutDiagram {
  cells: DiagramCell[]
  fwdCutEnd: boolean // ▼ after the last cell
  revCutEnd: boolean // ▲ after the last cell
}

function buildCutDiagram(site: CutSite): CutDiagram {
  const rec = site.enzyme.recognition.toUpperCase()
  const fwdCut = site.enzyme.fwd_cut
  const revCut = site.enzyme.rev_cut

  const displayEnd = Math.max(rec.length, fwdCut + 1, revCut + 1)
  const displayStart = Math.min(0, fwdCut, revCut)

  const fwdBases: string[] = []
  const revBases: string[] = []
  for (let i = displayStart; i < displayEnd; i++) {
    const base = i >= 0 && i < rec.length ? rec[i] : 'N'
    fwdBases.push(base)
    revBases.push(complementBase(base))
  }

  const fwdCutIdx = fwdCut - displayStart
  const revCutIdx = revCut - displayStart

  // Build cells, collapsing runs of identical bases on BOTH strands,
  // but splitting at cut positions so carets land between cells.
  const cells: DiagramCell[] = []
  let i = 0
  while (i < fwdBases.length) {
    const fCh = fwdBases[i]
    const rCh = revBases[i]
    let j = i + 1
    // Extend run only if both strands have the same repeated char and no cut falls inside
    while (
      j < fwdBases.length &&
      fwdBases[j] === fCh && revBases[j] === rCh &&
      j !== fwdCutIdx && j !== revCutIdx
    ) {
      j++
    }
    const runLen = j - i
    if (runLen >= MIN_COLLAPSE) {
      // Long run - collapse into single cell with ×N notation
      cells.push({
        fwd: fCh,
        rev: rCh,
        count: runLen,
        fwdCut: i === fwdCutIdx,
        revCut: i === revCutIdx,
      })
    } else {
      // Short run - emit individual cells for uniform spacing
      for (let k = i; k < j; k++) {
        cells.push({
          fwd: fCh,
          rev: rCh,
          count: 1,
          fwdCut: k === fwdCutIdx,
          revCut: k === revCutIdx,
        })
      }
    }
    i = j
  }

  return {
    cells,
    fwdCutEnd: fwdCutIdx === fwdBases.length,
    revCutEnd: revCutIdx === fwdBases.length,
  }
}

/**
 * Render a base cell, optionally with a caret (▼ or ▲) positioned in the gap
 * before it. The caret is absolutely positioned to sit between this cell and
 * the previous one.
 */
function BaseCell({ base, count, caret }: { base: string; count: number; caret?: '▼' | '▲' }) {
  const collapsed = count >= MIN_COLLAPSE
  return (
    <span className={`ecd-cell${collapsed ? ' ecd-collapsed' : ''}`}>
      {caret && <span className={`ecd-caret ${caret === '▼' ? 'ecd-caret-fwd' : 'ecd-caret-rev'}`}>{caret}</span>}
      {base}{collapsed && <span className="ecd-count">×{count}</span>}
    </span>
  )
}

function CutDiagramView({ diagram }: { diagram: CutDiagram }) {
  const { cells, fwdCutEnd, revCutEnd } = diagram
  return (
    <div className="enzyme-cut-diagram">
      {/* Forward strand */}
      <div className="ecd-row ecd-row-fwd">
        <span className="ecd-prefix">5'…</span>
        {cells.map((c, i) => (
          <BaseCell key={i} base={c.fwd} count={c.count} caret={c.fwdCut ? '▼' : undefined} />
        ))}
        {fwdCutEnd && <span className="ecd-caret ecd-caret-fwd ecd-caret-end">▼</span>}
        <span className="ecd-suffix">…3'</span>
      </div>
      {/* Reverse strand */}
      <div className="ecd-row ecd-row-rev">
        <span className="ecd-prefix">3'…</span>
        {cells.map((c, i) => (
          <BaseCell key={i} base={c.rev} count={c.count} caret={c.revCut ? '▲' : undefined} />
        ))}
        {revCutEnd && <span className="ecd-caret ecd-caret-rev ecd-caret-end">▲</span>}
        <span className="ecd-suffix">…5'</span>
      </div>
    </div>
  )
}

/** Tooltip content for a single enzyme site. */
export function EnzymeTooltipContent({ site, methEffect }: { site: CutSite; methEffect?: 'blocked' | 'impaired' | null }) {
  const diagram = buildCutDiagram(site)
  return (
    <>
      <div className="enzyme-tooltip-title">{site.enzyme.name}</div>
      {methEffect && (
        <div className={`enzyme-methyl-warning enzyme-methyl-${methEffect}`}>
          {methEffect === 'blocked' ? 'Blocked by methylation' : 'Impaired by methylation'}
        </div>
      )}
      <CutDiagramView diagram={diagram} />
      <table className="enzyme-tooltip-table">
        <tbody>
          <tr><td>Position</td><td>{site.position + 1}..{site.position + site.enzyme.recognition.length}</td></tr>
          <tr><td>Overhang</td><td>{formatOverhang(site.enzyme.overhang)}</td></tr>
          {site.enzyme.temperature != null && (
            <tr><td>Temperature</td><td>{site.enzyme.temperature}°C</td></tr>
          )}
          {site.enzyme.heatInactivation != null && (
            <tr><td>Heat inact.</td><td>{site.enzyme.heatInactivation}°C</td></tr>
          )}
          {[site.enzyme.dam, site.enzyme.dcm, site.enzyme.cpg].some(v => v === 'blocked' || v === 'impaired') && (
            <tr><td>Methylation</td><td><span className="enzyme-methyl-inline">
              {[
                site.enzyme.dam && ['Dam', site.enzyme.dam],
                site.enzyme.dcm && ['Dcm', site.enzyme.dcm],
                site.enzyme.cpg && ['CpG', site.enzyme.cpg],
              ].filter(Boolean).map((entry, i) => {
                const [label, val] = entry as [string, string]
                const cls = val === 'blocked' ? 'blocked' : val === 'impaired' ? 'impaired' : ''
                return <span key={i} className={`enzyme-methyl-tag ${cls}`}>{label}: {formatMethyl(val)}</span>
              })}
            </span></td></tr>
          )}
          {site.enzyme.isoschizomers && (
            <tr><td>Isoschizomers</td><td>{site.enzyme.isoschizomers.join(', ')}</td></tr>
          )}
        </tbody>
      </table>
    </>
  )
}

/**
 * Group sites by identical cut pattern (recognition + fwd_cut + rev_cut).
 * Isoschizomers with the same pattern share one diagram.
 */
function groupByPattern(sites: CutSite[]): { representative: CutSite; names: string[] }[] {
  const map = new Map<string, { representative: CutSite; names: string[] }>()
  for (const site of sites) {
    const key = `${site.enzyme.recognition}|${site.enzyme.fwd_cut}|${site.enzyme.rev_cut}`
    const existing = map.get(key)
    if (existing) {
      existing.names.push(site.enzyme.name)
    } else {
      map.set(key, { representative: site, names: [site.enzyme.name] })
    }
  }
  return [...map.values()]
}

/** Tooltip content for a grouped enzyme site (isoschizomers). */
export function EnzymeGroupTooltipContent({ group }: { group: GroupedCutSite }) {
  if (group.sites.length === 1) {
    return <EnzymeTooltipContent site={group.sites[0]} methEffect={group.methEffect} />
  }

  // Group by identical cut pattern so isoschizomers share one diagram
  const patterns = groupByPattern(group.sites)

  return (
    <>
      <div className="enzyme-tooltip-title">{group.label}</div>
      <div className="enzyme-tooltip-position">
        Position {group.recognitionStart + 1}..{group.recognitionEnd}
      </div>
      {group.methEffect && (
        <div className={`enzyme-methyl-warning enzyme-methyl-${group.methEffect}`}>
          {group.methEffect === 'blocked' ? 'Blocked by methylation' : 'Impaired by methylation'}
        </div>
      )}
      {patterns.map((pat, i) => {
        const diagram = buildCutDiagram(pat.representative)
        return (
          <div key={i} className={`enzyme-tooltip-site ${i < patterns.length - 1 ? 'enzyme-tooltip-site-sep' : ''}`}>
            <div className="enzyme-tooltip-site-names">
              {pat.names.join(', ')}
            </div>
            <CutDiagramView diagram={diagram} />
            <table className="enzyme-tooltip-table">
              <tbody>
                <tr><td>Overhang</td><td>{formatOverhang(pat.representative.enzyme.overhang)}</td></tr>
              </tbody>
            </table>
          </div>
        )
      })}
    </>
  )
}

export default function EnzymeTooltip({ x, y, group }: { x: number; y: number; group: GroupedCutSite }) {
  const { ref, pos } = useClampedPosition(x, y)
  return (
    <div
      ref={ref}
      className="enzyme-tooltip"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        pointerEvents: 'none',
      }}
    >
      <EnzymeGroupTooltipContent group={group} />
    </div>
  )
}
