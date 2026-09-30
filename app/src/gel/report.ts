/**
 * Words for what is on a gel: band descriptions for tooltips and tables, and
 * the per-lane rows the CSV and PDF exports share.
 */

import { bandLabelBp, type GelBand, type GelLayout, type PlacedSpecies } from './bands'
import type { FragmentOrigin, GelLane } from './model'
import { formatBp } from './render/scene'
import { getLadder } from './ladders'

export const FORM_LABEL: Record<PlacedSpecies['form'], string> = {
  linear: 'linear',
  supercoiled: 'supercoiled',
  nicked: 'nicked (open circular)',
}

export function formatNg(ng: number): string {
  if (ng >= 10) return `${Math.round(ng)} ng`
  if (ng >= 1) return `${ng.toFixed(1)} ng`
  return `${ng.toFixed(2)} ng`
}

/** One molecule in a few words: "3.0 kb" or "4.4 kb supercoiled". */
export function describeSpecies(s: PlacedSpecies): string {
  return s.form === 'linear' ? formatBp(s.bp) : `${formatBp(s.bp)} ${s.form}`
}

/**
 * 1-based, inclusive coordinates on the source: "1,203–2,410". A fragment
 * spanning the origin reads high to low: "4,001–120".
 */
export function fragmentPosition(f: FragmentOrigin, seqLen: number): string {
  const fmt = (n: number) => n.toLocaleString('en-US')
  // `end` is exclusive and 0-based, so it is also the 1-based last base; an
  // end of 0 means the fragment runs to the last base of a circle.
  return `${fmt(f.start + 1)}–${fmt(f.end === 0 ? seqLen : f.end)}`
}

export function fragmentEnds(f: FragmentOrigin): string {
  return `${f.leftEnzyme ?? 'end'} / ${f.rightEnzyme ?? 'end'}`
}

export function describeBand(band: GelBand): string {
  const parts: string[] = []
  if (band.members.length === 1) {
    const s = band.members[0]
    parts.push(formatBp(s.bp))
    if (s.form !== 'linear') parts.push(FORM_LABEL[s.form])
  } else {
    const sizes = new Set(band.members.map(m => m.bp))
    parts.push(sizes.size === 1
      ? `${formatBp(band.members[0].bp)} ×${band.members.length}`
      : `~${formatBp(bandLabelBp(band))} (${band.members.map(describeSpecies).join(', ')})`)
  }
  parts.push(formatNg(band.ng))
  if (!band.visible) parts.push('too faint to see')
  return parts.join(' · ')
}

/** Every molecule in a lane, largest first, including any that ran off. */
export function laneSpecies(lane: GelLayout['lanes'][number] | undefined): PlacedSpecies[] {
  if (!lane) return []
  return [...lane.bands.flatMap(b => b.members), ...lane.ranOff].sort((a, b) => b.bp - a.bp)
}

export interface LaneReportRow {
  lane: number
  type: string
  source: string
  enzymes: string
  fragCount: number
  fragments: string
}

const TYPE_LABEL = { empty: 'Empty', ladder: 'Ladder', sequence: 'Sample', pcr: 'PCR', sizes: 'Sizes' } as const

export function laneReport(
  lanes: GelLane[],
  layout: GelLayout,
  sourceName: (id: string) => string | null,
  opts: { enzymeSep: string; sizeSep: string; format: (s: PlacedSpecies) => string },
): LaneReportRow[] {
  return lanes.map((lane, i) => {
    const species = laneSpecies(layout.lanes[i])
    const s = lane.sample
    return {
      lane: i + 1,
      type: s.kind === 'sequence' && s.enzymes.length === 0 ? 'Uncut' : s.kind === 'sequence' ? 'Digest' : TYPE_LABEL[s.kind],
      source: s.kind === 'ladder' ? getLadder(s.ladderId)?.name ?? s.ladderId
        : s.kind === 'sequence' ? sourceName(s.sourceId) ?? 'Missing'
        : s.kind === 'pcr' ? sourceName(s.templateId) ?? 'Missing'
        : '',
      enzymes: s.kind === 'sequence' ? s.enzymes.join(opts.enzymeSep) : '',
      fragCount: species.length,
      fragments: species.map(opts.format).join(opts.sizeSep),
    }
  })
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function laneCsv(lanes: GelLane[], layout: GelLayout, sourceName: (id: string) => string | null): string {
  const rows = laneReport(lanes, layout, sourceName, {
    enzymeSep: '+',
    sizeSep: '; ',
    format: s => (s.form === 'linear' ? String(s.bp) : `${s.bp} ${s.form}`),
  })
  const header = 'Lane,Type,Source,Enzymes,# Fragments,Fragments (bp)'
  return [header, ...rows.map(r => [r.lane, r.type, r.source, r.enzymes, r.fragCount, r.fragments].map(csvCell).join(','))].join('\n')
}
