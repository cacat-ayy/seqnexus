/**
 * Cut sites grouped by position: isoschizomers and neighbours recognising
 * the same start are drawn and hovered as one entry. Shared by the sequence
 * view and its minimap.
 */

import { cuttingSites, type CutSite } from './finder'
import { siteMethylationEffect, siteMethylationNote, type MethylationContext } from './methylation'

export interface GroupedCutSite {
  /** All individual cut sites in this group */
  sites: CutSite[]
  /** Start of the union recognition region */
  recognitionStart: number
  /** End of the union recognition region (exclusive) */
  recognitionEnd: number
  /** Display label */
  label: string
  /** Primary cut position (fwdCut of first site) */
  fwdCut: number
  /**
   * Whether any site here cuts. A Type IIS site near an end of a linear
   * sequence would cut past it, so it is there but cuts nothing.
   */
  cuts: boolean
  /** Where the name and its leader go: the cut, or the site's start when it does not cut. */
  labelPos: number
  /** Methylation effect on this group: 'blocked', 'impaired', or null */
  methEffect: 'blocked' | 'impaired' | null
  /** The effect in words, for hover cards and lists; null when there is none. */
  methNote: string | null
}

/**
 * Stable identity for a grouped cut site, for hover tracking.
 *
 * Grouped sites are rebuilt on each scan, so object identity is useless here:
 * the delayed-hover hook needs a key that survives that and still distinguishes
 * two different enzymes cutting at nearby positions.
 */
export function enzymeGroupKey(group: GroupedCutSite): string {
  return `${group.label}@${group.recognitionStart}`
}

/** No methylation and no bases: only an enzyme that needs a methylation is affected. */
const UNMETHYLATED: MethylationContext = { bases: '', topology: 'linear', dam: false, dcm: false }

/**
 * Group cut sites at the same position into combined entries. `methylation`
 * is the sequence the sites are in and how it is methylated: a site is
 * blocked only where a methylated base falls inside it, so it takes the bases.
 */
let _groupedCache: { input: CutSite[]; ctx: MethylationContext; result: GroupedCutSite[] } | null = null
export function groupCutSites(sites: CutSite[], methylation: MethylationContext = UNMETHYLATED): GroupedCutSite[] {
  const c = _groupedCache
  if (c && c.input === sites && c.ctx.bases === methylation.bases && c.ctx.topology === methylation.topology
    && c.ctx.dam === methylation.dam && c.ctx.dcm === methylation.dcm) return c.result
  const result = _groupCutSitesImpl(sites, methylation)
  _groupedCache = { input: sites, ctx: methylation, result }
  return result
}

/**
 * How many times each enzyme cuts, by name: sites past an end of a linear
 * sequence do not count. For the "1×" on a site's hover card.
 */
const _countCache = new WeakMap<readonly CutSite[], Map<string, number>>()
export function cutCountsByEnzyme(sites: readonly CutSite[]): ReadonlyMap<string, number> {
  let counts = _countCache.get(sites)
  if (!counts) {
    counts = new Map()
    for (const s of cuttingSites(sites)) counts.set(s.enzyme.name, (counts.get(s.enzyme.name) ?? 0) + 1)
    _countCache.set(sites, counts)
  }
  return counts
}

function _groupCutSitesImpl(sites: CutSite[], methylation: MethylationContext): GroupedCutSite[] {
  if (sites.length === 0) return []
  const groups: GroupedCutSite[] = []
  let i = 0
  while (i < sites.length) {
    const current = sites[i]
    const bucket: CutSite[] = [current]
    const recStart = current.position
    let recEnd = current.position + current.enzyme.recognition.length
    // Collect sites at the same position
    let j = i + 1
    while (j < sites.length && sites[j].position === current.position) {
      bucket.push(sites[j])
      const end = sites[j].position + sites[j].enzyme.recognition.length
      if (end > recEnd) recEnd = end
      j++
    }
    // Build label: each enzyme once, though a non-palindromic site can be
    // there on both strands (MspJI on CAAG).
    const names = [...new Set(bucket.map(s => s.enzyme.name))]
    let label: string
    if (names.length === 1) {
      label = names[0]
    } else if (names.length === 2) {
      label = names[0] + ' / ' + names[1]
    } else {
      label = names[0] + ' +' + (names.length - 1)
    }
    const cutting = bucket.find(s => !s.offEnd)
    // Worst methylation effect across all enzymes in the group
    // (An enzyme that needs a methylation is blocked without it, so this
    // runs on unmethylated DNA too.)
    let methEffect: 'blocked' | 'impaired' | null = null
    let methNote: string | null = null
    for (const site of bucket) {
      const eff = siteMethylationEffect(site, methylation)
      if (eff && (eff.effect === 'blocked' || methEffect === null)) {
        methEffect = eff.effect
        methNote = siteMethylationNote(eff)
      }
      if (eff?.effect === 'blocked') break
    }
    groups.push({
      sites: bucket,
      recognitionStart: recStart,
      recognitionEnd: recEnd,
      label,
      fwdCut: cutting?.fwdCut ?? current.fwdCut,
      cuts: cutting !== undefined,
      labelPos: cutting?.fwdCut ?? recStart,
      methEffect,
      methNote,
    })
    i = j
  }
  return groups
}
