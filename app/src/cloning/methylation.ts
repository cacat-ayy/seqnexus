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
import { findCutSites, cuttingSites, type CutSite } from '../enzymes/finder'

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

/** How dam/dcm methylation affects one site: blocked, impaired, or not at all. */
function siteMethylationEffect(
  site: CutSite,
  bases: string,
  topology: 'linear' | 'circular',
  enzyme: RestrictionEnzyme,
  dam: boolean,
  dcm: boolean,
): { effect: 'blocked' | 'impaired'; by: 'dam' | 'dcm' } | null {
  const len = enzyme.recognition.length
  const damHit = dam && enzyme.dam !== undefined && enzyme.dam !== 'insensitive' && enzyme.dam !== 'unknown'
    && motifOverlapsSite(bases, topology, site.position, len, DAM)
  const dcmHit = dcm && enzyme.dcm !== undefined && enzyme.dcm !== 'insensitive' && enzyme.dcm !== 'unknown'
    && motifOverlapsSite(bases, topology, site.position, len, DCM)
  if (damHit && enzyme.dam === 'blocked') return { effect: 'blocked', by: 'dam' }
  if (dcmHit && enzyme.dcm === 'blocked') return { effect: 'blocked', by: 'dcm' }
  if (damHit) return { effect: 'impaired', by: 'dam' }
  if (dcmHit) return { effect: 'impaired', by: 'dcm' }
  return null
}

export interface MethylationFilterResult {
  /** Sites the enzymes can still cut. */
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
  for (const enzyme of enzymes) {
    for (const site of cuttingSites(findCutSites(bases, enzyme, topology))) {
      const meth = siteMethylationEffect(site, bases, topology, enzyme, dam, dcm)
      if (meth?.effect === 'blocked') {
        blocked.push(site)
        continue
      }
      if (meth) {
        warnings.push(`${enzyme.name} site at position ${site.position + 1} may be impaired by ${meth.by} methylation`)
      }
      sites.push(site)
    }
  }
  if (blocked.length > 0) {
    warnings.push(`${blocked.length} cut site${blocked.length > 1 ? 's' : ''} blocked by methylation`)
  }
  return { sites, blocked, warnings }
}
