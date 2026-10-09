/**
 * Joining fragments: which products a set of ends can actually give.
 *
 * Fragments are tried in both orientations, since an insert with two
 * compatible ends goes in either way round and the wrong way round is a real
 * product people get. A path of fragments whose touching ends anneal is a
 * product: circular when the last end meets the first, linear otherwise.
 *
 * Because a fragment's top strand already carries the bases it contributes at
 * each junction (see ./fragment), the product's sequence is the parts'
 * top strands concatenated, with nothing to add or trim.
 */

import type { RestrictionEnzyme } from '../enzymes/db'
import type { AnnotationData } from '../models/Annotation'
import { endsAnneal, endLabel, sealedNicks } from './ends'
import type { Fragment } from './fragment'
import { flip, offsetAnnotations } from './fragment'
import { formatSize } from './cut'
import type { Assembly, AssemblyPart, Junction } from './product'
import { assemblyName, canonical, rankAssemblies, remainingSites } from './product'

export type { Assembly, AssemblyPart, Junction } from './product'
export { canonical } from './product'

export interface AssembleOptions {
  /** Try each fragment in both orientations. Default true. */
  allowFlip?: boolean
  /**
   * Fragments to keep the way round they were given, even when flipping is
   * on: a part the user has pinned to one orientation.
   */
  noFlip?: ReadonlySet<number>
  /** Let a single fragment close on itself. Default true. */
  allowSelfLigation?: boolean
  /** Indices of fragments whose 5' phosphates have been removed. */
  dephosphorylated?: ReadonlySet<number>
  /**
   * Enzymes whose sites are checked against each circular product.
   *
   * Only for a one-pot reaction, where enzyme and ligase work at the same
   * time: there a product that keeps a site is cut open again, which is what
   * makes Type IIS assembly specific. Ordinary restriction cloning rebuilds
   * its sites at every junction and is none the worse for it, because the
   * enzyme is gone by then, so do not pass them for that.
   */
  recutEnzymes?: RestrictionEnzyme[]
  /**
   * Indices of the fragments the design calls for. A product containing all
   * of them, once each, and nothing else is the one that was wanted. Defaults
   * to every fragment given.
   */
  required?: ReadonlySet<number>
  /** Hard cap on products returned. Default 200. */
  maxProducts?: number
  /** How many times one fragment may appear in a product. Default 1. */
  copies?: number
}

/** One fragment in one orientation. */
interface Oriented {
  /** Index of the input fragment this came from. */
  input: number
  fragment: Fragment
}

const NODE_BUDGET = 200_000

