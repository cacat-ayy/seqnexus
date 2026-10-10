/**
 * Donors for putting something in.
 *
 * A donor is the payload with a stretch of the original sequence on either
 * side. The part worth automating is not the arms, which are a slice, but the
 * question that follows them: once the payload is in, can the nuclease still
 * find its site and cut the repaired copy? Often the insertion itself breaks
 * the site, and then nothing needs doing. When it does not, one base has to
 * change, and inside a coding sequence it should change nothing about the
 * protein.
 *
 * So the donor is built, then scanned, and only then edited, with the result
 * scanned again. The report says which of those happened rather than
 * asserting that the donor is safe.
 */

import { recognitionToRegex } from '../../models/iupac'
import { reverseComplement } from '../../models/complement'
import { geneticCode, synonymsFor, translateCodonWith } from '../../codon/genetic-codes'
import type { GuideCandidate, Nuclease } from '../types'
import { codingBases, codingIndex, codonAt, type CodingTarget } from './coding'

export interface KnockinSettings {
  /** Bases of original sequence on each side of the payload. */
  armLength: number
  /** Make the arm on the far side from the PAM twice as long. */
  asymmetric: boolean
  /** Whether to stop the donor being cut again, and where to change it. */
  blockRecut: 'auto' | 'none'
}

export const DEFAULT_KNOCKIN: KnockinSettings = {
  armLength: 40,
  asymmetric: false,
  blockRecut: 'auto',
}

export interface RecutBlock {
  /** Which part of the site was changed. */
  where: 'pam' | 'seed'
  /** Position in the donor, and in the original sequence. */
  donorAt: number
  genomicAt: number
  from: string
  to: string
  /** Set when the change leaves the protein as it was. */
  silent: boolean
  /** The codon it touched, when it was inside a coding sequence. */
  codon?: { number: number; from: string; to: string; aa: string; toAa: string }
}

export interface KnockinDonor {
  candidate: GuideCandidate
  /** Where the payload goes in the original sequence. */
  insertAt: number
  leftArm: string
  rightArm: string
  payload: string
  /** The whole donor, 5' to 3' on the sense strand. */
  donor: string
  /** Whether the nuclease could still cut the donor as first built. */
  wouldRecut: boolean
  /** The change made to stop that, when one was needed and possible. */
  block: RecutBlock | null
  warnings: string[]
}

/** Where the guide's site sits in a sequence, if it is still there intact. */
export function findIntactSite(
  sequence: string,
  spacer: string,
  nuclease: Nuclease,
): { start: number; strand: 1 | -1; pamStart: number } | null {
  const seq = sequence.toUpperCase()
  const pamRe = new RegExp(`^${recognitionToRegex(nuclease.pam)}$`, 'i')
  const pamLen = nuclease.pam.length
  const threePrime = nuclease.pamSide === 'threePrime'

  for (const strand of [1, -1] as const) {
    const needle = strand === 1 ? spacer.toUpperCase() : reverseComplement(spacer.toUpperCase())
    let from = 0
    for (;;) {
      const at = seq.indexOf(needle, from)
      if (at === -1) break
      from = at + 1
      // The PAM sits after the protospacer on its own strand, which is after
      // it in sense coordinates for a 3' PAM read forwards, and before it
      // when either the PAM side or the strand is reversed.
      const pamAfter = (strand === 1) === threePrime
      const pamStart = pamAfter ? at + needle.length : at - pamLen
      if (pamStart < 0 || pamStart + pamLen > seq.length) continue
      const pamSense = seq.slice(pamStart, pamStart + pamLen)
      const pam = strand === 1 ? pamSense : reverseComplement(pamSense)
      if (pamRe.test(pam)) return { start: at, strand, pamStart }
    }
  }
  return null
}

/** Bases other than this one, for trying a change. */
const OTHERS: Record<string, string[]> = {
  A: ['C', 'G', 'T'], C: ['A', 'G', 'T'], G: ['A', 'C', 'T'], T: ['A', 'C', 'G'],
}

interface Mapping {
  /** Donor position to position in the original sequence, or null inside the payload. */
  toGenomic: (donorAt: number) => number | null
}

/**
 * Try to stop the donor being cut again, preferring a change that leaves the
 * protein alone and preferring the PAM over the seed, since breaking the PAM
 * stops the nuclease binding at all.
 */
