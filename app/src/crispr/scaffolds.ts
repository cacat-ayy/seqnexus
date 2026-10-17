/**
 * The constant part of the guide RNA.
 *
 * A spacer is only half of what gets ordered. The other half is the scaffold
 * the nuclease binds, and it belongs to the plasmid or the synthesis order
 * rather than to the target, so the two are kept apart everywhere in this
 * module: the spacer is what the panel finds, the scaffold is what the user
 * chooses here.
 *
 * What ships is deliberately short. A scaffold is a long constant that is
 * easy to print wrongly and impossible to notice wrongly, so only the ones
 * that are near-universal are shipped, each saying what it is; for anything
 * else the panel asks for the sequence from the vector in hand and keeps it.
 * A scaffold that was never typed is better than one that is almost right.
 */

import type { Nuclease } from './types'

export interface Scaffold {
  id: string
  name: string
  /** RNA written as DNA, as the rest of the app writes sequence. */
  sequence: string
  /** Which side of the spacer it sits on in the finished guide. */
  side: 'after' | 'before'
  /** Nucleases it is for; a custom one claims none. */
  nucleaseIds: readonly string[]
  note: string
  custom?: true
}

export const SCAFFOLDS: readonly Scaffold[] = [
  {
    id: 'spcas9-sgrna',
    name: 'SpCas9 sgRNA scaffold',
    sequence: 'GTTTTAGAGCTAGAAATAGCAAGTTAAAATAAGGCTAGTCCGTTATCAACTTGAAAAAGTGGCACCGAGTCGGTGC',
    side: 'after',
    nucleaseIds: ['spcas9', 'spcas9-ng', 'spcas9-vqr', 'spcas9-vrer', 'spcas9-d10a', 'spcas9-h840a', 'dspcas9'],
    note: 'The single-guide scaffold used in most SpCas9 vectors. Check it against your plasmid.',
  },
  {
    id: 'spcas9-sgrna-extended',
    name: 'SpCas9 sgRNA scaffold, extended stem',
    sequence: 'GTTTAAGAGCTATGCTGGAAACAGCATAGCAAGTTTAAATAAGGCTAGTCCGTTATCAACTTGAAAAAGTGGCACCGAGTCGGTGC',
    side: 'after',
    nucleaseIds: ['spcas9', 'spcas9-ng', 'spcas9-vqr', 'spcas9-vrer', 'spcas9-d10a', 'spcas9-h840a', 'dspcas9'],
    note: 'The variant with the flipped base pair and the lengthened stem loop, common in newer vectors.',
  },
  {
    id: 'ascas12a-crrna',
    name: 'AsCas12a direct repeat',
    sequence: 'TAATTTCTACTCTTGTAGAT',
    side: 'before',
    nucleaseIds: ['ascas12a', 'encas12a'],
    note: 'The repeat that precedes the spacer in an AsCas12a crRNA. enAsCas12a is an AsCas12a variant and uses the same one.',
  },
  {
    id: 'lbcas12a-crrna',
    name: 'LbCas12a direct repeat',
    sequence: 'AATTTCTACTAAGTGTAGAT',
    side: 'before',
    nucleaseIds: ['lbcas12a'],
    note: 'The LbCas12a repeat, which is not the AsCas12a one: the loop differs and the orthologues do not read each other’s crRNA well.',
  },
]

/**
 * Whether a nuclease's guide RNA starts with the spacer or with its constant
 * part. A promoter's start-base rule applies to whichever comes first.
 */
export function spacerStartsGuide(nuclease: Nuclease, custom: readonly Scaffold[] = []): boolean {
  const scaffold = defaultScaffold(nuclease, custom)
  if (scaffold) return scaffold.side === 'after'
  return nuclease.pamSide !== 'fivePrime'
}

export function scaffoldById(id: string, custom: readonly Scaffold[] = []): Scaffold | undefined {
  return SCAFFOLDS.find(s => s.id === id) ?? custom.find(s => s.id === id)
}

/** The scaffolds offered for a nuclease: its own, then anything the user added. */
export function scaffoldsFor(nuclease: Nuclease, custom: readonly Scaffold[] = []): Scaffold[] {
  const shipped = SCAFFOLDS.filter(s => s.nucleaseIds.includes(nuclease.id))
  return [...shipped, ...custom]
}

/** The scaffold a nuclease starts with, or undefined when none ships for it. */
export function defaultScaffold(nuclease: Nuclease, custom: readonly Scaffold[] = []): Scaffold | undefined {
  if (nuclease.scaffoldId) {
    const named = scaffoldById(nuclease.scaffoldId, custom)
    if (named) return named
  }
  return scaffoldsFor(nuclease, custom)[0]
}

/** The whole guide RNA, spacer and scaffold in the order the nuclease wants. */
export function fullGuide(spacer: string, scaffold: Scaffold): string {
  const s = spacer.toUpperCase()
  return scaffold.side === 'after' ? s + scaffold.sequence : scaffold.sequence + s
}

/** The same thing as RNA, which is what a synthesis order wants. */
export function asRna(dna: string): string {
  return dna.toUpperCase().replace(/T/g, 'U')
}

export function customScaffold(name: string, sequence: string, side: 'after' | 'before', id: string): Scaffold {
  return {
    id,
    name: name.trim() || 'My scaffold',
    sequence: sequence.toUpperCase().replace(/[^ACGTU]/g, '').replace(/U/g, 'T'),
    side,
    nucleaseIds: [],
    note: 'Yours, typed in.',
    custom: true,
  }
}
