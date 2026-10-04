/**
 * Seamless assembly: joining fragments on a shared stretch of sequence.
 *
 * This is one engine for every kit in ./kits, because they all work the same
 * way — chew back a strand at each end, let the single strands anneal over
 * the homology, fill in and seal — and differ only in what they ask of the
 * shared stretch.
 *
 * Two things here that a plain "does A's tail match B's head" search cannot
 * do, and that people need constantly:
 *
 * - **A circular part has no ends.** Hand it a plasmid and an insert carrying
 *   arms, and the plasmid is opened where the arms land. Arms that sit next
 *   to each other give a clean insertion; arms flanking a stretch delete it.
 *   Nobody should have to linearise a vector by hand first.
 * - **Order and orientation are found, not assumed.** Every part is tried
 *   both ways round, and the order comes out of which overlaps exist rather
 *   than the order the parts were listed in.
 */

import { reverseComplement } from '../models/complement'
import { calcTm } from '../primers/thermodynamics'
import type { AnnotationData } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { sliceAnnotations, formatSize } from './cut'
import { withoutSegments } from './fragment'
import type { Assembly, AssemblyPart, Junction, Overlap } from './product'
import { assemblyName, canonical, rankAssemblies } from './product'
import { KITS, targetOverlap, type Kit, type KitId } from './kits'

export interface HomologyPart {
  /** Stable id, used to name junctions. */
  id: string
  name: string
  bases: string
  topology: 'linear' | 'circular'
  annotations: AnnotationData[]
  /** Try this part the other way round as well. Default true. */
  allowFlip?: boolean
}

export interface HomologyOptions {
  kit?: KitId
  /** Overrides the kit's shortest acceptable overlap. */
  minOverlap?: number
  /** Overrides the kit's longest searched overlap. */
  maxOverlap?: number
  /** Overrides how many mismatches the overlap may contain. */
  mismatches?: number
  /** Indices of the parts the design calls for. Defaults to all of them. */
  required?: ReadonlySet<number>
  maxProducts?: number
}

export interface HomologyResult {
  products: Assembly[]
  /** Everything found between pairs of parts, whether or not it was used. */
  overlaps: JunctionFind[]
  warnings: string[]
  kit: Kit
}

/** A shared stretch found between two oriented parts. */
export interface JunctionFind {
  left: number
  leftReversed: boolean
  right: number
  rightReversed: boolean
  /** Where the overlap ends on the left part. */
  leftEnd: number
  /** Where the overlap starts on the right part. */
  rightStart: number
  overlap: Overlap
  /** More than one place on a circular part the arm could land. */
  ambiguous: boolean
}

/** A part in one orientation, with its sequence and features in that frame. */
interface Oriented {
  input: number
  id: string
  name: string
  seq: string
  circular: boolean
  reversed: boolean
  annotations: AnnotationData[]
}

const SEED = 12
const NODE_BUDGET = 100_000

/** Build a part from an open document, optionally from one region of it. */
export function partFromDocument(
  doc: DocumentState,
  options: { id?: string; region?: { start: number; end: number }; allowFlip?: boolean } = {},
): HomologyPart {
  const id = options.id ?? doc.name.replace(/\W+/g, '').slice(0, 12).toLowerCase()
  const annotations = doc.annotations.map(a => withoutSegments(a.toData()))
  if (!options.region) {
    return {
      id,
      name: doc.name,
      bases: doc.sequence.bases,
      topology: doc.sequence.topology,
      annotations,
      ...(options.allowFlip === undefined ? {} : { allowFlip: options.allowFlip }),
    }
  }
  // A piece of a sequence is a linear piece, whatever the sequence was.
  const { start, end } = options.region
  const circular = doc.sequence.topology === 'circular'
  const bases = end > start
    ? doc.sequence.bases.slice(start, end)
    : doc.sequence.bases.slice(start) + doc.sequence.bases.slice(0, end)
  return {
    id,
    name: `${doc.name} ${start + 1}–${end}`,
    bases,
    topology: 'linear',
    annotations: sliceAnnotations(annotations, start, end, doc.sequence.bases.length, circular),
    ...(options.allowFlip === undefined ? {} : { allowFlip: options.allowFlip }),
  }
}

