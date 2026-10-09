/**
 * Running a design (./design) through the engines.
 *
 * Nothing here is stored: a design is always re-run, so products reflect the
 * engines as they are now rather than as they were when the design was saved.
 *
 * Every method reports the same thing, a list of `Assembly`, best first,
 * so the workspace shows a product the same way whichever reaction made it.
 */

import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { getEnzyme, type RestrictionEnzyme } from '../enzymes/db'
import type { Assembly } from './product'
import { canonical, rotateAssembly } from './product'
import { assemble } from './assemble'
import { digest } from './cut'
import type { Fragment } from './fragment'
import { homologyAssemble, type HomologyPart } from './homology'
import { gatewayClone } from './gateway'
import { topoClone } from './topo'
import { junctionOverhangs, setFidelity } from './fidelity'
import {
  partBases,
  partLength,
  partEnzymes,
  partTopology,
  vectorsFirst,
  type CloningDesign,
  type DesignPart,
} from './design'

export interface RunResult {
  products: Assembly[]
  /** Anything wrong with the design as a whole. */
  warnings: string[]
  /** What stopped it producing anything, in plain words. */
  problems: string[]
  /** Fragments a digest produced, for the parts list to show. */
  fragments: Fragment[]
  /** Golden Gate: how well the overhangs in play tell themselves apart. */
  fidelity?: { score: number; notes: string[] }
}

const empty = (problems: string[]): RunResult =>
  ({ products: [], warnings: [], problems, fragments: [] })

/** A part as a document, which is what the older engines take. */
function partDoc(part: DesignPart): DocumentState {
  return {
    name: part.name,
    sequence: new Sequence(partBases(part), partTopology(part)),
    annotations: part.annotations.map(a => new Annotation(a)),
    metadata: {
      ...(part.damMethylated ? { damMethylated: true } : {}),
      ...(part.dcmMethylated ? { dcmMethylated: true } : {}),
    },
  }
}

function toHomologyPart(part: DesignPart): HomologyPart {
  return {
    id: part.id,
    name: part.name,
    bases: partBases(part),
    topology: partTopology(part),
    annotations: part.annotations,
    allowFlip: part.orientation === 'auto',
  }
}

/**
 * Which fragment of a digest a part contributes.
 *
 * The user can say, by `keep` (clicking a piece on the part's map). Otherwise
 * it follows from what the part is for. A vector gives its longest piece: cut
 * twice, that is the backbone, and the short piece is what the insert
 * replaces. An insert taken out of a plasmid gives its shortest: the long
 * piece is the donor's own backbone, which is what gets thrown away. A linear
 * insert (a PCR product cut near both ends) gives its longest, the middle,
 * since the ends are only the few bases outside the sites.
 */
export function chosenFragment(part: DesignPart, fragments: Fragment[]): Fragment | null {
  const cut = fragments.filter(f => f.topology === 'linear')
  if (cut.length === 0) return null
  if (part.keep) {
    const hit = cut.find(f => f.source.start === part.keep!.start && f.source.end === part.keep!.end)
    if (hit) return hit
  }
  const shortest = part.role === 'insert' && partTopology(part) === 'circular'
  return cut.reduce((a, b) => (shortest ? b.top.length < a.top.length : b.top.length > a.top.length) ? b : a)
}

function enzymesOf(names: readonly string[]): RestrictionEnzyme[] {
  return names.map(n => getEnzyme(n)).filter((e): e is RestrictionEnzyme => !!e)
}

