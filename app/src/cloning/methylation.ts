/**
 * Which cut sites dam/dcm methylation takes away.
 *
 * Both motifs are palindromic, so each is methylated on both strands. A
 * methyl group only gets in an enzyme's way where it sits on a base the
 * enzyme reads, so a motif merely nearby changes nothing.
 *
 * Shared by the cloning digest and the virtual gel so the two always agree
 * on which sites cut.
 */

import type { RestrictionEnzyme } from '../enzymes/db'
import { findCutSites, cuttingSites, splitCuts, type CutSite } from '../enzymes/finder'

/**
 * A methylation motif and which of its bases carry the methyl group, counted
 * on the top strand. Both motifs are palindromic, so each is methylated on
 * both strands: dam puts N6-methyladenine on the A of GATC (offset 1, and
 * offset 2 for the bottom strand's A); dcm puts 5-methylcytosine on the inner
 * C of CCWGG (offset 1, and offset 3 for the bottom strand).
 */
interface MethylMotif {
  pattern: RegExp
  length: number
  methylated: number[]
}

const DAM: MethylMotif = { pattern: /^GATC$/, length: 4, methylated: [1, 2] }
const DCM: MethylMotif = { pattern: /^CC[AT]GG$/, length: 5, methylated: [1, 3] }

/**
 * Whether a methylated base of `motif` lies inside the recognition site.
 * Methylation only gets in an enzyme's way where it touches the bases the
 * enzyme reads; a motif merely nearby changes nothing.
 */
function motifOverlapsSite(
  bases: string,
  topology: 'linear' | 'circular',
  siteStart: number,
  siteLength: number,
  motif: MethylMotif,
): boolean {
  const seqLen = bases.length
  const circular = topology === 'circular'
  for (let m = siteStart - motif.length + 1; m < siteStart + siteLength; m++) {
    if (!motif.methylated.some(o => m + o >= siteStart && m + o < siteStart + siteLength)) continue
    let window = ''
    for (let i = m; i < m + motif.length; i++) {
      if (!circular && (i < 0 || i >= seqLen)) { window = ''; break }
      window += bases[((i % seqLen) + seqLen) % seqLen]
    }
    if (window && motif.pattern.test(window.toUpperCase())) return true
  }
  return false
}

/**
 * How dam/dcm methylation affects one site: blocked, impaired, or not at all.
 * `unmethylated` marks a block for want of a methylation the enzyme needs.
 */
function siteMethylationEffect(
  site: CutSite,
  bases: string,
  topology: 'linear' | 'circular',
  enzyme: RestrictionEnzyme,
  dam: boolean,
  dcm: boolean,
): { effect: 'blocked' | 'impaired'; by: 'dam' | 'dcm'; unmethylated?: true } | null {
  const len = enzyme.recognition.length
  const reaches = (motif: MethylMotif) => motifOverlapsSite(bases, topology, site.position, len, motif)
  // DpnI and the like cut only where the methylation is there.
  if (enzyme.dam === 'required' && !(dam && reaches(DAM))) return { effect: 'blocked', by: 'dam', unmethylated: true }
  if (enzyme.dcm === 'required' && !(dcm && reaches(DCM))) return { effect: 'blocked', by: 'dcm', unmethylated: true }
  const sensitive = (flag: RestrictionEnzyme['dam']) => flag === 'blocked' || flag === 'impaired'
  const damHit = dam && sensitive(enzyme.dam) && reaches(DAM)
  const dcmHit = dcm && sensitive(enzyme.dcm) && reaches(DCM)
  if (damHit && enzyme.dam === 'blocked') return { effect: 'blocked', by: 'dam' }
  if (dcmHit && enzyme.dcm === 'blocked') return { effect: 'blocked', by: 'dcm' }
  if (damHit) return { effect: 'impaired', by: 'dam' }
  if (dcmHit) return { effect: 'impaired', by: 'dcm' }
  return null
}

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
  let blockedByMethylation = 0
  for (const enzyme of enzymes) {
    let needs: 'dam' | 'dcm' | null = null
    for (const site of cuttingSites(findCutSites(bases, enzyme, topology))) {
      const meth = siteMethylationEffect(site, bases, topology, enzyme, dam, dcm)
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