/** Features of a sequence, as they read on the other strand. */
function reverseAnnotations(annotations: AnnotationData[], length: number): AnnotationData[] {
  return annotations.map(ann => ({
    ...withoutSegments(ann),
    start: length - ann.end,
    end: length - ann.start,
    strand: ann.strand === 1 ? -1 : ann.strand === -1 ? 1 : ann.strand,
  }))
}

function countMismatches(a: string, b: string): number {
  let n = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i].toUpperCase()
    const y = b[i].toUpperCase()
    // An ambiguous base is counted as a mismatch: it might not pair.
    if (x !== y || !'ACGT'.includes(x)) n++
  }
  return n
}

function gcFraction(seq: string): number {
  let gc = 0
  for (const base of seq.toUpperCase()) if (base === 'G' || base === 'C') gc++
  return seq.length === 0 ? 0 : gc / seq.length
}

function describeOverlap(sequence: string, mismatches: number): Overlap {
  return { length: sequence.length, sequence, tm: calcTm(sequence), mismatches }
}

/** Every position in `haystack` where `needle` sits with few enough mismatches. */
function findWithMismatches(haystack: string, needle: string, allowed: number): number[] {
  const hits: number[] = []
  if (needle.length === 0 || needle.length > haystack.length) return hits
  if (allowed === 0) {
    let from = 0
    for (;;) {
      const at = haystack.indexOf(needle, from)
      if (at === -1) break
      hits.push(at)
      from = at + 1
    }
    return hits
  }
  // Anchor on an exact seed so the scan stays cheap, then check the rest.
  // The seed is the 3'-most part of the arm, which is where annealing starts.
  const seedLength = Math.min(SEED, needle.length)
  const seed = needle.slice(needle.length - seedLength)
  const offset = needle.length - seedLength
  let from = 0
  for (;;) {
    const at = haystack.indexOf(seed, from)
    if (at === -1) break
    const start = at - offset
    if (start >= 0 && start + needle.length <= haystack.length) {
      if (countMismatches(haystack.slice(start, start + needle.length), needle) <= allowed) {
        if (!hits.includes(start)) hits.push(start)
      }
    }
    from = at + 1
  }
  return hits.sort((a, b) => a - b)
}

/**
 * The shared stretch between the end of `left` and the start of `right`.
 *
 * A linear part's ends are fixed, so the overlap must sit at them. A circular
 * part has no ends, so the arm is searched for anywhere on it and the part
 * will be opened wherever it lands. Two circular parts have no fixed end
 * between them at all, so they are left alone.
 *
 * A clean match always beats a longer one with a mismatch in it, and only
 * then does the longest win. Preferring length first would make the result
 * depend on which way round the pair was searched: where the strands disagree
 * the product takes one part's bases over the other's, and the two searches
 * pick different parts, so the same reaction would yield two products that
 * differ by a base. Mismatch tolerance is for arms that really do disagree —
 * a silent mutation left in a primer — not for extending a good overlap.
 */
export function findHomology(
  left: { seq: string; circular: boolean },
  right: { seq: string; circular: boolean },
  minOverlap: number,
  maxOverlap: number,
  mismatches = 0,
): { leftEnd: number; rightStart: number; overlap: Overlap; ambiguous: boolean }[] {
  if (left.circular && right.circular) return []
  for (let allowed = 0; allowed <= mismatches; allowed++) {
    const hits = search(left, right, minOverlap, maxOverlap, allowed)
    if (hits.length > 0) return hits
  }
  return []
}

