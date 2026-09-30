/**
 * Where else could a primer prime?
 *
 * A proper binding site needs 15 paired bases. Mispriming needs much less:
 * a 3' end that pairs well enough to be extended, even if the rest of the
 * primer hangs loose. So this runs the same binding search with looser
 * rules (fewer paired bases, more mismatches, but the last 8 bases at the
 * 3' end perfect) and reports whatever it finds besides the real sites.
 */

import { findBindingSites, type BindingSite } from './binding'
import type { PrimerData } from './oligo'

export const RELAXED = { minMatched: 12, maxMismatches: 4, threePrimeExact: 8 } as const

export interface OffTargetReport {
  /** Proper sites, as the rest of the app finds them. */
  sites: BindingSite[]
  /** Weaker places where the 3' end could still prime. */
  weak: BindingSite[]
}

export function offTargets(
  primer: PrimerData,
  template: string,
  topology: 'linear' | 'circular',
): OffTargetReport {
  const sites = findBindingSites([primer], template, topology).get(primer.id) ?? []
  const loose = findBindingSites([{ ...primer, role: 'primer' }], template, topology, RELAXED).get(primer.id) ?? []
  const same = (a: BindingSite, b: BindingSite) =>
    a.strand === b.strand && (a.strand === 1 ? a.end === b.end : a.start === b.start)
  return { sites, weak: loose.filter(w => !sites.some(s => same(s, w))) }
}
