import './EnzymeTooltip.css'
/**
 * The hover card of a restriction site, on the sequence view and the map.
 *
 * It describes this cut in this sequence, not the enzyme in general: the
 * bases around the site with the cut drawn as a step through both strands,
 * the overhang it leaves read off the sequence, how many times the enzyme
 * cuts here, and what methylation does to this one site. A site shared by
 * several enzymes lists them compactly on hover; pinning it (Shift) shows
 * each cut pattern in full.
 */

import { cutPairs, type CutSite } from '../enzymes/finder'
import type { GroupedCutSite } from '../enzymes/grouping'
import {
  siteMethylationEffect, siteMethylationLines, siteMethylationNote, type MethylationContext,
} from '../enzymes/methylation'
import { complementBase } from '../models/complement'
import type { ClampOptions } from '../hooks/useClampedPosition'
import HoverCard from './HoverCard'
import { useInPinnedCard } from './hoverCardPinned'

/** What a card needs to know about the sequence its site is in. */
export interface EnzymeCardContext {
  /** The bases, topology and methylation of the sequence. */
  methylation: MethylationContext
  /** How many times each enzyme cuts the sequence, by name. */
  cutCounts: ReadonlyMap<string, number>
}

/** Said of a site whose cut would fall past an end of a linear sequence. */
const NO_CUT = 'Cuts past the end of the sequence, so it does not cut'

/** Bases shown on each side of the site and its cuts. */
const FLANK = 3
/** Bases kept on each side of a cut, so the step always has letters around it. */
const CUT_MARGIN = 2
/** A stretch of at least this many bases between the site and a far cut is shortened. */
const MIN_GAP = 4

const formatOverhangType = (o: string) =>
  o === '5prime' ? "5′ overhang" : o === '3prime' ? "3′ overhang" : 'Blunt end'

/** The base at `pos` (any integer), wrapped on a circle; '' past an end of a linear sequence. */
function baseAt(ctx: MethylationContext, pos: number): string {
  const len = ctx.bases.length
  if (len === 0) return ''
  if (ctx.topology === 'circular') return ctx.bases[((pos % len) + len) % len].toUpperCase()
  return pos >= 0 && pos < len ? ctx.bases[pos].toUpperCase() : ''
}

/**
 * A site's cut pairs relative to its first base, in top-strand coordinates.
 * Cuts on a circle are stored wrapped, so a cut across the origin is brought
 * back beside its site.
 */
function relativeCuts(site: CutSite, ctx: MethylationContext): [number, number][] {
  const len = ctx.bases.length
  const rel = (c: number) => {
    if (ctx.topology !== 'circular' || len === 0) return c - site.position
    const d = (((c - site.position) % len) + len) % len
    return d > len / 2 ? d - len : d
  }
  return cutPairs(site).map(p => [rel(p.fwdCut), rel(p.revCut)])
}

/** One end the cut leaves: which strand sticks out and its bases, read 5′ to 3′ on the top strand. */
interface Overhang { end: "5′" | "3′" | 'Blunt'; bases: string }

function overhangsOf(site: CutSite, ctx: MethylationContext): Overhang[] | null {
  const out: Overhang[] = []
  for (const [f, r] of relativeCuts(site, ctx)) {
    if (f === r) { out.push({ end: 'Blunt', bases: '' }); continue }
    let bases = ''
    for (let p = Math.min(f, r); p < Math.max(f, r); p++) {
      const b = baseAt(ctx, site.position + p)
      if (!b) return null
      bases += b
    }
    out.push({ end: f < r ? "5′" : "3′", bases })
  }
  return out
}

function OverhangText({ site, ctx }: { site: CutSite; ctx: MethylationContext }) {
  const overhangs = overhangsOf(site, ctx)
  if (!overhangs) return <>{formatOverhangType(site.enzyme.overhang)}</>
  return (
    <>
      {overhangs.map((o, i) => (
        <span key={i}>
          {i > 0 && ', '}
          {o.end === 'Blunt' ? 'Blunt' : <>{o.end} <span className="enzyme-tooltip-mono">{o.bases}</span></>}
        </span>
      ))}
    </>
  )
}

