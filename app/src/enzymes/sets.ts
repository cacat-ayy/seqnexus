/**
 * The enzymes a restriction analysis runs: a built-in subset of the
 * database, or a set the user saved (made in the Restriction Analysis panel,
 * or imported from a Geneious enzyme set).
 *
 * A subset is chosen by key: the built-in keys below, or `set:<id>` for a
 * saved set. A saved set holds enzyme names, canonical as the database
 * spells them, so a set keeps working whatever the database's order.
 */

import { ENZYME_DB, ENZYME_GROUPS, type RestrictionEnzyme } from './db'

export interface EnzymeSet {
  id: string
  name: string
  /** Enzyme names as the database spells them, without duplicates. */
  enzymes: string[]
  createdAt: number
}

/** The built-in subsets, in the order the picker lists them; group null is the whole database. */
export const BUILT_IN_SUBSETS: { key: string; label: string; group: string | null }[] = [
  { key: 'all', label: 'All enzymes', group: null },
  { key: 'common6', label: 'Common (6-cutters)', group: 'Common (6-cutters)' },
  { key: 'rare8', label: 'Rare (8-cutters)', group: 'Rare (8-cutters)' },
  { key: 'freq4', label: 'Frequent (4-cutters)', group: 'Frequent (4-cutters)' },
  { key: 'goldengate', label: 'Golden Gate (Type IIS)', group: 'Golden Gate (Type IIS)' },
  { key: 'all6', label: 'All 6-cutters', group: 'All 6-cutters' },
  { key: 'all4', label: 'All 4-cutters', group: 'All 4-cutters' },
  { key: 'all8plus', label: 'All 8+ cutters', group: 'All 8+ cutters' },
  { key: 'blunt', label: 'Blunt cutters', group: 'Blunt cutters' },
  { key: 'overhang5', label: "5' overhang", group: "5' overhang" },
  { key: 'overhang3', label: "3' overhang", group: "3' overhang" },
  { key: 'typeIIS', label: 'Type IIS', group: 'Type IIS' },
]

/** The subset a new session starts with. */
export const DEFAULT_SUBSET = 'common6'

const SET_PREFIX = 'set:'

/** The subset key of a saved set. */
export const setKey = (id: string) => `${SET_PREFIX}${id}`

/** The saved set a subset key names, if it names one that exists. */
export function setForKey(key: string, sets: readonly EnzymeSet[]): EnzymeSet | undefined {
  if (!key.startsWith(SET_PREFIX)) return undefined
  const id = key.slice(SET_PREFIX.length)
  return sets.find(s => s.id === id)
}

const BY_NAME = new Map(ENZYME_DB.map(e => [e.name.toLowerCase(), e]))

/**
 * The enzymes of a subset. A key that names nothing (a set since deleted)
 * falls back to the default subset rather than to every enzyme.
 */
export function subsetEnzymes(key: string, sets: readonly EnzymeSet[]): RestrictionEnzyme[] {
  const saved = setForKey(key, sets)
  if (saved) return saved.enzymes.flatMap(n => BY_NAME.get(n.toLowerCase()) ?? [])
  const builtIn = BUILT_IN_SUBSETS.find(s => s.key === key) ?? BUILT_IN_SUBSETS.find(s => s.key === DEFAULT_SUBSET)!
  if (!builtIn.group) return ENZYME_DB
  const names = new Set(ENZYME_GROUPS[builtIn.group] ?? [])
  return ENZYME_DB.filter(e => names.has(e.name))
}

/**
 * Enzyme names as the database spells them, matched without regard to
 * case, each once, and the names it does not know.
 */
export function resolveEnzymeNames(names: readonly string[]): { known: string[]; missing: string[] } {
  const known: string[] = []
  const missing: string[] = []
  const seen = new Set<string>()
  for (const raw of names) {
    const name = raw.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const enzyme = BY_NAME.get(name.toLowerCase())
    if (enzyme) known.push(enzyme.name)
    else missing.push(name)
  }
  return { known, missing }
}

/** `name`, or `name 2`, `name 3`... so that no two saved sets share a name. */
export function freeSetName(name: string, sets: readonly EnzymeSet[], except?: string): string {
  const base = name.trim() || 'Enzyme set'
  const taken = new Set(sets.filter(s => s.id !== except).map(s => s.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  let n = 2
  while (taken.has(`${base} ${n}`.toLowerCase())) n++
  return `${base} ${n}`
}

/** Saved sets read back from a session, keeping only well-formed ones. */
export function sanitizeEnzymeSets(raw: unknown): EnzymeSet[] {
  if (!Array.isArray(raw)) return []
  const out: EnzymeSet[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const { id, name, enzymes, createdAt } = r as Record<string, unknown>
    if (typeof id !== 'string' || typeof name !== 'string' || !Array.isArray(enzymes)) continue
    out.push({
      id,
      name,
      enzymes: enzymes.filter((e): e is string => typeof e === 'string'),
      createdAt: typeof createdAt === 'number' ? createdAt : 0,
    })
  }
  return out
}