function search(
  left: { seq: string; circular: boolean },
  right: { seq: string; circular: boolean },
  minOverlap: number,
  maxOverlap: number,
  mismatches: number,
): { leftEnd: number; rightStart: number; overlap: Overlap; ambiguous: boolean }[] {
  const limit = Math.min(maxOverlap, left.seq.length, right.seq.length)

  for (let length = limit; length >= minOverlap; length--) {
    if (!left.circular && !right.circular) {
      const tail = left.seq.slice(left.seq.length - length)
      const head = right.seq.slice(0, length)
      const mm = countMismatches(tail, head)
      if (mm <= mismatches) {
        return [{
          leftEnd: left.seq.length,
          rightStart: 0,
          overlap: describeOverlap(head, mm),
          ambiguous: false,
        }]
      }
      continue
    }

    if (right.circular) {
      // The arm is the linear part's tail; find where it lands on the circle.
      const arm = left.seq.slice(left.seq.length - length)
      const doubled = right.seq + right.seq.slice(0, Math.min(length - 1, right.seq.length))
      const hits = findWithMismatches(doubled, arm, mismatches)
        .filter(at => at < right.seq.length)
      if (hits.length > 0) {
        return hits.map(at => ({
          leftEnd: left.seq.length,
          rightStart: at,
          overlap: describeOverlap(arm, countMismatches(readAround(right.seq, at, length), arm)),
          ambiguous: hits.length > 1,
        }))
      }
      continue
    }

    // The arm is the linear part's head; find where it lands on the circle.
    const arm = right.seq.slice(0, length)
    const doubled = left.seq + left.seq.slice(0, Math.min(length - 1, left.seq.length))
    const hits = findWithMismatches(doubled, arm, mismatches).filter(at => at < left.seq.length)
    if (hits.length > 0) {
      return hits.map(at => ({
        leftEnd: (at + length) % left.seq.length,
        rightStart: 0,
        overlap: describeOverlap(arm, countMismatches(readAround(left.seq, at, length), arm)),
        ambiguous: hits.length > 1,
      }))
    }
  }

  return []
}

