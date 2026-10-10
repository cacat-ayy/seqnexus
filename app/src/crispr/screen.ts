/**
 * Telling, afterwards, whether it worked.
 *
 * Two cheap readouts, designed here so they are ready before the experiment
 * rather than after it:
 *
 * - An amplicon across the cut, with the cut set well away from both primers
 *   so a trace can be read through it and so a small indel still shows.
 * - A restriction site that the cut sits inside. An indel destroys it, so the
 *   amplicon stops being cut by that enzyme, and a gel answers the question
 *   without sequencing anything. The site has to be unique in the amplicon,
 *   or an uncut band means nothing.
 *
 * Both are suggestions with their reasons attached, not instructions.
 */

import { ENZYME_DB, type RestrictionEnzyme } from '../enzymes/db'
import { findAllSites, type CutSite } from '../enzymes/finder'
import { designPrimers } from '../primers/design/design'
import { DEFAULT_CONSTRAINTS } from '../primers/scoring'
import type { DesignPair } from '../primers/design/types'

export interface ScreenSettings {
  /** Amplicon size the design aims for. */
  minProduct: number
  maxProduct: number
  /**
   * How far the cut must sit from either end of the amplicon. A trace is
   * unreadable for the first stretch after the primer, and an indel is
   * easiest to see with sequence either side of it.
   */
  margin: number
  /** Pairs to return. */
  maxPairs: number
}

export const DEFAULT_SCREEN: ScreenSettings = {
  minProduct: 400,
  maxProduct: 900,
  margin: 120,
  maxPairs: 10,
}

export interface ScreenPrimerPair {
  pair: DesignPair
  forward: { name: string; sequence: string; start: number; tm: number }
  reverse: { name: string; sequence: string; start: number; tm: number }
  productSize: number
  /** Where the cut falls inside the amplicon. */
  cutOffset: number
  warnings: string[]
}

/**
 * Primers that amplify across a cut.
 *
 * The target handed to the designer is the cut plus the margin on each side,
 * which is what keeps the primers off the break and the break away from the
 * ends of the read.
 */
export function screeningPrimers(
  bases: string,
  topology: 'linear' | 'circular',
  cut: number,
  settings: ScreenSettings = DEFAULT_SCREEN,
): ScreenPrimerPair[] {
  const margin = settings.margin
  const start = Math.max(0, cut - margin)
  const end = Math.min(bases.length, cut + margin)
  if (end - start < 2) return []

  const result = designPrimers({
    template: bases,
    topology,
    target: { start, end },
    minProductSize: settings.minProduct,
    maxProductSize: settings.maxProduct,
    constraints: DEFAULT_CONSTRAINTS,
    maxPairs: settings.maxPairs,
  })

  return result.pairs.map((pair, i) => {
    const productStart = pair.forward.linStart
    // On a circular molecule the product can cross the origin, and then the
    // cut is behind the start of the product in plain coordinates. The offset
    // is how far into the product the cut falls, so it wraps too.
    const cutOffset = ((cut - productStart) % bases.length + bases.length) % bases.length
    const warnings = [...pair.evaluation.warnings]
    if (cutOffset < margin) warnings.push('The cut is close to the forward primer.')
    if (pair.evaluation.productSize - cutOffset < margin) warnings.push('The cut is close to the reverse primer.')
    return {
      pair,
      forward: {
        name: `screen_F${i + 1}`,
        sequence: pair.forward.sequence,
        start: pair.forward.linStart,
        tm: pair.forward.tm,
      },
      reverse: {
        name: `screen_R${i + 1}`,
        sequence: pair.reverse.sequence,
        start: pair.reverse.linStart,
        tm: pair.reverse.tm,
      },
      productSize: pair.evaluation.productSize,
      cutOffset,
      warnings,
    }
  })
}

export interface RflpOption {
  enzyme: RestrictionEnzyme
  /** The one site, in sequence coordinates. */
  site: CutSite
  /** How far the nuclease's cut is from the middle of the enzyme's site. */
  offset: number
  /** Sites this enzyme has in the amplicon; one is what makes the test work. */
  sitesInAmplicon: number
}

/**
 * Enzymes whose site the cut sits inside, and which cut the amplicon only
 * there.
 *
 * An edit at the break disturbs the site, so the amplicon from an edited
 * copy is no longer cut: two bands become one. Anything cutting the amplicon
 * more than once is left out, since then the pattern cannot be read.
 */
export function rflpOptions(
  bases: string,
  cut: number,
  amplicon: { start: number; end: number },
  enzymes: readonly RestrictionEnzyme[] = ENZYME_DB,
): RflpOption[] {
  const len = bases.length
  if (len === 0) return []
  // The amplicon may cross the origin, so it is read as a window with its own
  // coordinates and everything is worked out in those, then put back.
  const span = Math.min(len, Math.max(0, amplicon.end - amplicon.start))
  const from = ((amplicon.start % len) + len) % len
  const window = from + span <= len
    ? bases.slice(from, from + span)
    : bases.slice(from) + bases.slice(0, from + span - len)
  if (window.length === 0) return []
  const cutInWindow = ((cut - from) % len + len) % len
  if (cutInWindow > window.length) return []
  const sites = findAllSites(window, [...enzymes], 'linear')
  const byEnzyme = new Map<string, CutSite[]>()
  for (const site of sites) {
    const list = byEnzyme.get(site.enzyme.name) ?? []
    list.push(site)
    byEnzyme.set(site.enzyme.name, list)
  }

  const out: RflpOption[] = []
  for (const [, list] of byEnzyme) {
    if (list.length !== 1) continue
    const site = list[0]
    const inWindowStart = site.position
    const inWindowEnd = site.position + site.enzyme.recognition.length
    // The nuclease's cut has to fall inside the recognition sequence for an
    // indel there to disturb it.
    if (cutInWindow < inWindowStart || cutInWindow > inWindowEnd) continue
    out.push({
      enzyme: site.enzyme,
      site: {
        ...site,
        position: (from + inWindowStart) % len,
        end: (from + inWindowEnd) % len,
      },
      offset: Math.abs(cutInWindow - (inWindowStart + inWindowEnd) / 2),
      sitesInAmplicon: 1,
    })
  }
  // Closest to the middle of its site first: those are the ones an indel is
  // most certain to break.
  return out.sort((a, b) => a.offset - b.offset || a.enzyme.name.localeCompare(b.enzyme.name))
}

export interface ExpectedBands {
  label: string
  sizes: number[]
}

/**
 * What a gel should show. For an amplicon with an RFLP site: the unedited
 * copy cut in two, the edited copy whole.
 */
export function rflpBands(productSize: number, cutOffset: number): ExpectedBands[] {
  const left = Math.max(1, cutOffset)
  const right = Math.max(1, productSize - cutOffset)
  return [
    { label: 'Unedited, digested', sizes: [left, right].sort((a, b) => b - a) },
    { label: 'Edited, digested', sizes: [productSize] },
  ]
}

/** What a gel should show for a deletion between two cuts. */
export function deletionBands(productSize: number, deleted: number): ExpectedBands[] {
  return [
    { label: 'Unedited', sizes: [productSize] },
    { label: 'Deleted', sizes: [Math.max(1, productSize - deleted)] },
  ]
}
