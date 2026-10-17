import './EnzymeTooltip.css'
/**
 * Shared enzyme hover tooltip with double-stranded cut-site diagram.
 * Supports both single CutSite and GroupedCutSite (isoschizomer groups).
 */

import type { CutSite } from '../enzymes/finder'
import type { GroupedCutSite } from '../enzymes/grouping'
import { complementBase } from '../models/complement'
import HoverCard from './HoverCard'

/** Said of a site whose cut would fall past an end of a linear sequence. */
const NO_CUT = 'Cuts past the end of the sequence, so it does not cut'

const formatOverhang = (o: string) =>
  o === '5prime' ? "5' overhang" : o === '3prime' ? "3' overhang" : 'Blunt end'

const formatMethyl = (v?: string) => {
  if (!v || v === 'unknown') return '-'
  if (v === 'blocked') return 'Blocked'
  if (v === 'impaired') return 'Impaired'
  if (v === 'required') return 'Required'
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

/** The enzyme's cut pairs relative to its site: one, or two for a Type IIB enzyme. */
function enzymePairs(site: CutSite): [number, number][] {
  const e = site.enzyme
  return e.fwd_cut2 !== undefined && e.rev_cut2 !== undefined
    ? [[e.fwd_cut2, e.rev_cut2], [e.fwd_cut, e.rev_cut]]
    : [[e.fwd_cut, e.rev_cut]]
}

interface CutDiagram {
  cells: DiagramCell[]
  fwdCutEnd: boolean // ▼ after the last cell
  revCutEnd: boolean // ▲ after the last cell
}

function buildCutDiagram(site: CutSite): CutDiagram {
  const rec = site.enzyme.recognition.toUpperCase()
  const pairs = enzymePairs(site)
  const cuts = pairs.flat()

  const displayEnd = Math.max(rec.length, ...cuts.map(c => c + 1))
  const displayStart = Math.min(0, ...cuts)

  const fwdBases: string[] = []
  const revBases: string[] = []
  for (let i = displayStart; i < displayEnd; i++) {
    const base = i >= 0 && i < rec.length ? rec[i] : 'N'
    fwdBases.push(base)
    revBases.push(complementBase(base))
  }

  // Carets as cell indices: a cut at c sits before cell c - displayStart.
  const fwdIdx = new Set(pairs.map(([f]) => f - displayStart))
  const revIdx = new Set(pairs.map(([, r]) => r - displayStart))

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
      !fwdIdx.has(j) && !revIdx.has(j)
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
        fwdCut: fwdIdx.has(i),
        revCut: revIdx.has(i),
      })
    } else {
      // Short run - emit individual cells for uniform spacing
      for (let k = i; k < j; k++) {
        cells.push({
          fwd: fCh,
          rev: rCh,
          count: 1,
          fwdCut: fwdIdx.has(k),
          revCut: revIdx.has(k),
        })
      }
    }
    i = j
  }

  return {
    cells,
    fwdCutEnd: fwdIdx.has(fwdBases.length),
    revCutEnd: revIdx.has(fwdBases.length),
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
export function EnzymeTooltipContent({ site, methEffect, methNote }: {
  site: CutSite
  methEffect?: 'blocked' | 'impaired' | null
  methNote?: string | null
}) {
  const diagram = buildCutDiagram(site)
  return (
    <>
      <div className="enzyme-tooltip-title">{site.enzyme.name}</div>
      {site.offEnd && <div className="enzyme-methyl-warning enzyme-methyl-blocked">{NO_CUT}</div>}
      {methEffect && (
        <div className={`enzyme-methyl-warning enzyme-methyl-${methEffect}`}>
          {methNote ?? (methEffect === 'blocked' ? 'Blocked by methylation' : 'Impaired by methylation')}
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
          {[site.enzyme.dam, site.enzyme.dcm, site.enzyme.cpg].some(v => v === 'blocked' || v === 'impaired' || v === 'required') && (
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
    const key = `${site.enzyme.recognition}|${enzymePairs(site).join('|')}`
    const existing = map.get(key)
    if (existing) {
      // The same enzyme on both strands of one site (MspJI on CAAG) is named once.
      if (!existing.names.includes(site.enzyme.name)) existing.names.push(site.enzyme.name)
    } else {
      map.set(key, { representative: site, names: [site.enzyme.name] })
    }
  }
  return [...map.values()]
}

/** Tooltip content for a grouped enzyme site (isoschizomers). */
export function EnzymeGroupTooltipContent({ group }: { group: GroupedCutSite }) {
  if (group.sites.length === 1) {
    return <EnzymeTooltipContent site={group.sites[0]} methEffect={group.methEffect} methNote={group.methNote} />
  }

  // Group by identical cut pattern so isoschizomers share one diagram
  const patterns = groupByPattern(group.sites)

  return (
    <>
      <div className="enzyme-tooltip-title">{group.label}</div>
      <div className="enzyme-tooltip-position">
        Position {group.recognitionStart + 1}..{group.recognitionEnd}
      </div>
      {!group.cuts && <div className="enzyme-methyl-warning enzyme-methyl-blocked">{NO_CUT}</div>}
      {group.methEffect && (
        <div className={`enzyme-methyl-warning enzyme-methyl-${group.methEffect}`}>
          {group.methNote ?? (group.methEffect === 'blocked' ? 'Blocked by methylation' : 'Impaired by methylation')}
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
  return (
    <HoverCard x={x} y={y} className="enzyme-tooltip" pinKey={`enzyme:${group.label}@${group.recognitionStart}`}>
      <EnzymeGroupTooltipContent group={group} />
    </HoverCard>
  )
}

/**
 * The sites behind a "+N" chip: names that no row of a crowded line had room
 * for, each listed with where it starts.
 */
export function SiteListTooltip({ x, y, groups }: { x: number; y: number; groups: GroupedCutSite[] }) {
  return (
    <HoverCard x={x} y={y} className="enzyme-tooltip" pinKey={`sites:${groups.map(g => `${g.label}@${g.recognitionStart}`).join(',')}`}>
      <div className="enzyme-tooltip-title">{groups.length} more site{groups.length === 1 ? '' : 's'} here</div>
      <table className="enzyme-tooltip-table">
        <tbody>
          {groups.map(g => (
            <tr key={`${g.label}@${g.recognitionStart}`}>
              <td>{g.label}</td>
              <td>{(g.recognitionStart + 1).toLocaleString('en-US')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="enzyme-tooltip-position">Click to select the stretch they cover, or zoom in to see each name</div>
    </HoverCard>
  )
}