export function homologyAssemble(
  parts: HomologyPart[],
  options: HomologyOptions = {},
): HomologyResult {
  const kit = KITS[options.kit ?? 'hifi']
  const minOverlap = options.minOverlap ?? kit.minOverlap
  const maxOverlap = options.maxOverlap ?? kit.maxOverlap
  const mismatches = options.mismatches ?? kit.mismatchTolerance
  const maxProducts = options.maxProducts ?? 50
  const required = options.required ?? new Set(parts.map((_, i) => i))
  const warnings: string[] = []

  if (parts.length === 0) return { products: [], overlaps: [], warnings: ['No parts to assemble'], kit }

  // The longest part is never flipped. Any assembly that needs it the other
  // way round is the same molecule read on the other strand, so nothing is
  // lost — and it means the product comes out in the backbone's frame rather
  // than on whichever strand the search happened to reach first.
  const anchor = parts.reduce(
    (best, part, i) => (part.bases.length > parts[best].bases.length ? i : best),
    0,
  )

  // Both orientations of every part, in the frame each one reads in.
  const oriented: Oriented[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const circular = part.topology === 'circular'
    oriented.push({
      input: i,
      id: part.id,
      name: part.name,
      seq: part.bases,
      circular,
      reversed: false,
      annotations: part.annotations,
    })
    const flipped = reverseComplement(part.bases)
    if (i !== anchor && (part.allowFlip ?? true) && flipped !== part.bases) {
      oriented.push({
        input: i,
        id: part.id,
        name: part.name,
        seq: flipped,
        circular,
        reversed: true,
        annotations: reverseAnnotations(part.annotations, part.bases.length),
      })
    }
  }

  // Every overlap between every ordered pair of orientations.
  const finds: JunctionFind[] = []
  const edges: JunctionFind[][] = oriented.map(() => [])
  for (let a = 0; a < oriented.length; a++) {
    for (let b = 0; b < oriented.length; b++) {
      if (oriented[a].input === oriented[b].input) continue
      for (const hit of findHomology(oriented[a], oriented[b], minOverlap, maxOverlap, mismatches)) {
        const find: JunctionFind = {
          left: a,
          leftReversed: oriented[a].reversed,
          right: b,
          rightReversed: oriented[b].reversed,
          leftEnd: hit.leftEnd,
          rightStart: hit.rightStart,
          overlap: hit.overlap,
          ambiguous: hit.ambiguous,
        }
        finds.push(find)
        edges[a].push(find)
      }
    }
  }

  // Self-circularisation: one linear part whose own ends share homology.
  // The arms can be at most half of it, or the two would overlap each other —
  // and a sequence trivially matches itself over its whole length, which
  // would otherwise close every fragment into a product of nothing.
  for (let a = 0; a < oriented.length; a++) {
    if (oriented[a].circular) continue
    const selfMax = Math.min(maxOverlap, Math.floor(oriented[a].seq.length / 2))
    if (selfMax < minOverlap) continue
    const [hit] = findHomology(oriented[a], oriented[a], minOverlap, selfMax, mismatches)
    if (hit) {
      const find: JunctionFind = {
        left: a, leftReversed: oriented[a].reversed,
        right: a, rightReversed: oriented[a].reversed,
        leftEnd: hit.leftEnd, rightStart: hit.rightStart,
        overlap: hit.overlap, ambiguous: false,
      }
      finds.push(find)
      edges[a].push(find)
    }
  }

  if (finds.length === 0) {
    warnings.push(
      `No homology of at least ${minOverlap} bp between any two parts: nothing can assemble. ` +
      'Check that the fragments carry matching arms, and that the arms are long enough.',
    )
    return { products: [], overlaps: [], warnings, kit }
  }

  for (const find of finds) {
    if (find.ambiguous) {
      warnings.push(
        `The ${find.overlap.length} bp arm shared by ${oriented[find.left].name} and ` +
        `${oriented[find.right].name} matches more than one place: the assembly is ambiguous.`,
      )
    }
  }
  warnings.push(...misassemblyWarnings(oriented, minOverlap, maxOverlap))

  const products: Assembly[] = []
  const seen = new Set<string>()
  const path: { node: number; out?: JunctionFind }[] = []
  const usedInputs = new Set<number>()
  let nodes = 0

  const emit = (closing?: JunctionFind) => {
    const assembly = buildAssembly(path, closing, oriented, required, kit, parts.length)
    if (!assembly) return
    const key = `${assembly.topology}:${canonical(assembly.sequence, assembly.topology === 'circular')}`
    if (seen.has(key)) return
    seen.add(key)
    products.push(assembly)
  }

  const walk = () => {
    if (products.length >= maxProducts || nodes++ > NODE_BUDGET) return
    const last = path[path.length - 1].node

    for (const find of edges[last]) {
      // Closing the circle.
      if (find.right === path[0].node) {
        path[path.length - 1].out = find
        emit(find)
        delete path[path.length - 1].out
        continue
      }
      if (usedInputs.has(oriented[find.right].input)) continue
      path[path.length - 1].out = find
      usedInputs.add(oriented[find.right].input)
      path.push({ node: find.right })
      walk()
      path.pop()
      usedInputs.delete(oriented[find.right].input)
      delete path[path.length - 1].out
      if (products.length >= maxProducts) return
    }

    // A linear product, only where the chain cannot grow at either end: a
    // circular part has no end to finish on, so it cannot be a terminus.
    const canExtend = edges[last].some(f => !usedInputs.has(oriented[f.right].input))
    const canPrepend = finds.some(f => f.right === path[0].node && !usedInputs.has(oriented[f.left].input))
    if (!canExtend && !canPrepend && path.length >= 2) {
      if (!oriented[path[0].node].circular && !oriented[last].circular) emit(undefined)
    }
  }

  // Start from the longest part first, so a kept product reads from the
  // backbone rather than from whichever insert the search reached first.
  const startOrder = oriented
    .map((_, index) => index)
    .sort((a, b) => oriented[b].seq.length - oriented[a].seq.length)

  for (const a of startOrder) {
    if (products.length >= maxProducts) break
    usedInputs.clear()
    usedInputs.add(oriented[a].input)
    path.length = 0
    path.push({ node: a })
    walk()
  }

  return { products: products.sort(rankAssemblies), overlaps: finds, warnings, kit }
}

