/**
 * Guides as overlay items and as real features.
 *
 * The same arrangement ORFs and motifs use: the scan draws every site it
 * found as a stand-in annotation, Ctrl-click picks, and one conversion turns
 * the picked sites (or all of them) into features in a single undo step.
 *
 * A converted feature covers the protospacer alone, not the PAM. The spacer
 * is the part you order and the part that binds; the PAM belongs to the
 * target, so a feature over it would claim the nuclease recognises a stretch
 * of DNA it only reads from. The PAM and both cut positions go in the note
 * instead, which is also what a GenBank round trip keeps.
 */

import type { AnnotationData } from '../models/Annotation'
import type { GuideSite, Nuclease } from '../crispr/types'

/** Ids of the synthetic annotations the views draw guide sites as. */
export const GUIDE_ID_PREFIX = '_guide_'

/** Identity of a site, stable across re-scans of the same settings. */
export function guideKey(site: GuideSite): string {
  return `${site.nucleaseId}:${site.strand === 1 ? '+' : '-'}:${site.start}:${site.end}`
}

export function guideIdFor(site: GuideSite): string {
  return GUIDE_ID_PREFIX + guideKey(site)
}

/** The key back out of a site's annotation id, or null if it is not one. */
export function keyFromGuideId(id: string): string | null {
  return id.startsWith(GUIDE_ID_PREFIX) ? id.slice(GUIDE_ID_PREFIX.length) : null
}

export function isGuideId(id: string): boolean {
  return id.startsWith(GUIDE_ID_PREFIX)
}

/**
 * What a site is called: the nuclease, where its protospacer starts counting
 * from one, and which strand it reads. Short enough for a lane label and
 * unique enough to search for.
 */
export function guideName(site: GuideSite, nuclease: Nuclease): string {
  return `${nuclease.name} ${site.start + 1}${site.strand === 1 ? '+' : '-'}`
}

/** The note a converted feature carries, which is also the tooltip's second line. */
export function guideNote(site: GuideSite, nuclease: Nuclease): string {
  const parts = [
    `${nuclease.name} guide`,
    `spacer ${site.spacer}`,
    `PAM ${site.pam} (${nuclease.pamSide === 'threePrime' ? "3'" : "5'"})`,
  ]
  if (nuclease.cleaves === 'none') {
    parts.push('binding only, no cut')
  } else if (site.cutTop === site.cutBottom) {
    parts.push(`blunt cut after ${site.cutTop}`)
  } else {
    parts.push(`cuts after ${site.cutTop} and ${site.cutBottom}`)
  }
  return parts.join('; ')
}

const idRun = Date.now().toString(36)
let idCounter = 0

/**
 * A site as a feature. The colour is a document value once converted, so it
 * is written as data here rather than read from a theme token: a violet that
 * reads as a guide in every theme and in an export.
 */
export function guideToAnnotationData(site: GuideSite, nuclease: Nuclease): AnnotationData {
  return {
    id: `guide_${idRun}_${++idCounter}`,
    name: guideName(site, nuclease),
    type: 'misc_binding',
    start: site.start,
    end: site.end,
    strand: site.strand,
    color: '#7c3aed',
    qualifiers: { note: [guideNote(site, nuclease)] },
  }
}

/** Is there already a feature on exactly this protospacer, under this name? */
export function isGuideAnnotated(
  site: GuideSite,
  nuclease: Nuclease,
  annotations: readonly { name: string; start: number; end: number }[],
): boolean {
  const name = guideName(site, nuclease)
  return annotations.some(a => a.start === site.start && a.end === site.end && a.name === name)
}

/** The sites a conversion would actually add. */
export function convertibleGuides(
  sites: readonly GuideSite[],
  nuclease: Nuclease,
  annotations: readonly { name: string; start: number; end: number }[],
): GuideSite[] {
  if (sites.length === 0) return []
  if (annotations.length === 0) return [...sites]
  return sites.filter(s => !isGuideAnnotated(s, nuclease, annotations))
}
