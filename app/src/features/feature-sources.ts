/**
 * Where auto-annotation gets its reference features from.
 *
 * The built-in library covers common cloning parts, which is the right default
 * and useless to a lab whose plasmids are built from its own internal parts.
 * So the reference set is a list of sources: the built-in one plus any database
 * the user imports, each independently switchable.
 */

import { getCommonFeatures, type CommonFeature } from './common-features'
import type { ReferenceAnnotation } from '../workers/annotate-list'

export const BUILTIN_SOURCE_ID = 'builtin'
export const BUILTIN_SOURCE_NAME = 'Common features (built-in)'

export interface FeatureSource {
  id: string
  name: string
  /** The bundled library. Exactly one source has this, and it is never stored. */
  builtin: boolean
  enabled: boolean
  /** Epoch ms, for stable ordering of imports. */
  addedAt: number
  features: CommonFeature[]
}

/** A custom source as it goes to and comes back from IndexedDB. */
export type StoredFeatureSource = Omit<FeatureSource, 'builtin'>

/**
 * The persistable shape of a source.
 *
 * `builtin` is derived from where the source came from, so storing it would
 * only create a second, staler answer to the same question.
 */
export function toStoredSource(s: FeatureSource): StoredFeatureSource {
  return { id: s.id, name: s.name, enabled: s.enabled, addedAt: s.addedAt, features: s.features }
}

/**
 * The built-in source.
 *
 * `features` is a getter on purpose: this object exists from the moment the
 * store is created, but the bundled library is ~700 base64-packed sequences
 * that only need decoding once someone actually annotates. `getCommonFeatures`
 * caches, so the first read pays and the rest are free.
 */
export function builtinSource(enabled = true): FeatureSource {
  return {
    id: BUILTIN_SOURCE_ID,
    name: BUILTIN_SOURCE_NAME,
    builtin: true,
    enabled,
    addedAt: 0,
    get features() { return getCommonFeatures() },
  }
}

/** Identity of a reference entry across sources. */
function entryKey(f: { name: string; type: string }): string {
  return `${f.name}\u0000${f.type}`
}

export interface ScanReferences {
  references: ReferenceAnnotation[]
  /** entryKey → source id, so a hit can say which database it came from. */
  originBySource: Map<string, string>
}

/**
 * Flatten the enabled sources into one reference list for the scan worker.
 *
 * One merged list rather than one scan per source: the worker builds a k-mer
 * index of the document per call, and that cost does not depend on how many
 * references come with it.
 *
 * A custom entry displaces a built-in one with the same name and type. A lab
 * that has corrected a stock part wants its own version used, not both — and
 * two near-identical references would otherwise produce two overlapping
 * proposals for the same stretch of DNA.
 */
export function getScanReferences(sources: readonly FeatureSource[]): ScanReferences {
  const chosen = new Map<string, { feature: CommonFeature; sourceId: string }>()
  // Custom sources are applied after the built-in one, so they overwrite it.
  const ordered = [...sources.filter(s => !s.builtin), ...sources.filter(s => s.builtin)]
  for (const source of ordered) {
    if (!source.enabled) continue
    for (const feature of source.features) {
      const key = entryKey(feature)
      if (chosen.has(key)) continue
      chosen.set(key, { feature, sourceId: source.id })
    }
  }

  const references: ReferenceAnnotation[] = []
  const originBySource = new Map<string, string>()
  for (const [key, { feature, sourceId }] of chosen) {
    references.push({
      name: feature.name,
      type: feature.type,
      sequence: feature.sequence,
      color: feature.color || undefined,
    })
    originBySource.set(key, sourceId)
  }
  return { references, originBySource }
}

/** Source id a match came from, or null when it cannot be attributed. */
export function sourceIdForMatch(
  m: { refName: string; refType: string },
  originBySource: Map<string, string>,
): string | null {
  return originBySource.get(entryKey({ name: m.refName, type: m.refType })) ?? null
}

/**
 * A signature of what the next scan would search against.
 *
 * Used as an effect dependency: importing a database, or ticking one on or
 * off, has to re-run the scan, and nothing else about the sources should.
 */
export function enabledSourcesSignature(sources: readonly FeatureSource[]): string {
  return sources
    .filter(s => s.enabled)
    // The bundled library never changes within a session, and reading its
    // length would decode it — which is exactly what the getter avoids.
    .map(s => `${s.id}:${s.builtin ? 'builtin' : s.features.length}`)
    .join('|')
}

/** Category options for the results filter: built-ins plus each custom source. */
export function customCategories(sources: readonly FeatureSource[]): string[] {
  const seen = new Set<string>()
  for (const source of sources) {
    if (source.builtin) continue
    for (const f of source.features) if (f.category) seen.add(f.category)
  }
  return [...seen].sort()
}
