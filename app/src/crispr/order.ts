/**
 * What to order, once a guide is chosen.
 *
 * Four shapes, because that is how guides are actually made: two annealed
 * oligos into a cut vector, a template to transcribe, a synthetic RNA, or a
 * pegRNA's own longer oligo. Each returns the exact strings to paste into an
 * order form, with every added base accounted for, since the additions are
 * where mistakes live: the G a U6 promoter wants, the overhangs the vector
 * wants, the extra C on the bottom oligo.
 *
 * The overhangs belong to the vector, not to the guide, so they are a
 * preset the user picks and can override. Nothing here guesses which vector
 * is on the bench.
 */

import { reverseComplement } from '../models/complement'
import { asRna, fullGuide, type Scaffold } from './scaffolds'
import type { Nuclease, PromoterId } from './types'
import { csvRow } from '../utils/csv-cell'

export type OrderFormat = 'annealed' | 'template' | 'synthetic' | 'peg'

export interface VectorPreset {
  id: string
  name: string
  /** The enzyme the vector is opened with, for the panel to name. */
  enzyme: string
  /** Added to the 5' end of the top oligo. */
  topOverhang: string
  /** Added to the 5' end of the bottom oligo. */
  bottomOverhang: string
  /** Added to the 3' end of the bottom oligo, pairing the top oligo's G. */
  bottomSuffix: string
  note: string
}

/**
 * The common arrangement: a CACC overhang on top and AAAC below, which is
 * what the widely shared SpCas9 vectors use. The G that follows CACC is the
 * transcript's first base, so it is only added when the spacer does not
 * start with one.
 */
export const VECTOR_PRESETS: readonly VectorPreset[] = [
  {
    id: 'bbsi-cacc',
    name: 'BbsI vector, CACC and AAAC',
    enzyme: 'BbsI',
    topOverhang: 'CACC',
    bottomOverhang: 'AAAC',
    bottomSuffix: '',
    note: 'The arrangement in the usual SpCas9 expression vectors.',
  },
  {
    id: 'bsmbi-cacc',
    name: 'BsmBI vector, CACC and AAAC',
    enzyme: 'BsmBI',
    topOverhang: 'CACC',
    bottomOverhang: 'AAAC',
    bottomSuffix: '',
    note: 'The same overhangs, for vectors opened with BsmBI.',
  },
  {
    id: 'cas12a-agat',
    name: 'Cas12a vector, AGAT and TGTA',
    enzyme: 'BsmBI',
    topOverhang: 'AGAT',
    bottomOverhang: 'TGTA',
    bottomSuffix: '',
    note: 'A Cas12a arrangement. Check the overhangs against your vector.',
  },
]

export function vectorPreset(id: string): VectorPreset | undefined {
  return VECTOR_PRESETS.find(v => v.id === id)
}

/**
 * T7 transcribes from its own promoter; this is the DNA that carries it.
 *
 * The 17 bases of the promoter itself, and not the G that follows them:
 * that G is the first base of the transcript, so it is added by
 * `promoterPrefix` along with any second one the guide needs. Carrying it in
 * both places is how a template comes to start the transcript with three G
 * when the guide shows two.
 */
export const T7_PROMOTER = 'TAATACGACTCACTATA'

export interface OrderOligo {
  name: string
  sequence: string
  /** Bases added to the spacer, for the panel to colour. */
  addedPrefix: string
  addedSuffix: string
  length: number
}

export interface OrderedConstruct {
  format: OrderFormat
  /** What the user is making, in a line. */
  title: string
  oligos: OrderOligo[]
  /** The finished molecule, when there is one to show. */
  product?: { name: string; sequence: string; isRna?: boolean }
  notes: string[]
}

export interface OrderRequest {
  name: string
  spacer: string
  nuclease: Nuclease
  scaffold?: Scaffold
  promoter: PromoterId
  /** For the annealed-oligo format. */
  vector?: VectorPreset
  /** For a pegRNA order. */
  extension?: string
}

/**
 * The extra 5' base a promoter wants, when the spacer does not start with
 * one. Returned rather than silently added, so the panel can say it is there.
 */
export function promoterPrefix(spacer: string, promoter: PromoterId): string {
  const s = spacer.toUpperCase()
  if (promoter === 'u6') return s.startsWith('G') ? '' : 'G'
  if (promoter === 't7') return s.startsWith('GG') ? '' : s.startsWith('G') ? 'G' : 'GG'
  return ''
}

/**
 * Whether the promoter's first transcribed base is the spacer's own.
 *
 * The start-base rule is about the 5' end of the transcript. For an sgRNA
 * that is the spacer, so a missing G is added in front of it. For a Cas12a
 * crRNA the repeat comes first and the spacer sits inside the transcript, so
 * a base added to the spacer would land between the repeat and the spacer and
 * the result would not be a guide RNA.
 */
function spacerStartsTranscript(req: OrderRequest): boolean {
  if (req.scaffold) return req.scaffold.side === 'after'
  return req.nuclease.pamSide !== 'fivePrime'
}

