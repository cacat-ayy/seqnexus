/**
 * The nucleases the guide finder knows, as data.
 *
 * Each row says where the PAM sits, which spacer lengths it accepts and where
 * it cuts; types.ts documents the cut convention. A row is all it takes to
 * add one, and customNuclease builds the same record from what a user types
 * in the picker, so a PAM nobody has published yet scans like a built-in.
 *
 * onTargetModel is deliberately sparse. Sequence-activity models are fitted
 * for one nuclease in one setting, so only the SpCas9 family carries one
 * here; every other row reports no model rather than borrowing a number that
 * does not apply to it. See score/ontarget.ts.
 */

import { IUPAC } from '../models/iupac'
import type { Nuclease, PamSide, PromoterId } from './types'

export const NUCLEASES: readonly Nuclease[] = [
  {
    id: 'spcas9',
    name: 'SpCas9',
    pam: 'NGG',
    altPams: ['NAG'],
    pamSide: 'threePrime',
    spacerLengths: [20, 19, 18, 21],
    cut: { site: 3, opposite: 3 },
    overhang: 'blunt',
    cleaves: 'both',
    onTargetModel: 'heuristic-cas9',
    scaffoldId: 'spcas9-sgrna',
    promoter: 'u6',
    note: 'The usual choice. Blunt cut 3 bases from the PAM.',
  },
  {
    id: 'spcas9-ng',
    name: 'SpCas9-NG',
    pam: 'NG',
    pamSide: 'threePrime',
    spacerLengths: [20, 21],
    cut: { site: 3, opposite: 3 },
    overhang: 'blunt',
    cleaves: 'both',
    onTargetModel: 'heuristic-cas9',
    scaffoldId: 'spcas9-sgrna',
    promoter: 'u6',
    note: 'Relaxed PAM, so many more sites and much less specificity.',
  },
  {
    id: 'spcas9-vqr',
    name: 'SpCas9-VQR',
    pam: 'NGAN',
    pamSide: 'threePrime',
    spacerLengths: [20],
    cut: { site: 3, opposite: 3 },
    overhang: 'blunt',
    cleaves: 'both',
    onTargetModel: 'heuristic-cas9',
    scaffoldId: 'spcas9-sgrna',
    promoter: 'u6',
    note: 'Engineered PAM variant.',
  },
  {
    id: 'spcas9-vrer',
    name: 'SpCas9-VRER',
    pam: 'NGCG',
    pamSide: 'threePrime',
    spacerLengths: [20],
    cut: { site: 3, opposite: 3 },
    overhang: 'blunt',
    cleaves: 'both',
    onTargetModel: 'heuristic-cas9',
    scaffoldId: 'spcas9-sgrna',
    promoter: 'u6',
    note: 'Engineered PAM variant.',
  },
  {
    id: 'spcas9-d10a',
    name: 'SpCas9 D10A nickase',
    pam: 'NGG',
    altPams: ['NAG'],
    pamSide: 'threePrime',
    spacerLengths: [20],
    cut: { site: 3, opposite: 3 },
    overhang: 'blunt',
    cleaves: 'opposite',
    onTargetModel: 'heuristic-cas9',
    scaffoldId: 'spcas9-sgrna',
    promoter: 'u6',
    note: 'Nicks one strand. Used in pairs, and in prime editing.',
  },
  {
    id: 'dspcas9',
    name: 'dSpCas9 (binding only)',
    pam: 'NGG',
    altPams: ['NAG'],
    pamSide: 'threePrime',
    spacerLengths: [20],
    cut: { site: 3, opposite: 3 },
    overhang: 'blunt',
    cleaves: 'none',
    onTargetModel: 'none',
    scaffoldId: 'spcas9-sgrna',
    promoter: 'u6',
    note: 'Binds without cutting, for interference and activation, where position matters more than cutting activity.',
  },
  {
    id: 'sacas9',
    name: 'SaCas9',
    pam: 'NNGRRT',
    pamSide: 'threePrime',
    spacerLengths: [21, 20, 22, 23],
    cut: { site: 3, opposite: 3 },
    overhang: 'blunt',
    cleaves: 'both',
    onTargetModel: 'none',
    scaffoldId: 'sacas9-sgrna',
    promoter: 'u6',
    note: 'Smaller protein, longer PAM. Fits where SpCas9 does not.',
  },
  {
    id: 'sacas9-kkh',
    name: 'SaCas9-KKH',
    pam: 'NNNRRT',
    pamSide: 'threePrime',
    spacerLengths: [21, 20, 22],
    cut: { site: 3, opposite: 3 },
    overhang: 'blunt',
    cleaves: 'both',
    onTargetModel: 'none',
    scaffoldId: 'sacas9-sgrna',
    promoter: 'u6',
  },
  {
    id: 'st1cas9',
    name: 'St1Cas9',
    pam: 'NNAGAAW',
    pamSide: 'threePrime',
    spacerLengths: [20, 19],
    cut: { site: 3, opposite: 3 },
    overhang: 'blunt',
    cleaves: 'both',
    onTargetModel: 'none',
    scaffoldId: 'st1cas9-sgrna',
    promoter: 'u6',
  },
  {
    id: 'nmecas9',
    name: 'NmeCas9',
    pam: 'NNNNGATT',
    pamSide: 'threePrime',
    spacerLengths: [24, 23, 22],
    cut: { site: 3, opposite: 3 },
    overhang: 'blunt',
    cleaves: 'both',
    onTargetModel: 'none',
    scaffoldId: 'nmecas9-sgrna',
    promoter: 'u6',
    note: 'A long PAM and a long spacer, so few sites and high specificity.',
  },
  {
    id: 'cjcas9',
    name: 'CjCas9',
    pam: 'NNNNRYAC',
    pamSide: 'threePrime',
    spacerLengths: [22, 21, 23],
    cut: { site: 3, opposite: 3 },
    overhang: 'blunt',
    cleaves: 'both',
    onTargetModel: 'none',
    scaffoldId: 'cjcas9-sgrna',
    promoter: 'u6',
  },
  {
    id: 'ascas12a',
    name: 'AsCas12a (Cpf1)',
    pam: 'TTTV',
    pamSide: 'fivePrime',
    spacerLengths: [23, 20, 21, 22, 24],
    cut: { site: 18, opposite: 23 },
    overhang: '5prime',
    cleaves: 'both',
    onTargetModel: 'none',
    scaffoldId: 'cas12a-crrna',
    promoter: 'u6',
    note: 'The PAM is upstream of the spacer. Staggered cut leaving an overhang, well away from the PAM.',
  },
  {
    id: 'lbcas12a',
    name: 'LbCas12a',
    pam: 'TTTV',
    pamSide: 'fivePrime',
    spacerLengths: [23, 20, 21, 22, 24],
    cut: { site: 18, opposite: 23 },
    overhang: '5prime',
    cleaves: 'both',
    onTargetModel: 'none',
    scaffoldId: 'cas12a-crrna',
    promoter: 'u6',
  },
  {
    id: 'encas12a',
    name: 'enAsCas12a',
    pam: 'TTYN',
    pamSide: 'fivePrime',
    spacerLengths: [23, 20, 21, 22],
    cut: { site: 18, opposite: 23 },
    overhang: '5prime',
    cleaves: 'both',
    onTargetModel: 'none',
    scaffoldId: 'cas12a-crrna',
    promoter: 'u6',
    note: 'Engineered for a wider PAM than AsCas12a.',
  },
]