type DiagramColumn =
  | { kind: 'base'; p: number; top: string; bottom: string; site: boolean }
  | { kind: 'gap'; count: number }

interface CutDiagram {
  columns: DiagramColumn[]
  /** Boundaries (relative positions) the top strand is cut at. */
  topCuts: Set<number>
  bottomCuts: Set<number>
  /** Relative positions whose top-strand base edge carries the step between the strands. */
  across: Set<number>
}

/**
 * The bases around a site, both strands, with the cut drawn as a step:
 * down through the top strand at its cut, along between the strands, down
 * through the bottom strand at its cut. Read from the sequence, so a
 * degenerate site shows the bases it matched and a Type IIS overhang its
 * actual bases. A long stretch between a site and a distant cut is
 * shortened to its length.
 */
function buildCutDiagram(site: CutSite, ctx: MethylationContext): CutDiagram {
  const recLen = site.enzyme.recognition.length
  const pairs = relativeCuts(site, ctx)
  const cuts = pairs.flat()
  const lo = Math.min(0, ...cuts) - FLANK
  const hi = Math.max(recLen, ...cuts) + FLANK

  const keep = (p: number) =>
    (p >= 0 && p < recLen) || p < lo + FLANK || p >= hi - FLANK ||
    pairs.some(([f, r]) => p >= Math.min(f, r) - CUT_MARGIN && p < Math.max(f, r) + CUT_MARGIN)

  const baseColumn = (p: number): DiagramColumn => {
    const top = baseAt(ctx, site.position + p)
    return { kind: 'base', p, top, bottom: top ? complementBase(top) : '', site: p >= 0 && p < recLen }
  }
  const columns: DiagramColumn[] = []
  let run = 0
  const flushRun = (end: number) => {
    if (run >= MIN_GAP) columns.push({ kind: 'gap', count: run })
    else for (let p = end - run; p < end; p++) columns.push(baseColumn(p))
    run = 0
  }
  for (let p = lo; p < hi; p++) {
    if (keep(p)) { flushRun(p); columns.push(baseColumn(p)) } else run++
  }
  flushRun(hi)

  const across = new Set<number>()
  for (const [f, r] of pairs) for (let p = Math.min(f, r); p < Math.max(f, r); p++) across.add(p)
  return {
    columns,
    topCuts: new Set(pairs.map(([f]) => f)),
    bottomCuts: new Set(pairs.map(([, r]) => r)),
    across,
  }
}

function CutDiagramView({ site, ctx }: { site: CutSite; ctx: MethylationContext }) {
  const { columns, topCuts, bottomCuts, across } = buildCutDiagram(site, ctx)
  const last = columns.length + 2
  const cell = (col: DiagramColumn, i: number, row: 1 | 2) => {
    const gridColumn = i + 2
    if (col.kind === 'gap') {
      return row === 1
        ? <span key={`g${i}`} className="ecd-gap" style={{ gridColumn, gridRow: '1 / span 2' }}>{col.count} bp</span>
        : null
    }
    const base = row === 1 ? col.top : col.bottom
    const cls = ['ecd-base']
    if (col.site) cls.push('ecd-site')
    if (row === 1 && topCuts.has(col.p)) cls.push('ecd-cut-top')
    if (row === 1 && across.has(col.p)) cls.push('ecd-cut-across')
    if (row === 2 && bottomCuts.has(col.p)) cls.push('ecd-cut-bottom')
    return <span key={`${row}-${i}`} className={cls.join(' ')} style={{ gridColumn, gridRow: row }}>{base || ' '}</span>
  }
  return (
    <div className="enzyme-cut-diagram" aria-label={`${site.enzyme.name} cut site`}>
      <div className="ecd-grid">
        <span className="ecd-end" style={{ gridColumn: 1, gridRow: 1 }}>5′</span>
        <span className="ecd-end" style={{ gridColumn: 1, gridRow: 2 }}>3′</span>
        {columns.map((c, i) => cell(c, i, 1))}
        {columns.map((c, i) => cell(c, i, 2))}
        <span className="ecd-end" style={{ gridColumn: last, gridRow: 1 }}>3′</span>
        <span className="ecd-end" style={{ gridColumn: last, gridRow: 2 }}>5′</span>
      </div>
    </div>
  )
}