/**
 * Turn a chain of parts into a product.
 *
 * Each part contributes the stretch from where its incoming overlap starts to
 * where its outgoing overlap begins, so every shared stretch is written once.
 * For a circular part that stretch runs forward around the circle, which is
 * what opens a plasmid at the arms and drops anything between them.
 */
function buildAssembly(
  path: readonly { node: number; out?: JunctionFind }[],
  closing: JunctionFind | undefined,
  oriented: readonly Oriented[],
  required: ReadonlySet<number>,
  kit: Kit,
  partCount: number,
): Assembly | null {
  const circular = closing !== undefined
  const incoming: (JunctionFind | undefined)[] = path.map((_, i) =>
    i === 0 ? closing : path[i - 1].out,
  )

  let sequence = ''
  const annotations: AnnotationData[] = []
  const partInfos: AssemblyPart[] = []
  const junctions: Junction[] = []
  const warnings: string[] = []

  for (let i = 0; i < path.length; i++) {
    const part = oriented[path[i].node]
    const inJunction = incoming[i]
    const outJunction = i === path.length - 1 ? closing : path[i].out
    const length = part.seq.length

    const start = inJunction ? inJunction.rightStart : 0
    const stop = outJunction
      ? (outJunction.leftEnd - outJunction.overlap.length + length) % length
      : length

    let span: number
    if (part.circular) {
      span = ((stop - start) % length + length) % length
      if (span === 0) return null // arms land in the same place: nothing to build
    } else {
      span = stop - start
      if (span < 0) return null // the two overlaps run into each other
    }

    const offset = sequence.length
    const bases = span === length && !part.circular
      ? part.seq
      : readAround(part.seq, start, span)
    sequence += bases

    // Features are read from a window widened by the outgoing overlap, so a
    // feature running into the next part stays whole. Those bases are shared
    // by both parts and read the same on either, so nothing is invented: a
    // promoter or a CDS ending at an arm keeps its real extent instead of
    // being clipped at a junction drawn an arbitrary few bases to one side.
    const outLength = outJunction ? outJunction.overlap.length : 0
    // Capped at one full turn: a part contributing nearly all of a circle
    // would otherwise ask for more than the whole of it, and the window would
    // come back round as a couple of bases and drop every feature on it.
    const windowLength = Math.min(span + outLength, length)
    const windowEnd = (start + windowLength) % length
    annotations.push(
      ...sliceAnnotations(part.annotations, start, windowEnd, length, part.circular)
        .map(ann => ({ ...ann, id: `${ann.id}_p${i}`, start: ann.start + offset, end: ann.end + offset })),
    )
    partInfos.push({
      fragmentId: part.id,
      name: part.name,
      sourceName: part.name,
      reversed: part.reversed,
      start: offset,
      end: offset + bases.length,
    })

    if (inJunction) {
      junctions.push({
        leftPart: i === 0 ? path.length - 1 : i - 1,
        rightPart: i,
        at: offset,
        overlap: inJunction.overlap,
      })
    }
  }

  // A feature carried past the last part's contribution runs off the end: on
  // a circle it wraps round the origin, on a linear product it is clipped.
  const size = sequence.length
  const placed: AnnotationData[] = []
  for (const ann of annotations) {
    if (ann.end <= size) {
      placed.push(ann)
    } else if (circular && ann.end - size < ann.start && ann.end - size < size) {
      placed.push({ ...ann, end: ann.end - size })
    } else {
      placed.push({ ...ann, end: size, truncated: true })
    }
  }

  for (const junction of junctions) {
    const overlap = junction.overlap!
    if (kit.minTm !== null && overlap.tm < kit.minTm) {
      warnings.push(
        `An overlap melts at ${overlap.tm.toFixed(1)} °C, below the ${kit.minTm} °C ${kit.name} needs. Lengthen it.`,
      )
    }
    if (overlap.mismatches > 0) {
      warnings.push(`An overlap carries ${overlap.mismatches} mismatch${overlap.mismatches > 1 ? 'es' : ''}.`)
    }
    if (overlap.length < kit.minOverlap) {
      warnings.push(
        `A ${overlap.length} bp overlap is below the ${kit.minOverlap} bp ${kit.name} requires: ` +
        'the single strands may not hold long enough to be filled in.',
      )
    }
    if (overlap.length > kit.warnAbove) {
      warnings.push(
        `A ${overlap.length} bp overlap is longer than ${kit.name} needs ` +
        `(${kit.minOverlap}–${kit.warnAbove} bp): check it is deliberate.`,
      )
    }
    const gc = gcFraction(overlap.sequence)
    if (gc < 0.3 || gc > 0.7) {
      warnings.push(`An overlap is ${(gc * 100).toFixed(0)}% GC, outside the 30–70% that anneals predictably.`)
    }
  }

  if (sequence.length === 0) return null

  const usedInputs = path.map(p => oriented[p.node].input)
  const usesAll =
    usedInputs.length === required.size &&
    new Set(usedInputs).size === usedInputs.length &&
    usedInputs.every(i => required.has(i))

  const target = targetOverlap(kit, partCount)
  if (circular && usesAll) {
    for (const junction of junctions) {
      if (junction.overlap!.length < target) {
        warnings.push(
          `An overlap is ${junction.overlap!.length} bp; ${kit.name} works best with about ${target} bp here.`,
        )
        break
      }
    }
  }

  return {
    name: assemblyName(partInfos.map(p => ({ sourceName: p.sourceName, length: p.end - p.start })), circular),
    description:
      `${circular ? 'Circular' : 'Linear'} ${kit.name} assembly of ` +
      `${partInfos.map(p => `${p.sourceName} ${formatSize(p.end - p.start)}${p.reversed ? ' (flipped)' : ''}`).join(' + ')}.`,
    sequence,
    topology: circular ? 'circular' : 'linear',
    size: sequence.length,
    annotations: placed,
    parts: partInfos,
    junctions,
    usesAll,
    nicked: false,
    recut: [],
    warnings: [...new Set(warnings)],
  }
}

