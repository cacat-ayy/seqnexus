/**
 * What a run of a design means to the person designing it.
 *
 * The engines report products; this says which one is the construct, what
 * each of the others is in plain words ("pUC19 closed on itself" rather than
 * a second "pUC19::pUC19"), and, when the construct does not form, what
 * single change to the design would make it form. Every fix offered has been
 * tried: the design is re-run with it, and only changes that give the
 * construct are suggested.
 */

import { ENZYME_GROUPS, getEnzyme } from '../enzymes/db'
import { cuttingSites, findCutSites } from '../enzymes/finder'
import type { Assembly } from './product'
import { chosenFragment, runDesign, type RunResult } from './run'
import type { Fragment } from './fragment'
import {
  isDuplex,
  partBases,
  partTopology,
  vectorsFirst,
  type CloningDesign,
  type DesignPart,
} from './design'

/** Every part, once each, closed into a circle that the enzymes leave alone. */
export function isIntended(product: Assembly): boolean {
  return product.usesAll && product.topology === 'circular' && product.recut.length === 0
}

/**
 * The design part a product's piece came from. Seamless assembly keeps the
 * part's own id; a digest names its fragments `partId:index`.
 */
export function designPartFor(fragmentId: string, parts: readonly DesignPart[]): DesignPart | undefined {
  return parts.find(p => fragmentId === p.id || fragmentId.startsWith(`${p.id}:`))
}

/** The fragment of its digest a part goes into the reaction as. */
export function keptFragment(part: DesignPart, fragments: readonly Fragment[]): Fragment | null {
  return chosenFragment(part, fragments.filter(f => f.id.startsWith(`${part.id}:`)))
}

/**
 * With one part there is nothing to join it to yet. That is where every design
 * starts, not a problem, so it is said once as guidance on the map: the part
 * still missing ("an insert"), or null when the design is past that point.
 */
export function missingPart(design: CloningDesign): string | null {
  if (design.parts.length !== 1 || design.method === 'gateway' || design.method === 'topo') return null
  return design.parts[0].role === 'vector' ? 'an insert' : 'the vector'
}

/** What a product is, in the words someone would use at the bench. */
export function productLabel(product: Assembly, design: CloningDesign): string {
  if (isIntended(product)) return 'The construct'

  const pieces = product.parts.map(p => ({ piece: p, part: designPartFor(p.fragmentId, design.parts) }))
  const names = [...new Set(pieces.map(({ piece, part }) => part?.name ?? piece.sourceName))]
  const counts = new Map<string, number>()
  for (const { part } of pieces) if (part) counts.set(part.id, (counts.get(part.id) ?? 0) + 1)
  const repeated = design.parts.find(p => (counts.get(p.id) ?? 0) > 1)
  const allVector = pieces.length > 0 && pieces.every(({ part }) => part?.role === 'vector')
  const allInsert = pieces.length > 0 && pieces.every(({ part }) => part?.role === 'insert')

  if (product.topology === 'linear') {
    const base = names.length === 1 ? `${names[0]}, linear` : `Linear ${names.join(' + ')}`
    const flippedInsert = pieces.find(({ piece, part }) => piece.reversed && part?.role !== 'vector')
    return flippedInsert ? `${base}, ${flippedInsert.part?.name ?? flippedInsert.piece.sourceName} flipped` : base
  }
  if (allVector) {
    return pieces.length === 1 ? `${names[0]} closed on itself` : `${names[0]} put back together`
  }
  if (allInsert && names.length === 1) return `${names[0]} on its own, in a circle`
  if (repeated) return `Two copies of ${repeated.name}`
  if (product.recut.length > 0) return `Cut again by ${product.recut.join(', ')}`
  const flipped = pieces.find(({ piece, part }) => piece.reversed && part?.role === 'insert')
  if (flipped) return `${flipped.part!.name} in backwards`
  if (!product.usesAll) {
    const missing = design.parts.filter(p => !counts.has(p.id)).map(p => p.name)
    if (missing.length > 0) return `Without ${missing.join(' or ')}`
  }
  return names.join(' + ')
}

/**
 * Why none of the products is the construct, when some products do form. The
 * nearest miss is named: a circle the enzyme opens again, a line whose two
 * free ends do not fit, or a part whose ends join nothing else in the tube.
 */
export function whyNoConstruct(products: readonly Assembly[], design: CloningDesign): string[] {
  const recut = products.find(p => p.usesAll && p.topology === 'circular' && p.recut.length > 0)
  if (recut) {
    const sites = recut.recut.join(' and ')
    return [
      `Every part joins into a circle, but it still has a ${sites} site, so the enzyme in the pot opens it ` +
      'again. Take the site out of the part that carries it.',
    ]
  }
  if (products.some(p => p.usesAll && p.topology === 'linear')) {
    return ['Every part joins in a line, but the two ends left over do not fit each other, so it never closes.']
  }
  if (design.method !== 'gateway' && design.method !== 'topo') {
    // A part found in no product beside another part: its ends are the
    // problem. Joining a copy of itself does not count.
    const joined = new Set<string>()
    for (const p of products) {
      const ids = new Set(p.parts.map(piece => designPartFor(piece.fragmentId, design.parts)?.id))
      ids.delete(undefined)
      if (ids.size > 1) for (const id of ids) joined.add(id!)
    }
    const alone = design.parts.filter(p => !joined.has(p.id)).map(p => p.name)
    if (alone.length === design.parts.length) {
      return ['No two parts have ends that fit each other, so each only joins itself.']
    }
    if (alone.length > 0) return [`The ends of ${alone.join(' and ')} join no other part.`]
  }
  return ['None of these has every part once, closed into a circle.']
}

