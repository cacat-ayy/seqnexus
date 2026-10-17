/**
 * Which cut sites dam/dcm methylation takes away.
 *
 * The rule itself (a methylated base inside the recognition site) lives in
 * enzymes/methylation.ts, which the maps and the hover card use too. This
 * applies it to a digest, so the cloning digest and the virtual gel always
 * agree on which sites cut.
 */

import type { RestrictionEnzyme } from '../enzymes/db'
import { findCutSites, cuttingSites, splitCuts, type CutSite } from '../enzymes/finder'
import { siteMethylationEffect } from '../enzymes/methylation'

export interface MethylationFilterResult {
  /**
   * Sites the enzymes can still cut, one entry per break: a Type IIB site,
   * which cuts on both sides of itself, is two entries.
   */
  sites: CutSite[]
  /** Sites dropped because dam/dcm methylation blocks them. */
  blocked: CutSite[]
  warnings: string[]
}

/**
 * Find every cut site of `enzymes`, dropping the ones dam/dcm methylation
 * blocks. Shared by the cloning digest and the virtual gel so both agree on
 * which sites cut.
 */
export function findUnblockedSites(
  bases: string,
  topology: 'linear' | 'circular',
  enzymes: RestrictionEnzyme[],
  dam: boolean,
  dcm: boolean,
): MethylationFilterResult {
  const warnings: string[] = []
  const sites: CutSite[] = []
  const blocked: CutSite[] = []
  const ctx = { bases, topology, dam, dcm }
  let blockedByMethylation = 0
  for (const enzyme of enzymes) {
    let needs: 'dam' | 'dcm' | null = null
    for (const site of cuttingSites(findCutSites(bases, enzyme, topology))) {
      const meth = siteMethylationEffect(site, ctx)
      if (meth?.effect === 'blocked') {
        blocked.push(site)
        if (meth.unmethylated) needs = meth.by
        else blockedByMethylation++
        continue
      }
      if (meth) {
        warnings.push(`${enzyme.name} site at position ${site.position + 1} may be impaired by ${meth.by} methylation`)
      }
      for (const cut of splitCuts([site])) sites.push(cut)
    }
    if (needs) {
      warnings.push(`${enzyme.name} only cuts ${needs === 'dam' ? 'Dam' : 'Dcm'}-methylated DNA, and this sequence is not marked ${needs === 'dam' ? 'Dam' : 'Dcm'}-methylated`)
    }
  }
  if (blockedByMethylation > 0) {
    warnings.push(`${blockedByMethylation} cut site${blockedByMethylation > 1 ? 's' : ''} blocked by methylation`)
  }
  return { sites, blocked, warnings }
}