/** Restriction digest and ligation, and Golden Gate, which differ only a little. */
function runCut(design: CloningDesign, typeIIS: boolean): RunResult {
  const parts = vectorsFirst(design.parts)
  // Golden Gate is one pot, so one enzyme cuts everything. Restriction parts
  // are cut separately, each with its own enzymes.
  const enzymesFor = (part: DesignPart) =>
    typeIIS ? enzymesOf([design.typeIIS]) : enzymesOf(partEnzymes(part, design))
  const unchosen = parts.filter(p => enzymesFor(p).length === 0)
  if (typeIIS && unchosen.length > 0) return empty(['Choose a Type IIS enzyme.'])
  if (unchosen.length === parts.length) {
    return empty(['Choose the enzymes, or click the sites to cut on each part’s map.'])
  }

  const warnings: string[] = []
  const all: Fragment[] = []
  const kept: Fragment[] = []
  // A part still waiting for its sites stops the reaction, but the others
  // are digested anyway, so their maps show the pieces they would give.
  const uncut: string[] = unchosen.map(p => `Click the sites to cut ${p.name} at on its map.`)

  for (const part of parts) {
    const enzymes = enzymesFor(part)
    if (enzymes.length === 0) continue
    const result = digest(partDoc(part), enzymes, { idPrefix: part.id })
    warnings.push(...result.warnings)
    all.push(...result.fragments)

    const keep = chosenFragment(part, result.fragments)
    if (!keep) {
      uncut.push(`${enzymes.map(e => e.name).join(' + ')} does not cut ${part.name}, so it has no ends to join.`)
      continue
    }
    kept.push(part.dephosphorylated
      ? { ...keep, left: { ...keep.left!, phosphate: false }, right: { ...keep.right!, phosphate: false } }
      : keep)
  }

  if (uncut.length > 0) {
    return { products: [], warnings, problems: uncut, fragments: all }
  }
  const enzymes = typeIIS ? enzymesOf([design.typeIIS]) : []

  // Purified, only the chosen fragments are in the tube. Otherwise everything
  // the digests produced is, which is what shows the off-target products.
  const pool = design.purify ? kept : all
  const required = new Set(
    kept.map(f => pool.indexOf(f)).filter(i => i >= 0),
  )
  const noFlip = new Set(
    pool.map((f, i) => {
      const part = parts.find(p => f.id.startsWith(`${p.id}:`))
      return part && part.orientation !== 'auto' ? i : -1
    }).filter(i => i >= 0),
  )

  const vector = parts.find(p => p.role === 'vector')
  const products = assemble(pool, {
    required,
    noFlip,
    ...(typeIIS ? { recutEnzymes: enzymes } : {}),
  }).map(product => (vector ? inVectorFrame(product, vector, pool) : product))

  const result: RunResult = { products, warnings, problems: [], fragments: all }

  if (typeIIS) {
    const ends = kept.flatMap(f => [f.left?.span, f.right?.span].filter((s): s is string => !!s))
    const score = setFidelity(junctionOverhangs(ends))
    result.fidelity = {
      score: score.fidelity,
      notes: [
        ...score.palindromic.map(s => `Overhang ${s} reads the same on both strands, so it ligates to itself.`),
        ...score.risks
          .filter(r => r.from !== r.to && r.propensity >= 0.05)
          .slice(0, 3)
          .map(r => `Overhangs ${r.from} and ${r.to} differ too little and will cross-react.`),
      ],
    }
  }

  if (products.length === 0) {
    result.problems.push(
      'No product can form: the ends left by the digest do not fit together. ' +
      'Check that each part is cut with enzymes leaving matching ends.',
    )
  }

  return result
}

/**
 * A circular product numbered the way its vector is: the vector's base 1 is
 * the product's base 1, as it is in SnapGene, so a feature upstream of the
 * insertion keeps its coordinates and the map opens in the orientation the
 * vector is always drawn in. Left as assembled when the vector's own first
 * base was cut out or the vector went in reversed, since then there is no
 * base 1 to keep.
 */
function inVectorFrame(product: Assembly, vector: DesignPart, pool: Fragment[]): Assembly {
  if (product.topology !== 'circular') return product
  const piece = product.parts.find(p => p.fragmentId.startsWith(`${vector.id}:`))
  const fragment = piece && pool.find(f => f.id === piece.fragmentId)
  if (!piece || !fragment || piece.reversed || fragment.reversed) return product
  const length = partLength(vector)
  const { start, end } = fragment.source
  // The piece holds base 0 when it runs across the origin, starts there, or
  // is the whole circle opened at one cut.
  if (!(start >= end || start === 0)) return product
  return rotateAssembly(product, piece.start + ((length - start) % length))
}

function runHomology(design: CloningDesign): RunResult {
  const parts = vectorsFirst(design.parts)
  const result = homologyAssemble(parts.map(toHomologyPart), {
    kit: design.kit,
    ...(design.minOverlap !== undefined ? { minOverlap: design.minOverlap } : {}),
    ...(design.maxOverlap !== undefined ? { maxOverlap: design.maxOverlap } : {}),
  })

  const problems: string[] = []
  if (result.products.length === 0) {
    problems.push(...result.warnings.filter(w => w.startsWith('No homology')))
  }
  return {
    products: result.products,
    warnings: result.warnings.filter(w => !problems.includes(w)),
    problems,
    fragments: [],
  }
}

