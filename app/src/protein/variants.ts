/**
 * Recording edits to a protein as variants, named as HGVS names them.
 *
 * A protein in a lab is usually a variant of something: the wild type with
 * a point mutation, a truncation, an inserted tag. When residues are
 * replaced or deleted, the change is written down as a `variant` feature on
 * the residues it left behind, named in the one-letter HGVS short form the
 * literature uses (p.K27M) with the recommended three-letter form in a
 * note, so the feature list reads as the mutation list. Inserting at the
 * caret is not recorded: a protein typed in from scratch is not a variant
 * of its first residue.
 */

import type { AnnotationData } from '../models/Annotation'

const THREE: Readonly<Record<string, string>> = {
  A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile',
  L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val',
  U: 'Sec', O: 'Pyl', B: 'Asx', Z: 'Glx', J: 'Xle', X: 'Xaa', '*': 'Ter',
}

/** Three-letter spelling of a stretch, as HGVS writes inserted residues. */
export function threeLetter(residues: string): string {
  return [...residues.toUpperCase()].map(r => THREE[r] ?? 'Xaa').join('')
}

/** Feature ids of the variants the editor records, to tell them from imported ones. */
export const VARIANT_ID_PREFIX = 'var_'

/** The qualifier that marks a feature as recorded by an edit, and what the edit was. */
export const VARIANT_KIND_QUALIFIER = 'variant_kind'
export type VariantKind = 'sub' | 'del' | 'ins' | 'delins'

export interface VariantRecord {
  name: string
  /** The three-letter HGVS name. */
  hgvs: string
  kind: VariantKind
  original: string
  replacement: string
  /** The displayed number of the first original residue (of the residue before an insertion). */
  position: number
  /** Residues the feature sits on after the edit, [start, end). */
  start: number
  end: number
}

const one = (r: string) => r
const three = (r: string) => THREE[r] ?? 'Xaa'

/** p.K27del or p.K27_L29del, for residues `original` first numbered `position`. */
function deletionNames(original: string, position: number): { name: string; hgvs: string } {
  const build = (res: (r: string) => string) => {
    const first = `${res(original[0])}${position}`
    if (original.length === 1) return `p.${first}del`
    return `p.${first}_${res(original[original.length - 1])}${position + original.length - 1}del`
  }
  return { name: build(one), hgvs: build(three) }
}

/**
 * Two deletions that meet (Backspace or Delete pressed again) as one: the
 * residues in sequence order, named from the lower position. `start` and
 * `after` are the junction and the length after the second deletion.
 */
export function mergedDeletion(
  prev: { original: string; position: number },
  next: { original: string; position: number },
  start: number,
  after: number,
): VariantRecord {
  const [a, b] = next.position < prev.position ? [next, prev] : [prev, next]
  const original = a.original + b.original
  const fStart = Math.max(0, Math.min(start, after - 1))
  return {
    ...deletionNames(original, a.position), kind: 'del', original, replacement: '',
    position: a.position, start: fStart, end: fStart + 1,
  }
}

/**
 * The variant an edit makes: `bases` are the residues before it, the edit
 * replaces [start, end) with `replacement`. `numberAt` gives the displayed
 * number of an internal position (numbering may start anywhere). Null when
 * nothing changes, or when the edit empties the protein.
 */
export function variantForEdit(
  bases: string,
  start: number,
  end: number,
  replacement: string,
  numberAt: (internalPos: number) => number,
): VariantRecord | null {
  const original = bases.slice(start, end).toUpperCase()
  const rep = replacement.toUpperCase()
  if (original === rep) return null
  const after = bases.length - original.length + rep.length
  if (after === 0) return null
  const name = (short: boolean) => {
    const res = short ? one : three
    const at = (i: number) => `${res(bases[i].toUpperCase())}${numberAt(i)}`
    const span = original.length === 1 ? at(start) : `${at(start)}_${at(end - 1)}`
    const ins = short ? rep : threeLetter(rep)
    if (rep.length === 0) return `p.${span}del`
    if (original.length === 0) {
      // Between two residues; at either end HGVS still names the neighbours.
      const left = start > 0 ? at(start - 1) : null
      const right = start < bases.length ? at(start) : null
      if (left && right) return `p.${left}_${right}ins${ins}`
      return left ? `p.${left}_?ins${ins}` : `p.?_${right}ins${ins}`
    }
    if (original.length === 1 && rep.length === 1) {
      return `p.${at(start)}${rep === '*' ? (short ? '*' : 'Ter') : res(rep)}`
    }
    return `p.${span}delins${ins}`
  }
  const kind: VariantKind = rep.length === 0 ? 'del'
    : original.length === 0 ? 'ins'
    : original.length === 1 && rep.length === 1 ? 'sub'
    : 'delins'
  // A deletion leaves no residues: the feature marks the junction, on the
  // residue that now follows it (or precedes it, at the very end).
  const fStart = kind === 'del' ? Math.min(start, after - 1) : start
  const fEnd = kind === 'del' ? fStart + 1 : start + rep.length
  const position = numberAt(kind === 'ins' && start > 0 ? start - 1 : Math.min(start, bases.length - 1))
  return { name: name(true), hgvs: name(false), kind, original, replacement: rep, position, start: fStart, end: fEnd }
}

let counter = 0
const run = Date.now().toString(36)

/** The variant as a feature. */
export function variantAnnotation(v: VariantRecord): AnnotationData {
  return {
    id: `${VARIANT_ID_PREFIX}${run}_${++counter}`,
    name: v.name,
    type: 'variant',
    start: v.start,
    end: v.end,
    strand: 0,
    qualifiers: {
      note: [v.hgvs],
      [VARIANT_KIND_QUALIFIER]: [v.kind],
      original: [v.original],
      replacement: [v.replacement],
      position: [String(v.position)],
    },
  }
}

/** Is this feature a variant the editor recorded, of this kind? */
export function isRecordedVariant(a: { type: string; qualifiers?: Record<string, string[]> }, kind?: VariantKind): boolean {
  if (a.type !== 'variant') return false
  const k = a.qualifiers?.[VARIANT_KIND_QUALIFIER]?.[0]
  return k !== undefined && (kind === undefined || k === kind)
}