export interface DesignFix {
  label: string
  /** A change to the design that gives the construct, or a panel to open. */
  apply: ((design: CloningDesign) => CloningDesign) | 'oligos'
}

/** The enzymes people clone with, for suggesting a different digest. */
const CLONING_ENZYMES = [
  ...new Set([
    ...(ENZYME_GROUPS['Common (6-cutters)'] ?? []),
    ...(ENZYME_GROUPS['Rare (8-cutters)'] ?? []),
  ]),
].sort()

const TYPE_IIS = ENZYME_GROUPS['Golden Gate (Type IIS)'] ?? []

const withPart = (id: string, changes: Partial<DesignPart>) => (d: CloningDesign): CloningDesign =>
  ({ ...d, parts: d.parts.map(p => (p.id === id ? { ...p, ...changes } : p)) })

/** Cut every part with these, setting aside the sites picked on each map. */
const cutEverythingWith = (enzymes: string[]) => (d: CloningDesign): CloningDesign => ({
  ...d,
  enzymes,
  parts: d.parts.map(p => {
    const rest = { ...p }
    delete rest.enzymes
    delete rest.keep
    return rest
  }),
})

const formatBp = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} kb` : `${n} bp`)

/**
 * Enzymes that open the vector once and cut every other part: the ones worth
 * trying when the chosen digest leaves nothing that fits.
 */
function usefulEnzymes(design: CloningDesign): string[] {
  // An annealed pair is not cut, so an enzyme is no less useful for leaving
  // it alone; requiring a cut in it would rule out every enzyme there is.
  const parts = vectorsFirst(design.parts.filter(p => !isDuplex(p)))
  return CLONING_ENZYMES.filter(name => {
    const enzyme = getEnzyme(name)
    if (!enzyme) return false
    return parts.every((part, i) => {
      const n = cuttingSites(findCutSites(partBases(part), enzyme, partTopology(part))).length
      return i === 0 && part.role === 'vector' ? n === 1 : n > 0
    })
  })
}

/**
 * Up to `max` single changes that would make the construct form, tried in
 * order of how small a change they are. Empty when the construct already
 * forms, or when there is too little in the design to say what is meant.
 */
export function findFixes(design: CloningDesign, max = 3, result: RunResult = runDesign(design)): DesignFix[] {
  if (design.parts.length < 2) return []
  if (result.products.some(isIntended)) return []

  if (design.method === 'homology') {
    return result.products.length === 0
      ? [{ label: 'Design primers that add the overlaps', apply: 'oligos' }]
      : []
  }
  if (design.method !== 'restriction' && design.method !== 'golden-gate') return []

  const fixes: DesignFix[] = []
  const tried = new Set<string>()
  const attempt = (label: string, apply: (d: CloningDesign) => CloningDesign) => {
    if (fixes.length >= max || tried.has(label)) return
    tried.add(label)
    if (runDesign(apply(design)).products.some(isIntended)) fixes.push({ label, apply })
  }

  for (const part of design.parts) {
    if (part.orientation !== 'auto') attempt(`Let ${part.name} go in either way round`, withPart(part.id, { orientation: 'auto' }))
  }
  if (design.method === 'restriction') {
    for (const part of design.parts) {
      if (part.dephosphorylated) attempt(`Leave ${part.name} phosphorylated`, withPart(part.id, { dephosphorylated: false }))
    }
  }

  // Another fragment of the same digest: the band a part contributes.
  for (const part of design.parts) {
    const fragments = result.fragments
      .filter(f => f.id.startsWith(`${part.id}:`) && f.topology === 'linear')
      .sort((a, b) => b.top.length - a.top.length)
    if (fragments.length < 2) continue
    const chosen = chosenFragment(part, fragments)
    for (const f of fragments.slice(0, 4)) {
      if (f === chosen) continue
      attempt(`Use the ${formatBp(f.top.length)} fragment of ${part.name}`,
        withPart(part.id, { keep: { start: f.source.start, end: f.source.end } }))
    }
  }

  if (design.method === 'golden-gate') {
    for (const name of TYPE_IIS) {
      if (name !== design.typeIIS) attempt(`Use ${name} instead`, d => ({ ...d, typeIIS: name }))
    }
    return fixes
  }

  // Changing the design's enzymes only reaches parts with none of their own,
  // so these are offered while every part follows the design.
  const shared = design.parts.every(p => p.enzymes === undefined)
  if (shared && design.enzymes.length > 1) {
    for (const name of design.enzymes) {
      attempt(`Leave out ${name}`, d => ({ ...d, enzymes: d.enzymes.filter(e => e !== name) }))
    }
  }
  const useful = usefulEnzymes(design)
  if (shared) {
    for (const name of useful) {
      if (!design.enzymes.includes(name)) attempt(`Add ${name}`, d => ({ ...d, enzymes: [...d.enzymes, name] }))
    }
  }
  // Two enzymes clone directionally, so a pair is worth more than one.
  const pairs = useful.slice(0, 8)
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      attempt(`Cut with ${pairs[i]} + ${pairs[j]} instead`, cutEverythingWith([pairs[i], pairs[j]]))
    }
  }
  for (const name of useful) attempt(`Cut with ${name} instead`, cutEverythingWith([name]))
  if (design.purify) attempt('Don’t gel-purify the fragments', d => ({ ...d, purify: false }))
  return fixes
}
