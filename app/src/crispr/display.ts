/**
 * Guides as the sequence view sees them.
 *
 * Each site becomes a stand-in Annotation, the way a primer binding site
 * does, so it rides the existing stacking, hit-testing and hover machinery
 * without the painter needing a new lane model. The span is the footprint:
 * protospacer plus PAM, so the PAM has room in the lane instead of being
 * drawn over whatever sits beside it. Which part of that footprint is the
 * PAM, and where the two cuts fall, the painter works out from the site.
 */

import { Annotation } from '../models/Annotation'
import { guideIdFor, guideKey, guideName } from '../utils/guide-features'
import type { GuideCandidate, Nuclease } from './types'

export interface GuideItem {
  candidate: GuideCandidate
  nuclease: Nuclease
  /** Identity of the site, for picks and hover. */
  key: string
  /** Stand-in whose span is the footprint: protospacer plus PAM. */
  annotation: Annotation
  /** Whether the PAM sits at the lower coordinate of the footprint. */
  pamFirst: boolean
  /** A pick the user has not kept yet, drawn dashed. */
  preview?: boolean
}

/**
 * Does the PAM come before the protospacer in sense coordinates? True for a
 * 5' PAM read along the sense strand, and for a 3' PAM read along the
 * antisense strand, where the whole site is mirrored.
 */
export function pamComesFirst(pamSide: Nuclease['pamSide'], strand: 1 | -1): boolean {
  return (pamSide === 'fivePrime') === (strand === 1)
}

export function guideItems(
  candidates: readonly GuideCandidate[],
  nucleaseById: (id: string) => Nuclease | undefined,
  seqLen: number,
  opts: { preview?: boolean } = {},
): GuideItem[] {
  const items: GuideItem[] = []
  for (const candidate of candidates) {
    const { site } = candidate
    const nuclease = nucleaseById(site.nucleaseId)
    if (!nuclease) continue
    const pamFirst = pamComesFirst(nuclease.pamSide, site.strand)
    const footStart = pamFirst ? site.pamStart : site.start
    const span = site.spacer.length + site.pam.length
    const footEnd = seqLen > 0 ? (footStart + span) % seqLen : footStart + span
    items.push({
      candidate,
      nuclease,
      key: guideKey(site),
      pamFirst,
      annotation: new Annotation({
        id: guideIdFor(site),
        name: guideName(site, nuclease),
        type: 'misc_binding',
        start: footStart,
        // A footprint ending exactly at the sequence end keeps its end there
        // rather than wrapping to zero, which would read as a wrapped span.
        end: footEnd === 0 && footStart + span === seqLen ? seqLen : footEnd,
        strand: site.strand,
      }),
      ...(opts.preview ? { preview: true as const } : {}),
    })
  }
  return items
}