/** `count` bases from `start`, wrapping the end of the sequence. */
function readAround(seq: string, start: number, count: number): string {
  if (start + count <= seq.length) return seq.slice(start, start + count)
  return seq.slice(start) + seq.slice(0, start + count - seq.length)
}

/**
 * Homology between parts that are not meant to meet. Those arms anneal too,
 * and the assembly that comes out is not the one that was drawn.
 */
function misassemblyWarnings(
  oriented: readonly Oriented[],
  minOverlap: number,
  maxOverlap: number,
): string[] {
  const warnings: string[] = []
  const seen = new Set<string>()
  for (let a = 0; a < oriented.length; a++) {
    for (let b = a + 1; b < oriented.length; b++) {
      if (oriented[a].input === oriented[b].input) continue
      const left = oriented[a]
      const right = oriented[b]
      if (left.circular || right.circular) continue
      // An arm shared somewhere other than the ends that meet.
      const inner = sharedInternal(left.seq, right.seq, Math.max(minOverlap, 20), maxOverlap)
      if (inner) {
        const key = [left.input, right.input].sort().join('-')
        if (seen.has(key)) continue
        seen.add(key)
        warnings.push(
          `${left.name} and ${right.name} share ${inner} bp away from the ends that join: ` +
          'the parts may assemble in the wrong order.',
        )
      }
    }
  }
  return warnings
}

/** Length of a repeat the two sequences share other than at the joining ends. */
function sharedInternal(a: string, b: string, minLength: number, maxLength: number): number | null {
  const limit = Math.min(maxLength, a.length, b.length)
  for (let length = limit; length >= minLength; length--) {
    for (let i = 0; i + length <= a.length; i++) {
      // Skip the stretch at a's tail, which is where a legitimate join sits.
      if (i + length === a.length) continue
      const at = b.indexOf(a.slice(i, i + length))
      if (at > 0) return length
    }
  }
  return null
}