export const DEFAULT_NUCLEASE_ID = 'spcas9'

const BY_ID = new Map(NUCLEASES.map(n => [n.id, n]))

/** A shipped nuclease by id. Custom rows live in the store, not here. */
export function builtInNuclease(id: string): Nuclease | undefined {
  return BY_ID.get(id)
}

/** Resolve against the shipped rows and whatever custom rows were handed in. */
export function resolveNuclease(id: string, custom: readonly Nuclease[] = []): Nuclease | undefined {
  return BY_ID.get(id) ?? custom.find(n => n.id === id)
}

/** The spacer length a nuclease uses unless the user picks another. */
export function defaultSpacerLength(n: Nuclease): number {
  return n.spacerLengths[0]
}

export const MIN_SPACER = 14
export const MAX_SPACER = 30
export const MAX_PAM = 10

export interface CustomNucleaseInput {
  name: string
  pam: string
  pamSide: PamSide
  spacerLength: number
  /** Left blank when the cut position is unknown: the row then only reports sites. */
  cutSite?: number
  cutOpposite?: number
  promoter?: PromoterId
}

export interface CustomNucleaseError {
  field: 'name' | 'pam' | 'spacerLength' | 'cut'
  message: string
}

/** Only IUPAC codes, and at least one of them. */
export function validPam(pam: string): boolean {
  const p = pam.trim().toUpperCase()
  if (p.length === 0 || p.length > MAX_PAM) return false
  return [...p].every(c => IUPAC[c] !== undefined)
}

/**
 * What is wrong with the row the user typed, field by field, so the dialog
 * can mark the field rather than refuse the form with one message.
 */
export function checkCustomNuclease(input: CustomNucleaseInput): CustomNucleaseError[] {
  const errors: CustomNucleaseError[] = []
  if (input.name.trim().length === 0) errors.push({ field: 'name', message: 'Give it a name.' })
  if (!validPam(input.pam)) {
    errors.push({ field: 'pam', message: `Use IUPAC codes only, up to ${MAX_PAM} of them.` })
  }
  if (!Number.isInteger(input.spacerLength) || input.spacerLength < MIN_SPACER || input.spacerLength > MAX_SPACER) {
    errors.push({ field: 'spacerLength', message: `A spacer is ${MIN_SPACER} to ${MAX_SPACER} bases.` })
  }
  const one = input.cutSite !== undefined || input.cutOpposite !== undefined
  const both = input.cutSite !== undefined && input.cutOpposite !== undefined
  if (one && !both) errors.push({ field: 'cut', message: 'Give both cut positions, or neither.' })
  return errors
}

/** The user's nuclease as a record the finder can use. Call it on input that checks out. */
export function customNuclease(input: CustomNucleaseInput, id: string): Nuclease {
  const cuts = input.cutSite !== undefined && input.cutOpposite !== undefined
    ? { site: input.cutSite, opposite: input.cutOpposite }
    : { site: 0, opposite: 0 }
  const overhang = cuts.site === cuts.opposite
    ? ('blunt' as const)
    : cuts.site < cuts.opposite ? ('5prime' as const) : ('3prime' as const)
  return {
    id,
    name: input.name.trim(),
    pam: input.pam.trim().toUpperCase(),
    pamSide: input.pamSide,
    spacerLengths: [input.spacerLength],
    cut: cuts,
    overhang,
    cleaves: input.cutSite === undefined ? 'none' : 'both',
    onTargetModel: 'none',
    promoter: input.promoter ?? 'u6',
    custom: true,
  }
}