/** Where the site is, 1-based, wrapping on a circle; and the strand it reads on when that is not a given. */
function positionText(site: CutSite, ctx: MethylationContext): string {
  const len = ctx.bases.length
  const recLen = site.enzyme.recognition.length
  const last = ctx.topology === 'circular' && len > 0
    ? ((site.position + recLen - 1) % len) + 1
    : site.position + recLen
  return `${(site.position + 1).toLocaleString('en-US')}..${last.toLocaleString('en-US')}${site.strand === -1 ? ', bottom strand' : ''}`
}

function temperatureText(t?: number, heat?: number | null): string | null {
  const parts: string[] = []
  if (t != null) parts.push(`${t}°C`)
  if (heat != null) parts.push(`inactivate at ${heat}°C`)
  else if (heat === null) parts.push('no heat inactivation')
  return parts.length > 0 ? parts.join(' · ') : null
}

function CountChip({ name, counts }: { name: string; counts: ReadonlyMap<string, number> }) {
  const n = counts.get(name)
  if (!n) return null
  return <span className="enzyme-count" title={`Cuts this sequence ${n === 1 ? 'once' : `${n} times`}`}>{n}×</span>
}

function Banners({ cuts, methEffect, methNote }: {
  cuts: boolean
  methEffect: 'blocked' | 'impaired' | null
  methNote: string | null
}) {
  return (
    <>
      {!cuts && <div className="enzyme-methyl-warning enzyme-methyl-blocked">{NO_CUT}</div>}
      {methEffect && (
        <div className={`enzyme-methyl-warning enzyme-methyl-${methEffect}`}>
          {methNote ?? (methEffect === 'blocked' ? 'Blocked by methylation' : 'Impaired by methylation')}
        </div>
      )}
    </>
  )
}

/**
 * Card content for one enzyme's site. Usually one site; an enzyme whose
 * site reads on both strands at once (MspJI on CAAG) cuts on both sides,
 * and each cut is drawn.
 */
function EnzymeSiteContent({ group, ctx }: { group: GroupedCutSite; ctx: EnzymeCardContext }) {
  const site = group.sites[0]
  const enzyme = site.enzyme
  const meth = ctx.methylation
  const temperature = temperatureText(enzyme.temperature, enzyme.heatInactivation)
  const methLines = siteMethylationLines(site, meth)
  return (
    <>
      <div className="enzyme-tooltip-title">
        <span className="enzyme-tooltip-name">{enzyme.name}</span>
        <CountChip name={enzyme.name} counts={ctx.cutCounts} />
      </div>
      <Banners cuts={group.cuts} methEffect={group.methEffect} methNote={group.methNote} />
      {group.sites.map((s, i) => <CutDiagramView key={i} site={s} ctx={meth} />)}
      <table className="enzyme-tooltip-table">
        <tbody>
          <tr><td>Position</td><td>{positionText(site, meth)}</td></tr>
          <tr><td>Overhang</td><td>
            {group.sites.map((s, i) => <span key={i}>{i > 0 && '; '}<OverhangText site={s} ctx={meth} /></span>)}
          </td></tr>
          {temperature && <tr><td>Temperature</td><td>{temperature}</td></tr>}
          {methLines.length > 0 && (
            <tr><td>Methylation</td><td><span className="enzyme-methyl-inline">
              {methLines.map(l => <span key={l.text} className={`enzyme-methyl-tag ${l.tone}`}>{l.text}</span>)}
            </span></td></tr>
          )}
          {enzyme.isoschizomers && (
            <tr><td>Isoschizomers</td><td>{enzyme.isoschizomers.join(', ')}</td></tr>
          )}
        </tbody>
      </table>
    </>
  )
}

/**
 * Sites at one position that cut the same way (isoschizomers): drawn once.
 * The key is in top-strand terms, so the same cut found from either strand
 * is one pattern.
 */
