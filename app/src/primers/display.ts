/**
 * Primers as the sequence and plasmid views see them.
 *
 * A saved primer is drawn once per binding site, in the feature lanes. Each
 * site becomes a stand-in Annotation so it rides the existing stacking,
 * hit-testing and hover machinery; its span is the site's footprint (the
 * annealed part plus any tails), so a tail gets room in its lane instead of
 * being drawn over whatever sits next to it.
 */

import { Annotation } from '../models/Annotation'
import type { BindingSite } from './binding'
import { primerColor, type PrimerData } from './oligo'
import { calcTm, gcPercent } from './thermodynamics'
import { DEFAULT_CONSTRAINTS } from './scoring'
import { siteTm } from './thermo/site'
import type { Conditions } from './thermo/duplex'

export const PRIMER_ITEM_PREFIX = '_oligo_'

/** True for the stand-in annotations built here. */
export function isPrimerItemId(id: string): boolean {
  return id.startsWith(PRIMER_ITEM_PREFIX)
}

/** Stand-in id for a primer's nth binding site. */
export function primerItemId(primerId: string, siteIndex: number): string {
  return `${PRIMER_ITEM_PREFIX}${primerId}:${siteIndex}`
}

export interface PrimerItem {
  primer: PrimerData
  site: BindingSite
  /** Stand-in whose span is the footprint: site plus tails. */
  annotation: Annotation
  /** An unsaved pick from the workbench, drawn dashed. */
  preview?: boolean
}

/**
 * One item per binding site.
 *
 * Tails are clamped at the ends of the sequence rather than wrapped: a tail
 * does not pair, so drawing it on the far side of the origin would put it
 * over bases it has nothing to do with. A site that itself wraps the origin
 * is drawn without its tails for the same reason.
 */
export function primerItems(
  primers: readonly PrimerData[],
  sites: ReadonlyMap<string, BindingSite[]>,
  seqLen: number,
  opts: { preview?: boolean } = {},
): PrimerItem[] {
  const items: PrimerItem[] = []
  for (const primer of primers) {
    ;(sites.get(primer.id) ?? []).forEach((site, i) => {
      let start = site.start
      let end = site.end
      if (site.start < site.end) {
        const left = site.strand === 1 ? site.tail5.length : site.tail3.length
        const right = site.strand === 1 ? site.tail3.length : site.tail5.length
        start = Math.max(0, site.start - left)
        end = Math.min(seqLen, site.end + right)
      }
      items.push({
        primer,
        site,
        ...(opts.preview ? { preview: true } : {}),
        annotation: new Annotation({
          id: primerItemId(primer.id, i),
          name: primer.name,
          type: 'primer_bind',
          start,
          end,
          strand: site.strand,
          color: primerColor(primer, site.strand),
        }),
      })
    })
  }
  return items
}

export type PenaltyQuality = 'good' | 'ok' | 'poor'

/** Traffic-light banding of a design penalty, shared by the track and lists. */
export function penaltyQuality(penalty: number): PenaltyQuality {
  return penalty < 3 ? 'good' : penalty < 7 ? 'ok' : 'poor'
}

/** The designer's default buffer, so every view quotes one number. */
const DEFAULT_CONDITIONS: Conditions = {
  oligoConc: DEFAULT_CONSTRAINTS.primerConc,
  mono: DEFAULT_CONSTRAINTS.naConc,
  mg: DEFAULT_CONSTRAINTS.mgConc,
  dntp: DEFAULT_CONSTRAINTS.dntpConc,
}

/** Perfect-match Tm under the default buffer. */
export function oligoTm(bases: string): number {
  return calcTm(bases.toUpperCase(), {
    primerConc: DEFAULT_CONDITIONS.oligoConc,
    naConc: DEFAULT_CONDITIONS.mono,
    mgConc: DEFAULT_CONDITIONS.mg,
    dntpConc: DEFAULT_CONDITIONS.dntp,
  })
}

export interface OligoSummary {
  length: number
  gc: number
  /** Whole oligo: what anneals once the tail has been copied into the product. */
  tmFull: number
  /** Just the annealed part: what anneals in the first cycles. Null if unbound. */
  tmAnneal: number | null
}

/**
 * With the template, the annealed Tm is taken against the bases the primer
 * actually faces, so a mismatch lowers it; without, it is the perfect-match
 * Tm of the annealed part.
 */
export function summarizeOligo(
  primer: PrimerData,
  site: BindingSite | null,
  template?: { bases: string; topology: 'linear' | 'circular' },
): OligoSummary {
  let tmAnneal: number | null = null
  if (site) {
    tmAnneal = template
      ? siteTm(primer.sequence, site, template.bases, template.topology, DEFAULT_CONDITIONS)
      : oligoTm(primer.sequence.slice(site.annealFrom, site.annealTo))
  }
  return {
    length: primer.sequence.length,
    gc: gcPercent(primer.sequence),
    tmFull: oligoTm(primer.sequence),
    tmAnneal,
  }
}

/** Template position of an oligo index at a site, for marking mismatches. */
export function templatePosOf(site: BindingSite, oligoIndex: number, seqLen: number): number {
  const offset = oligoIndex - site.annealFrom
  const pos = site.strand === 1 ? site.start + offset : endBefore(site.end, seqLen) - offset
  return ((pos % seqLen) + seqLen) % seqLen
}

/** The last annealed position, which is `end - 1` unwrapped. */
function endBefore(end: number, seqLen: number): number {
  return end === 0 ? seqLen - 1 : end - 1
}
