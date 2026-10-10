/**
 * What happened at the cut, from reads.
 *
 * Every read is aligned to the amplicon and then judged on one window around
 * the break: is it the reference, does it carry an insertion, a deletion, a
 * substitution, or the donor that was supplied? Reads that agree are one
 * allele, counted together, and the table of alleles with their shares is
 * the result.
 *
 * Two decisions worth stating. The window is narrow and centred on the cut,
 * because a change at the far end of an amplicon is a sequencing error or a
 * polymorphism, not an edit, and counting it as one inflates every number.
 * And a read that does not span the whole window is not counted at all
 * rather than counted as unmodified, since a read that stops inside the
 * window cannot say what is in the rest of it.
 */

import { needlemanWunsch } from '../../alignment/nw'
import { makeDnaScorer } from '../../alignment/matrices'

export type AlleleKind = 'unmodified' | 'insertion' | 'deletion' | 'substitution' | 'donor' | 'mixed'

export interface AlleleCall {
  kind: AlleleKind
  /** Net length change inside the window; negative for a deletion. */
  indel: number
  /** Substitutions inside the window. */
  substitutions: number
  /** The window as the read reads it, which is what alleles are grouped by. */
  sequence: string
}

export interface Allele extends AlleleCall {
  reads: number
  fraction: number
  /** Whether the length change shifts a reading frame. */
  frameshift: boolean
}

export interface AlleleTable {
  /** Reads that spanned the window and were counted. */
  counted: number
  /** Reads thrown out, and why. */
  skipped: { tooShort: number; unaligned: number }
  alleles: Allele[]
  /** Share of counted reads that are not the reference. */
  edited: number
  /** Share whose length change shifts the frame. */
  frameshift: number
  /** Share matching the donor, when one was given. */
  donor: number
  /** Indel sizes and their shares, for the histogram. */
  spectrum: { size: number; fraction: number }[]
  window: { start: number; end: number }
}

export interface AlleleSettings {
  /** Bases either side of the cut that an edit must touch to count. */
  window: number
  /** Alleles kept in the table; the rest are summed into the totals only. */
  keep: number
  /** Reads below this identity to the amplicon are treated as unaligned. */
  minIdentity: number
}

export const DEFAULT_ALLELES: AlleleSettings = { window: 20, keep: 20, minIdentity: 0.6 }

/** Match and mismatch as an amplicon read deserves: errors are cheap, indels are the signal. */
const SCORER = makeDnaScorer(2, -3)
const GAP_OPEN = -10
const GAP_EXTEND = -1

/**
 * Align a read to the amplicon and read off the window.
 *
 * Global alignment is right here: an amplicon read is meant to span the
 * whole product, so a read that only partly matches is a read with something
 * wrong with it, which the identity floor catches.
 */
export function callRead(
  read: string,
  amplicon: string,
  cut: number,
  settings: AlleleSettings = DEFAULT_ALLELES,
): AlleleCall | { skip: 'tooShort' | 'unaligned' } {
  const r = read.toUpperCase().replace(/[^ACGTN]/g, '')
  if (r.length < settings.window) return { skip: 'tooShort' }

  const { alignedA, alignedB } = needlemanWunsch(amplicon, r, SCORER, GAP_OPEN, GAP_EXTEND)

  let identical = 0
  let compared = 0
  for (let i = 0; i < alignedA.length; i++) {
    if (alignedA[i] === '-' || alignedB[i] === '-') continue
    compared++
    if (alignedA[i] === alignedB[i]) identical++
  }
  if (compared === 0 || identical / compared < settings.minIdentity) return { skip: 'unaligned' }

  const from = Math.max(0, cut - settings.window)
  const to = Math.min(amplicon.length, cut + settings.window)

  // Walk the alignment, counting reference positions, and collect what the
  // read shows across the window.
  let refPos = 0
  let readPos = 0
  let insertions = 0
  let deletions = 0
  let substitutions = 0
  let sequence = ''
  let sawStart = false
  let sawEnd = false
  for (let i = 0; i < alignedA.length; i++) {
    const a = alignedA[i]
    const b = alignedB[i]
    const inWindow = refPos >= from && refPos < to
    if (inWindow) {
      sawStart = true
      if (b !== '-') sequence += b
      if (a === '-') insertions++
      else if (b === '-') deletions++
      else if (a !== b && b !== 'N') substitutions++
    }
    if (refPos >= to) sawEnd = true
    if (a !== '-') refPos++
    if (b !== '-') readPos++
  }
  if (!sawStart || (!sawEnd && refPos < to)) return { skip: 'tooShort' }
  // A read that runs out before the window ends cannot speak for it.
  if (readPos === 0) return { skip: 'tooShort' }

  const indel = insertions - deletions
  const kind: AlleleKind = indel === 0 && substitutions === 0
    ? 'unmodified'
    : insertions > 0 && deletions > 0
      ? 'mixed'
      : insertions > 0
        ? 'insertion'
        : deletions > 0
          ? 'deletion'
          : 'substitution'

  return { kind, indel, substitutions, sequence }
}