function blockRecut(
  donor: string,
  site: { start: number; strand: 1 | -1; pamStart: number },
  spacer: string,
  nuclease: Nuclease,
  mapping: Mapping,
  coding: { target: CodingTarget; cds: string } | null,
): { donor: string; block: RecutBlock } | null {
  const pamLen = nuclease.pam.length
  const threePrime = nuclease.pamSide === 'threePrime'
  // The seed is the PAM-proximal end of the protospacer, in donor coordinates.
  const proximalFirst = (site.strand === 1) === threePrime
  const seedPositions: number[] = []
  for (let k = 0; k < 4; k++) {
    seedPositions.push(proximalFirst ? site.start + spacer.length - 1 - k : site.start + k)
  }
  const pamPositions = Array.from({ length: pamLen }, (_, i) => site.pamStart + i)

  const attempts: { where: 'pam' | 'seed'; at: number }[] = [
    ...pamPositions.map(at => ({ where: 'pam' as const, at })),
    ...seedPositions.map(at => ({ where: 'seed' as const, at })),
  ]

  let fallback: { donor: string; block: RecutBlock } | null = null

  for (const attempt of attempts) {
    const from = donor[attempt.at]?.toUpperCase()
    if (!from || !OTHERS[from]) continue
    for (const to of OTHERS[from]) {
      const next = donor.slice(0, attempt.at) + to + donor.slice(attempt.at + 1)
      if (findIntactSite(next, spacer, nuclease)) continue

      // What that change does to the protein, when it is inside one.
      const genomicAt = mapping.toGenomic(attempt.at)
      let silent = true
      let codon: RecutBlock['codon']
      if (coding && genomicAt !== null) {
        const codingAt = codingIndex(coding.target, genomicAt)
        if (codingAt !== null) {
          const onCoding = coding.target.strand === 1 ? to : reverseComplement(to)
          const { codon: number, offset } = codonAt(codingAt)
          const start = (number - 1) * 3
          const oldCodon = coding.cds.slice(start, start + 3)
          const newCodon = oldCodon.slice(0, offset) + onCoding + oldCodon.slice(offset + 1)
          const code = geneticCode(coding.target.codeId)
          const aa = translateCodonWith(code, oldCodon)
          const toAa = translateCodonWith(code, newCodon)
          silent = aa === toAa
          codon = { number, from: oldCodon, to: newCodon, aa, toAa }
        }
      }

      const block: RecutBlock = {
        where: attempt.where,
        donorAt: attempt.at,
        genomicAt: genomicAt ?? -1,
        from,
        to,
        silent,
        ...(codon ? { codon } : {}),
      }
      if (silent) return { donor: next, block }
      if (!fallback) fallback = { donor: next, block }
    }
  }
  return fallback
}

export function designDonor(
  candidate: GuideCandidate,
  bases: string,
  payload: string,
  insertAt: number,
  nuclease: Nuclease,
  target: CodingTarget | null,
  settings: KnockinSettings = DEFAULT_KNOCKIN,
): KnockinDonor {
  const seq = bases.toUpperCase()
  const clean = payload.toUpperCase().replace(/[^ACGT]/g, '')
  const warnings: string[] = []
  if (clean.length !== payload.replace(/\s/g, '').length) {
    warnings.push('Bases that are not A, C, G or T were dropped from the payload.')
  }

  // The arm on the far side from the PAM can be the longer one.
  const pamSide = candidate.site.pamStart >= insertAt ? 'right' : 'left'
  const longArm = settings.asymmetric ? settings.armLength * 2 : settings.armLength
  const leftLen = settings.asymmetric && pamSide === 'right' ? longArm : settings.armLength
  const rightLen = settings.asymmetric && pamSide === 'left' ? longArm : settings.armLength

  const leftStart = Math.max(0, insertAt - leftLen)
  const rightEnd = Math.min(seq.length, insertAt + rightLen)
  const leftArm = seq.slice(leftStart, insertAt)
  const rightArm = seq.slice(insertAt, rightEnd)
  if (leftArm.length < leftLen || rightArm.length < rightLen) {
    warnings.push('The sequence ends before the arms do, so they are shorter on one side.')
  }

  let donor = leftArm + clean + rightArm
  const mapping: Mapping = {
    toGenomic: (at: number) => {
      if (at < leftArm.length) return leftStart + at
      if (at >= leftArm.length + clean.length) return insertAt + (at - leftArm.length - clean.length)
      return null
    },
  }

  const coding = target ? { target, cds: codingBases(target, seq) } : null
  const site = findIntactSite(donor, candidate.site.spacer, nuclease)
  const wouldRecut = site !== null
  let block: RecutBlock | null = null

  if (site && settings.blockRecut === 'auto') {
    const blocked = blockRecut(donor, site, candidate.site.spacer, nuclease, mapping, coding)
    if (blocked) {
      donor = blocked.donor
      block = blocked.block
      if (!block.silent) {
        warnings.push(
          block.codon
            ? `Stopping the donor being cut changes codon ${block.codon.number} from ${block.codon.aa} to ${block.codon.toAa}.`
            : 'Stopping the donor being cut changes a base outside any coding sequence.',
        )
      }
    } else {
      warnings.push('No single change was found that stops the donor being cut again.')
    }
  } else if (site && settings.blockRecut === 'none') {
    warnings.push('The donor still carries an intact site, so the repaired copy can be cut again.')
  }

  return {
    candidate,
    insertAt,
    leftArm,
    rightArm,
    payload: clean,
    donor,
    wouldRecut,
    block,
    warnings,
  }
}

/** Synonymous codons for an amino acid, for the panel to offer by hand. */
export function silentOptions(codeId: number, aa: string): string[] {
  return synonymsFor(geneticCode(codeId), aa)
}
