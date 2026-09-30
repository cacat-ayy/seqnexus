/**
 * What a primer's 5' tail is for, as far as it can be read off the bases:
 * the restriction sites it carries.
 *
 * Only the enzymes people put in tails are checked (the common 6-cutters,
 * the rare cutters and the Golden Gate Type IIS enzymes). Checking the whole
 * REBASE list would name a 4-cutter in almost every tail.
 */

import { ENZYME_GROUPS, getEnzyme, type RestrictionEnzyme } from '../enzymes/db'
import { findCutSites } from '../enzymes/finder'

const TAIL_ENZYMES: RestrictionEnzyme[] = [...new Set([
  ...ENZYME_GROUPS['Common (6-cutters)'] ?? [],
  ...ENZYME_GROUPS['Rare (8-cutters)'] ?? [],
  ...ENZYME_GROUPS['Golden Gate (Type IIS)'] ?? [],
])].map(name => getEnzyme(name)).filter((e): e is RestrictionEnzyme => !!e)

const cache = new Map<string, string[]>()

/**
 * Enzymes with a recognition site that starts in the 5' tail. The first few
 * annealed bases are scanned too, since a site often runs across the join.
 * Enzymes sharing a recognition sequence are named together ("SmaI/XmaI").
 */
export function tailEnzymes(tail5: string, annealed: string): string[] {
  if (tail5.length === 0) return []
  const key = `${tail5}|${annealed.slice(0, 7)}`.toUpperCase()
  const hit = cache.get(key)
  if (hit) return hit

  const text = (tail5 + annealed.slice(0, 7)).toUpperCase()
  const byRecognition = new Map<string, string[]>()
  for (const enzyme of TAIL_ENZYMES) {
    if (!findCutSites(text, enzyme).some(s => s.position < tail5.length)) continue
    const rec = enzyme.recognition.toUpperCase()
    const names = byRecognition.get(rec) ?? []
    names.push(enzyme.name)
    byRecognition.set(rec, names)
  }
  const result = [...byRecognition.values()].map(names => names.join('/'))
  if (cache.size >= 200) cache.delete(cache.keys().next().value!)
  cache.set(key, result)
  return result
}
