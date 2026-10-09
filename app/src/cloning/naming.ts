import type { CloningFragment } from './types'

/**
 * Generate a product name from its constituent fragments.
 *
 * Heuristic: the fragment with the largest sequence is the backbone/vector.
 * All other source names are inserts. If there's a clear vector + insert(s),
 * the name is "{vector}::{insert1}-{insert2}". Otherwise, joins all source
 * names with " + ".
 */
export function productName(fragments: CloningFragment[]): string {
  if (fragments.length === 0) return 'Cloning product'
  if (fragments.length === 1) return fragments[0].sourceName

  // Find the largest fragment (backbone)
  let backboneIdx = 0
  for (let i = 1; i < fragments.length; i++) {
    if (fragments[i].sequence.length > fragments[backboneIdx].sequence.length) {
      backboneIdx = i
    }
  }

  const backboneName = fragments[backboneIdx].sourceName
  const insertNames: string[] = []
  for (let i = 0; i < fragments.length; i++) {
    if (i === backboneIdx) continue
    const name = fragments[i].sourceName
    if (!insertNames.includes(name)) insertNames.push(name)
  }

  if (insertNames.length === 0) return backboneName
  return `${backboneName}::${insertNames.join('-')}`
}

/**
 * Generate a product description with method name and fragment details.
 */
export function productDescription(method: string, fragments: CloningFragment[]): string {
  const names = fragments.map(f => f.name)
  return `${method} of ${names.join(' + ')}`
}

