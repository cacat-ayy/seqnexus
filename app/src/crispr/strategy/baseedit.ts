/**
 * Guides for changing one base without a double-strand break.
 *
 * A base editor is a nuclease that does not cut carrying an enzyme that does
 * chemistry on a short stretch of the protospacer. Two things follow, and the
 * panel has to show both: the edit you want only happens if the base you want
 * falls in that stretch, and every other base of the same kind in that stretch
 * is edited too. The second is the whole difficulty of the technique, so the
 * bystanders are listed with what they do to the protein, not hidden behind a
 * score.
 *
 * Window positions are counted the way the literature counts them: position 1
 * is the PAM-distal end of the protospacer.
 */

import { reverseComplement } from '../../models/complement'
import type { GuideCandidate, Nuclease } from '../types'
import { codingIndex, codonChange, codingBases, type CodingTarget, type CodonChange } from './coding'

export interface EditorSpec {
  id: string
  name: string
  /** The base it acts on, read on the protospacer strand. */
  from: 'C' | 'A'
  to: 'T' | 'G'
  /** The stretch it acts in, 1-based from the PAM-distal end, inclusive. */
  window: [number, number]
  note?: string
}

/**
 * The editors offered. Windows are the ones usually quoted for each family;
 * a construct in hand may differ, so the window is editable in the panel and
 * these are starting points rather than claims about a particular plasmid.
 */
export const EDITORS: readonly EditorSpec[] = [
  { id: 'cbe', name: 'Cytosine editor (C to T)', from: 'C', to: 'T', window: [4, 8], note: 'The classic narrow window.' },
  { id: 'cbe-wide', name: 'Cytosine editor, wide window', from: 'C', to: 'T', window: [1, 12] },
  { id: 'abe', name: 'Adenine editor (A to G)', from: 'A', to: 'G', window: [4, 7] },
  { id: 'abe-wide', name: 'Adenine editor, wide window', from: 'A', to: 'G', window: [3, 9] },
]

export function editorById(id: string): EditorSpec | undefined {
  return EDITORS.find(e => e.id === id)
}

export interface PlannedEdit {
  /** Position in the protospacer, 1-based from the PAM-distal end. */
  position: number
  /** Where it is in the sequence. */
  genomic: number
  from: string
  to: string
  /** False for the base the user asked to change. */
  bystander: boolean
  /** What it does to the protein, when it falls in a coding sequence. */
  consequence?: CodonChange
}

export interface BaseEditPick {
  candidate: GuideCandidate
  editor: EditorSpec
  edits: PlannedEdit[]
  /** The edit the user asked for, when a target was given and it is in range. */
  target: PlannedEdit | null
  /** Edits other than the target. */
  bystanders: PlannedEdit[]
  warnings: string[]
}

/**
 * The genomic position of a protospacer position, counting 1 from the
 * PAM-distal end.
 */
export function genomicOfProtospacerPosition(
  site: GuideCandidate['site'],
  nuclease: Nuclease,
  position: number,
  seqLen: number,
): number {
  const offset = position - 1
  // The spacer is written 5' to 3'; for a 3' PAM its 5' end is PAM-distal,
  // and for a 5' PAM the PAM-distal end is its 3' end.
  const fromSpacerStart = nuclease.pamSide === 'threePrime' ? offset : site.spacer.length - 1 - offset
  const genomic = site.strand === 1
    ? site.start + fromSpacerStart
    : site.end - 1 - fromSpacerStart
  return ((genomic % seqLen) + seqLen) % seqLen
}

export function planBaseEdits(
  candidates: readonly GuideCandidate[],
  editor: EditorSpec,
  bases: string,
  nuclease: Nuclease,
  options: {
    /** The base the user wants changed, in sequence coordinates. */
    target?: number
    /** Window override, when the construct in hand is not the usual one. */
    window?: [number, number]
    /** The gene the edit falls in, for the protein consequences. */
    coding?: CodingTarget | null
  } = {},
): BaseEditPick[] {
  const seq = bases.toUpperCase()
  const seqLen = seq.length
  const [from, to] = [options.window?.[0] ?? editor.window[0], options.window?.[1] ?? editor.window[1]]
  const coding = options.coding ?? null
  const cds = coding ? codingBases(coding, seq) : ''
  const picks: BaseEditPick[] = []

  for (const candidate of candidates) {
    const { site } = candidate
    const edits: PlannedEdit[] = []
    for (let position = from; position <= Math.min(to, site.spacer.length); position++) {
      // The editor reads the protospacer strand, so compare there.
      const index = nuclease.pamSide === 'threePrime' ? position - 1 : site.spacer.length - position
      const base = site.spacer[index]
      if (base !== editor.from) continue
      const genomic = genomicOfProtospacerPosition(site, nuclease, position, seqLen)
      const edit: PlannedEdit = {
        position,
        genomic,
        from: editor.from,
        to: editor.to,
        bystander: options.target !== undefined ? genomic !== options.target : false,
      }
      if (coding) {
        const codingAt = codingIndex(coding, genomic)
        if (codingAt !== null) {
          // The editor's change is on the protospacer strand; the codon is
          // read on the coding strand, so flip when they disagree.
          const sameStrand = (site.strand === 1) === (coding.strand === 1)
          const onCoding = sameStrand ? editor.to : reverseComplement(editor.to)
          const change = codonChange(coding, cds, codingAt, onCoding)
          if (change) edit.consequence = change
        }
      }
      edits.push(edit)
    }
    if (edits.length === 0) continue

    const target = options.target !== undefined
      ? edits.find(e => e.genomic === options.target) ?? null
      : null
    if (options.target !== undefined && !target) continue
    const bystanders = edits.filter(e => e !== target)

    const warnings: string[] = []
    if (bystanders.length > 0) {
      const changing = bystanders.filter(b => b.consequence && b.consequence.kind !== 'silent')
      if (changing.length > 0) {
        warnings.push(
          `${changing.length} bystander edit${changing.length === 1 ? '' : 's'} would change the protein too.`,
        )
      } else {
        warnings.push(`${bystanders.length} bystander edit${bystanders.length === 1 ? '' : 's'} in the window.`)
      }
    }
    if (edits.some(e => e.consequence?.kind === 'nonsense')) {
      warnings.push('One of these edits makes a stop codon.')
    }

    picks.push({ candidate, editor, edits, target, bystanders, warnings })
  }

  // Fewest bystanders first, then the better guide.
  picks.sort((a, b) => {
    if (a.bystanders.length !== b.bystanders.length) return a.bystanders.length - b.bystanders.length
    return (b.candidate.scores.onTarget ?? -1) - (a.candidate.scores.onTarget ?? -1)
  })
  return picks
}