function groupByPattern(sites: CutSite[], ctx: MethylationContext): { representative: CutSite; names: string[] }[] {
  const map = new Map<string, { representative: CutSite; names: string[] }>()
  for (const site of sites) {
    const key = `${site.enzyme.recognition.length}|${relativeCuts(site, ctx).join('|')}`
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

/**
 * Card content for a site several enzymes share: one row per enzyme with
 * its cut count, its overhang and whether methylation stops it here. The
 * cut is drawn on hover when they all cut alike; pinned, every distinct cut
 * is drawn.
 */
function EnzymeGroupContent({ group, ctx }: { group: GroupedCutSite; ctx: EnzymeCardContext }) {
  const pinned = useInPinnedCard()
  const meth = ctx.methylation
  const patterns = groupByPattern(group.sites, meth)
  // Each enzyme once, on the strand it was first found on.
  const rows: CutSite[] = []
  for (const s of group.sites) if (!rows.some(r => r.enzyme.name === s.enzyme.name)) rows.push(s)
  const showDiagrams = pinned || patterns.length === 1
  return (
    <>
      <div className="enzyme-tooltip-title">
        <span className="enzyme-tooltip-name">{group.label}</span>
      </div>
      <div className="enzyme-tooltip-position">Position {positionText(group.sites[0], meth).replace(/, bottom strand$/, '')}</div>
      <Banners cuts={group.cuts} methEffect={group.methEffect} methNote={group.methNote} />
      <div className="enzyme-group-list">
        {rows.map(site => {
          const eff = siteMethylationEffect(site, meth)
          return (
            <div key={site.enzyme.name} className="enzyme-group-row">
              <span className="enzyme-group-name">{site.enzyme.name}</span>
              <span className="enzyme-group-count"><CountChip name={site.enzyme.name} counts={ctx.cutCounts} /></span>
              <span className="enzyme-group-overhang">
                {site.offEnd ? 'no cut' : <OverhangText site={site} ctx={meth} />}
              </span>
              {eff && (
                <span className={`enzyme-methyl-tag ${eff.effect === 'blocked' ? 'danger' : 'warning'}`} title={siteMethylationNote(eff)}>
                  {eff.effect}
                </span>
              )}
            </div>
          )
        })}
      </div>
      {showDiagrams && patterns.map((pat, i) => (
        <div key={i} className="enzyme-tooltip-site">
          {patterns.length > 1 && <div className="enzyme-tooltip-site-names">{pat.names.join(', ')}</div>}
          <CutDiagramView site={pat.representative} ctx={meth} />
        </div>
      ))}
      {!showDiagrams && (
        <div className="enzyme-tooltip-position enzyme-tooltip-more">
          {patterns.length} different cuts here: pin to draw each
        </div>
      )}
    </>
  )
}

function EnzymeGroupTooltipContent({ group, ctx }: { group: GroupedCutSite; ctx: EnzymeCardContext }) {
  return new Set(group.sites.map(s => s.enzyme.name)).size === 1
    ? <EnzymeSiteContent group={group} ctx={ctx} />
    : <EnzymeGroupContent group={group} ctx={ctx} />
}

export default function EnzymeTooltip({ x, y, group, ctx, placement, above }: {
  x: number
  y: number
  group: GroupedCutSite
  ctx: EnzymeCardContext
  placement?: Omit<ClampOptions, 'above'>
  above?: boolean
}) {
  return (
    <HoverCard
      x={x} y={y} above={above} placement={placement}
      className="enzyme-tooltip"
      pinKey={`enzyme:${group.label}@${group.recognitionStart}`}
    >
      <EnzymeGroupTooltipContent group={group} ctx={ctx} />
    </HoverCard>
  )
}

/**
 * The sites behind a "+N" chip: names that no row of a crowded line had room
 * for, each listed with where it starts.
 */
export function SiteListTooltip({ x, y, groups, placement, above }: {
  x: number
  y: number
  groups: GroupedCutSite[]
  placement?: Omit<ClampOptions, 'above'>
  above?: boolean
}) {
  return (
    <HoverCard
      x={x} y={y} above={above} placement={placement}
      className="enzyme-tooltip"
      pinKey={`sites:${groups.map(g => `${g.label}@${g.recognitionStart}`).join(',')}`}
    >
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
