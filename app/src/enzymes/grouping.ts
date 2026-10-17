/**
 * Cut sites grouped by position: isoschizomers and neighbours recognising
 * the same start are drawn and hovered as one entry. Shared by the sequence
 * view and its minimap.
 */

import type { CutSite } from './finder'
import { methylationEffect, methylationNote } from './db'

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

/** Group cut sites at the same position into combined entries. */
let _groupedCache: { input: CutSite[]; dam: boolean; dcm: boolean; result: GroupedCutSite[] } | null = null
export function groupCutSites(sites: CutSite[], damMethylated = false, dcmMethylated = false): GroupedCutSite[] {
  if (_groupedCache && _groupedCache.input === sites && _groupedCache.dam === damMethylated && _groupedCache.dcm === dcmMethylated) return _groupedCache.result
  const result = _groupCutSitesImpl(sites, damMethylated, dcmMethylated)
  _groupedCache = { input: sites, dam: damMethylated, dcm: dcmMethylated, result }
  return result
}

function _groupCutSitesImpl(sites: CutSite[], damMethylated: boolean, dcmMethylated: boolean): GroupedCutSite[] {
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
      const eff = methylationEffect(site.enzyme, damMethylated, dcmMethylated)
      if (eff === 'blocked' || (eff === 'impaired' && methEffect === null)) {
        methEffect = eff
        methNote = methylationNote(site.enzyme, damMethylated, dcmMethylated)
      }
      if (eff === 'blocked') break
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