/**
 * The older recombination engines still report the plainer `CloningProduct`,
 * so their output is lifted into an `Assembly` with one part per source.
 */
function liftProducts(
  design: CloningDesign,
  products: { name: string; sequence: string; topology: 'linear' | 'circular'; annotations: Annotation[] | unknown[]; size: number; isExpected: boolean; description: string }[],
  warnings: string[],
): RunResult {
  const parts = vectorsFirst(design.parts)
  const lifted: Assembly[] = products.map(p => ({
    name: p.name,
    description: p.description,
    sequence: p.sequence,
    topology: p.topology,
    size: p.size,
    annotations: p.annotations as Assembly['annotations'],
    parts: parts.map(part => ({
      fragmentId: part.id,
      name: part.name,
      sourceName: part.name,
      reversed: false,
      start: 0,
      end: 0,
    })),
    junctions: [],
    usesAll: p.isExpected,
    nicked: false,
    recut: [],
    warnings: [],
  }))
  return {
    products: lifted,
    warnings,
    problems: lifted.length === 0 ? warnings.slice(0, 3) : [],
    fragments: [],
  }
}

/** Run a design and report what it would give. */
export function runDesign(design: CloningDesign): RunResult {
  const parts = design.parts
  if (parts.length === 0) return empty(['Add the sequences to be cloned.'])
  if (parts.some(p => partLength(p) === 0)) return empty(['One of the parts is empty.'])

  switch (design.method) {
    case 'restriction':
      return runCut(design, false)
    case 'golden-gate':
      return runCut(design, true)
    case 'homology':
      return runHomology(design)
    case 'gateway': {
      if (parts.length < 2) return empty(['Gateway needs an entry clone and a destination vector.'])
      const result = gatewayClone({
        reaction: design.gateway,
        sources: vectorsFirst(parts).map(p => ({ doc: partDoc(p) })),
      })
      return liftProducts(design, result.products.map(p => ({ ...p, annotations: p.annotations })), result.warnings)
    }
    case 'topo': {
      const vector = parts.find(p => p.role === 'vector')
      const insert = parts.find(p => p.role === 'insert')
      if (!vector || !insert) return empty(['TOPO needs a vector and a PCR product to go into it.'])
      const result = topoClone({
        variant: design.topo,
        insert: { doc: partDoc(insert) },
        vector: { doc: partDoc(vector) },
      })
      return liftProducts(design, result.products.map(p => ({ ...p, annotations: p.annotations })), result.warnings)
    }
  }
}

/** The key a product is remembered by, so a choice survives a re-run. */
export function productKey(product: Assembly): string {
  return `${product.topology}:${canonical(product.sequence, product.topology === 'circular')}`
}

/** The product the design settled on, or the best one going. */
export function selectedProduct(design: CloningDesign, products: Assembly[]): Assembly | null {
  if (products.length === 0) return null
  if (design.selected) {
    const hit = products.find(p => productKey(p) === design.selected)
    if (hit) return hit
  }
  return products[0]
}

/** A product as a document, ready to open as a sequence. */
export function productDocument(
  design: CloningDesign,
  product: Assembly,
  name?: string,
): DocumentState {
  const lines = [
    `Cloning: ${product.description}`,
    `Parts: ${design.parts.map(p => `${p.name} (${partLength(p).toLocaleString()} bp)`).join('; ')}`,
  ]
  if (product.warnings.length > 0) lines.push(...product.warnings)

  const vector = design.parts.find(p => p.role === 'vector')
  return {
    name: name ?? product.name,
    description: lines.join('\n'),
    sequence: new Sequence(product.sequence, product.topology),
    annotations: product.annotations.map(a => new Annotation(a)),
    metadata: {
      // Methylation is host-dependent, and the product is grown in the same
      // strain as its backbone, so it inherits the backbone's status.
      ...(vector?.damMethylated ? { damMethylated: true } : {}),
      ...(vector?.dcmMethylated ? { dcmMethylated: true } : {}),
      origin: 'cloning',
    },
  }
}