/**
 * Group reads into alleles.
 *
 * `donor` is the sequence a knock-in was meant to install; a read whose
 * window contains it is counted as donor-derived whatever else it shows,
 * since that is the outcome being asked about.
 */
export function callAlleles(
  reads: readonly string[],
  amplicon: string,
  cut: number,
  settings: AlleleSettings = DEFAULT_ALLELES,
  donor?: string,
): AlleleTable {
  const ref = amplicon.toUpperCase()
  const skipped = { tooShort: 0, unaligned: 0 }
  const groups = new Map<string, Allele>()
  const donorWindow = donor ? donor.toUpperCase() : null
  let counted = 0

  for (const read of reads) {
    const call = callRead(read, ref, cut, settings)
    if ('skip' in call) { skipped[call.skip]++; continue }
    counted++
    const isDonor = donorWindow !== null && donorWindow.length > 0 && call.sequence.includes(donorWindow)
    const kind: AlleleKind = isDonor ? 'donor' : call.kind
    const key = `${kind}:${call.sequence}`
    const held = groups.get(key)
    if (held) held.reads++
    else {
      groups.set(key, {
        ...call,
        kind,
        reads: 1,
        fraction: 0,
        frameshift: call.indel !== 0 && call.indel % 3 !== 0,
      })
    }
  }

  const alleles = [...groups.values()].sort((a, b) => b.reads - a.reads)
  for (const allele of alleles) allele.fraction = counted > 0 ? allele.reads / counted : 0

  const share = (predicate: (a: Allele) => boolean) =>
    alleles.reduce((n, a) => n + (predicate(a) ? a.fraction : 0), 0)

  const bySize = new Map<number, number>()
  for (const allele of alleles) {
    bySize.set(allele.indel, (bySize.get(allele.indel) ?? 0) + allele.fraction)
  }

  return {
    counted,
    skipped,
    alleles: alleles.slice(0, settings.keep),
    edited: share(a => a.kind !== 'unmodified'),
    frameshift: share(a => a.frameshift),
    donor: share(a => a.kind === 'donor'),
    spectrum: [...bySize.entries()]
      .map(([size, fraction]) => ({ size, fraction }))
      .sort((a, b) => a.size - b.size),
    window: { start: Math.max(0, cut - settings.window), end: Math.min(ref.length, cut + settings.window) },
  }
}

/**
 * Where each base of the window was changed, for a base editing run: how
 * often each position reads as something other than the reference.
 */
export function conversionByPosition(
  reads: readonly string[],
  amplicon: string,
  cut: number,
  settings: AlleleSettings = DEFAULT_ALLELES,
): { position: number; reference: string; converted: Record<string, number>; depth: number }[] {
  const ref = amplicon.toUpperCase()
  const from = Math.max(0, cut - settings.window)
  const to = Math.min(ref.length, cut + settings.window)
  const counts = Array.from({ length: to - from }, () => ({ A: 0, C: 0, G: 0, T: 0, depth: 0 }))

  for (const read of reads) {
    const r = read.toUpperCase().replace(/[^ACGTN]/g, '')
    if (r.length === 0) continue
    const { alignedA, alignedB } = needlemanWunsch(ref, r, SCORER, GAP_OPEN, GAP_EXTEND)
    let refPos = 0
    for (let i = 0; i < alignedA.length; i++) {
      const a = alignedA[i]
      const b = alignedB[i]
      if (a !== '-' && refPos >= from && refPos < to && b !== '-' && b !== 'N') {
        const slot = counts[refPos - from]
        slot.depth++
        if (b === 'A' || b === 'C' || b === 'G' || b === 'T') slot[b]++
      }
      if (a !== '-') refPos++
    }
  }

  return counts.map((slot, i) => {
    const position = from + i
    const reference = ref[position]
    const converted: Record<string, number> = {}
    for (const base of ['A', 'C', 'G', 'T'] as const) {
      if (base !== reference && slot[base] > 0) converted[base] = slot.depth > 0 ? slot[base] / slot.depth : 0
    }
    return { position, reference, converted, depth: slot.depth }
  })
}

/** The allele table as a table. */
export function alleleCsv(table: AlleleTable): string {
  const rows = [['kind', 'indel', 'substitutions', 'reads', 'share', 'sequence'].join(',')]
  for (const allele of table.alleles) {
    rows.push([
      allele.kind,
      allele.indel > 0 ? `+${allele.indel}` : String(allele.indel),
      String(allele.substitutions),
      String(allele.reads),
      (allele.fraction * 100).toFixed(2),
      allele.sequence,
    ].join(','))
  }
  return rows.join('\n')
}