export function assemble(fragments: Fragment[], options: AssembleOptions = {}): Assembly[] {
  const {
    allowFlip = true,
    allowSelfLigation = true,
    dephosphorylated,
    recutEnzymes = [],
    maxProducts = 200,
    copies = 1,
  } = options
  const required = options.required ?? new Set(fragments.map((_, i) => i))

  const linear = fragments
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.topology === 'linear' && f.left && f.right)
  if (linear.length === 0) return []

  // Orientations to try. A fragment is only flipped when that gives a
  // different molecule, so a palindromic one is not tried twice.
  const oriented: Oriented[] = []
  for (const { f, i } of linear) {
    const prepared = dephosphorylated?.has(i)
      ? { ...f, left: { ...f.left!, phosphate: false }, right: { ...f.right!, phosphate: false } }
      : f
    oriented.push({ input: i, fragment: prepared })
    if (allowFlip && !options.noFlip?.has(i)) {
      const other = flip(prepared)
      if (other.top !== prepared.top) oriented.push({ input: i, fragment: other })
    }
  }

  const joins = (a: Fragment, b: Fragment): boolean =>
    endsAnneal(a.right!, b.left!) && sealedNicks(a.right!, b.left!) > 0

  // Which oriented fragments can follow each one.
  const next: number[][] = oriented.map((o, k) =>
    oriented
      .map((_, j) => j)
      .filter(j => (oriented[j].input !== o.input || allowSelfLigation || j !== k) && joins(o.fragment, oriented[j].fragment)),
  )

  const seen = new Set<string>()
  const out: Assembly[] = []
  const usedCount = new Map<number, number>()
  const path: number[] = []
  let nodes = 0

  const canUse = (k: number): boolean => (usedCount.get(oriented[k].input) ?? 0) < copies

  const record = (circular: boolean) => {
    const assembly = build(path.map(k => oriented[k]), required, circular, recutEnzymes)
    const key = `${assembly.topology}:${canonical(assembly.sequence, circular)}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(assembly)
  }

  const canPrepend = (head: Oriented): boolean =>
    oriented.some((o, k) => canUse(k) && joins(o.fragment, head.fragment))

  const walk = () => {
    if (out.length >= maxProducts || nodes++ > NODE_BUDGET) return
    const head = oriented[path[0]]
    const tail = oriented[path[path.length - 1]]

    // Closing the circle. A lone fragment only counts when self-ligation is on.
    if ((path.length > 1 || allowSelfLigation) && joins(tail.fragment, head.fragment)) {
      record(true)
    }

    let extended = false
    for (const k of next[path[path.length - 1]]) {
      if (!canUse(k)) continue
      extended = true
      usedCount.set(oriented[k].input, (usedCount.get(oriented[k].input) ?? 0) + 1)
      path.push(k)
      walk()
      path.pop()
      usedCount.set(oriented[k].input, (usedCount.get(oriented[k].input) ?? 1) - 1)
      if (out.length >= maxProducts) return
    }

    // A linear product is only worth reporting when it cannot grow at either
    // end; otherwise every prefix of every path would be a "product".
    if (!extended && path.length >= 2 && !canPrepend(head)) record(false)
  }

  for (let k = 0; k < oriented.length; k++) {
    if (out.length >= maxProducts) break
    usedCount.clear()
    usedCount.set(oriented[k].input, 1)
    path.length = 0
    path.push(k)
    walk()
  }

  return out.sort(rankAssemblies)
}

/** Expected products first: a complete circle beats anything partial. */
function build(
  parts: Oriented[],
  required: ReadonlySet<number>,
  circular: boolean,
  recutEnzymes: RestrictionEnzyme[],
): Assembly {
  let sequence = ''
  const annotations: AnnotationData[] = []
  const partInfos: AssemblyPart[] = []
  const junctions: Junction[] = []

  parts.forEach((part, index) => {
    const f = part.fragment
    const offset = sequence.length
    if (index > 0) {
      const prev = parts[index - 1].fragment
      junctions.push({
        leftPart: index - 1,
        rightPart: index,
        at: offset,
        end: prev.right!,
        sealed: sealedNicks(prev.right!, f.left!),
        ...(prev.right!.enzyme ? { enzyme: prev.right!.enzyme } : {}),
      })
    }
    annotations.push(...offsetAnnotations(f.annotations, offset, `_p${index}`))
    partInfos.push({
      fragmentId: f.id,
      name: f.name,
      sourceName: f.source.name,
      reversed: f.reversed,
      start: offset,
      end: offset + f.top.length,
    })
    sequence += f.top
  })

  if (circular) {
    const last = parts[parts.length - 1].fragment
    const first = parts[0].fragment
    junctions.push({
      leftPart: parts.length - 1,
      rightPart: 0,
      at: 0,
      end: last.right!,
      sealed: sealedNicks(last.right!, first.left!),
      ...(last.right!.enzyme ? { enzyme: last.right!.enzyme } : {}),
    })
  }

  // Every required part present, once each, and no extras.
  const usedInputs = parts.map(p => p.input)
  const usesAll =
    usedInputs.length === required.size &&
    new Set(usedInputs).size === usedInputs.length &&
    usedInputs.every(i => required.has(i))
  const recut = circular ? remainingSites(sequence, recutEnzymes) : []

  return {
    name: assemblyName(
      parts.map(p => ({ sourceName: p.fragment.source.name, length: p.fragment.top.length })),
      circular,
    ),
    description: describe(parts, circular),
    sequence,
    topology: circular ? 'circular' : 'linear',
    size: sequence.length,
    annotations,
    parts: partInfos,
    junctions,
    ...(circular ? {} : { left: parts[0].fragment.left, right: parts[parts.length - 1].fragment.right }),
    usesAll,
    nicked: junctions.some(j => (j.sealed ?? 2) < 2),
    recut,
    warnings: [],
  }
}

function describe(parts: Oriented[], circular: boolean): string {
  const pieces = parts.map(p => {
    const f = p.fragment
    return `${f.source.name} ${formatSize(f.top.length)}${f.reversed ? ' (flipped)' : ''}`
  })
  const ends = parts.length > 1
    ? ` Junctions: ${parts.slice(1).map((_, i) => endLabel(parts[i].fragment.right!)).join(', ')}.`
    : ''
  return `${circular ? 'Circular' : 'Linear'} assembly of ${pieces.join(' + ')}.${ends}`
}

/**
 * A key that is the same for every way of writing the same molecule: any
 * rotation of a circle, and either strand of both circles and linear pieces.
 */