const REPEAT_FIRST_NOTE =
  'The repeat comes before the spacer, so the transcript starts on the repeat and no base is added to the spacer.'

function oligo(name: string, prefix: string, core: string, suffix: string): OrderOligo {
  const sequence = (prefix + core + suffix).toUpperCase()
  return { name, sequence, addedPrefix: prefix.toUpperCase(), addedSuffix: suffix.toUpperCase(), length: sequence.length }
}

/** Two oligos that anneal into a duplex with the vector's overhangs. */
export function annealedOligos(req: OrderRequest): OrderedConstruct {
  const spacer = req.spacer.toUpperCase()
  const vector = req.vector ?? VECTOR_PRESETS[0]
  const starts = spacerStartsTranscript(req)
  const g = starts ? promoterPrefix(spacer, req.promoter) : ''
  const top = g + spacer
  const notes = [`Anneal the pair and ligate into ${vector.enzyme}-cut vector.`, vector.note]
  if (g) {
    notes.push(`A ${g} was added at the 5′ end: the promoter starts best on it, and it becomes part of the guide.`)
  }
  if (!starts) notes.push(REPEAT_FIRST_NOTE)
  return {
    format: 'annealed',
    title: `${vector.name}`,
    oligos: [
      oligo(`${req.name}_top`, vector.topOverhang, top, ''),
      oligo(`${req.name}_bottom`, vector.bottomOverhang, reverseComplement(top), vector.bottomSuffix),
    ],
    notes,
  }
}

/** A DNA template to transcribe, promoter and all. */
export function transcriptionTemplate(req: OrderRequest): OrderedConstruct {
  const spacer = req.spacer.toUpperCase()
  const scaffold = req.scaffold
  // The start-base rule belongs to the transcript, so it is applied to the
  // whole guide and not to the spacer: for a Cas12a crRNA the repeat is what
  // transcription starts on.
  const body = scaffold ? fullGuide(spacer, scaffold) : spacer
  const g = promoterPrefix(body, 't7')
  const guide = g + body
  const notes = ['Transcribe from the T7 promoter with the whole of this as template.']
  if (g) notes.push(`${g} added so transcription starts cleanly; it becomes part of the guide.`)
  if (!scaffold) notes.push('No scaffold chosen, so this is the spacer alone.')
  return {
    format: 'template',
    title: 'T7 template',
    oligos: [oligo(`${req.name}_T7`, T7_PROMOTER, guide, '')],
    product: { name: `${req.name} guide RNA`, sequence: asRna(guide), isRna: true },
    notes,
  }
}

/** The guide as RNA, for ordering it made. */
export function syntheticGuide(req: OrderRequest): OrderedConstruct {
  const spacer = req.spacer.toUpperCase()
  const scaffold = req.scaffold
  const guide = scaffold ? fullGuide(spacer, scaffold) : spacer
  return {
    format: 'synthetic',
    title: scaffold ? `Single guide RNA, ${scaffold.name}` : 'Spacer only',
    oligos: [{
      name: `${req.name}_sgRNA`,
      sequence: asRna(guide),
      addedPrefix: '',
      addedSuffix: '',
      length: guide.length,
    }],
    product: { name: `${req.name} guide RNA`, sequence: asRna(guide), isRna: true },
    notes: scaffold
      ? ['Ordered as RNA. No promoter base is added: synthesis starts where you say it does.']
      : ['No scaffold chosen, so this is the spacer alone.'],
  }
}

/** A pegRNA: spacer, scaffold and the tail, as one long order. */
export function pegOrder(req: OrderRequest): OrderedConstruct {
  const spacer = req.spacer.toUpperCase()
  const scaffold = req.scaffold
  const extension = (req.extension ?? '').toUpperCase()
  const guide = (scaffold ? fullGuide(spacer, scaffold) : spacer) + extension
  return {
    format: 'peg',
    title: 'pegRNA',
    oligos: [{
      name: `${req.name}_pegRNA`,
      sequence: asRna(guide),
      addedPrefix: '',
      addedSuffix: asRna(extension),
      length: guide.length,
    }],
    product: { name: `${req.name} pegRNA`, sequence: asRna(guide), isRna: true },
    notes: [
      'The tail after the scaffold is the template and the primer site.',
      `${guide.length} bases in all, which is long for synthesis; a transcribed template may be cheaper.`,
    ],
  }
}

export function buildOrder(format: OrderFormat, req: OrderRequest): OrderedConstruct {
  switch (format) {
    case 'annealed': return annealedOligos(req)
    case 'template': return transcriptionTemplate(req)
    case 'synthetic': return syntheticGuide(req)
    case 'peg': return pegOrder(req)
  }
}

/** The order as a table, in the shape the oligo library already exports. */
export function orderCsv(constructs: readonly OrderedConstruct[]): string {
  const rows = [['name', 'sequence', 'length', 'format'].join(',')]
  for (const c of constructs) {
    for (const o of c.oligos) rows.push(csvRow([o.name, o.sequence, o.length, c.format]))
  }
  return rows.join('\n') + '\n'
}
