/**
 * The oligos a cloning design needs ordering.
 *
 * Two jobs, both of which are "amplify this piece and hang something off the
 * 5' ends":
 *
 * - **Seamless assembly.** Each junction needs an arm copied from the
 *   neighbour, so the two pieces share a stretch for the exonuclease to chew
 *   back to. Which neighbour, and how long, comes from the kit (./kits).
 * - **Type IIS assembly.** Each end needs the enzyme's recognition site
 *   pointing inwards, a spacer base, and the four-base overhang that decides
 *   where the part goes. The sites end up outside the product and are lost
 *   with the cut, which is why the assembly is seamless and one-pot.
 *
 * The binding part of each primer is sized by the existing designer, so these
 * oligos melt where the rest of the app's primers do.
 */

import { reverseComplement } from '../models/complement'
import type { RestrictionEnzyme } from '../enzymes/db'
import { designTailedPair, type TailedPair } from '../primers/design/cloning'
import { DEFAULT_CONSTRAINTS, type PrimerConstraints } from '../primers/scoring'
import { calcTm } from '../primers/thermodynamics'
import { KITS, targetOverlap, type KitId } from './kits'

export interface OligoPair {
  /** What the pair amplifies. */
  partName: string
  forward: { name: string; sequence: string; tail: string; anneal: string; tm: number }
  reverse: { name: string; sequence: string; tail: string; anneal: string; tm: number }
  warnings: string[]
}

/** One piece to be amplified out of a template. */
export interface OligoTarget {
  name: string
  template: string
  topology: 'linear' | 'circular'
  /** Half-open range on the template to amplify. */
  start: number
  end: number
}

function named(pair: TailedPair, partName: string): OligoPair {
  return {
    partName,
    forward: { name: `${partName} F`, ...pair.forward },
    reverse: { name: `${partName} R`, ...pair.reverse },
    warnings: pair.warnings,
  }
}

/** Bases read from a template, wrapping the origin of a circular one. */
function read(template: string, start: number, length: number, circular: boolean): string {
  const n = template.length
  if (length <= 0) return ''
  if (!circular) return template.slice(Math.max(0, start), Math.max(0, start) + length)
  let out = ''
  for (let i = start; i < start + length; i++) out += template[((i % n) + n) % n]
  return out
}

/**
 * Primers for a ring of parts joined by homology.
 *
 * Each part's forward primer carries the tail end of the part before it, and
 * its reverse primer carries the start of the part after it — reverse
 * complemented, since a reverse primer is written along the bottom strand.
 * Together that gives every junction one shared stretch, contributed half by
 * each neighbour, which is what the chew-back needs.
 */
export function designAssemblyOligos(
  targets: OligoTarget[],
  options: { kit?: KitId; overlap?: number; constraints?: PrimerConstraints } = {},
): OligoPair[] {
  const kit = KITS[options.kit ?? 'hifi']
  const constraints = options.constraints ?? DEFAULT_CONSTRAINTS
  const armTotal = options.overlap ?? targetOverlap(kit, targets.length)
  // Half the shared stretch is carried by each neighbour's primer.
  const arm = Math.max(1, Math.round(armTotal / 2))

  return targets.map((target, index) => {
    const before = targets[(index - 1 + targets.length) % targets.length]
    const after = targets[(index + 1) % targets.length]
    const circularBefore = before.topology === 'circular'
    const circularAfter = after.topology === 'circular'

    // The last bases of the part before this one, as they read on the top
    // strand: the forward primer adds them ahead of its binding part.
    const fwdTail = read(before.template, before.end - arm, arm, circularBefore)
    // The first bases of the part after this one, reverse complemented.
    const revTail = reverseComplement(read(after.template, after.start, arm, circularAfter))

    const pair = designTailedPair(
      target.template,
      target.topology,
      { start: target.start, end: target.end },
      fwdTail,
      revTail,
      constraints,
    )
    if ('error' in pair) {
      return {
        partName: target.name,
        forward: { name: `${target.name} F`, sequence: '', tail: fwdTail, anneal: '', tm: 0 },
        reverse: { name: `${target.name} R`, sequence: '', tail: revTail, anneal: '', tm: 0 },
        warnings: [pair.error],
      }
    }

    const result = named(pair, target.name)
    // The junction's own melting temperature is what the kit cares about, and
    // it comes from both halves together, not from either primer's tail.
    const junction = fwdTail + read(target.template, target.start, arm, target.topology === 'circular')
    const tm = calcTm(junction)
    if (kit.minTm !== null && tm < kit.minTm) {
      result.warnings.push(
        `The junction before ${target.name} melts at ${tm.toFixed(1)} °C, below the ${kit.minTm} °C ` +
        `${kit.name} needs: use a longer arm.`,
      )
    }
    return result
  })
}

export interface TypeIISOligoOptions {
  enzyme: RestrictionEnzyme
  /**
   * The overhang each part should present, in order: entry[i] is the overhang
   * at the start of part i, and the end of part i-1. One per part, so a ring
   * of three parts takes three overhangs.
   */
  overhangs: string[]
  /** Bases between the recognition site and the cut. Default a single A. */
  spacer?: string
  constraints?: PrimerConstraints
}

/**
 * Primers for a Type IIS assembly.
 *
 * Each primer's tail is the recognition site pointing into the part, a spacer
 * so the enzyme cuts where it should, and the overhang. The reverse primer's
 * tail is built the same way and then reverse complemented, so the enzyme
 * reads inwards from that end too.
 */
export function designTypeIISOligos(
  targets: OligoTarget[],
  options: TypeIISOligoOptions,
): OligoPair[] {
  const constraints = options.constraints ?? DEFAULT_CONSTRAINTS
  const spacer = options.spacer ?? 'A'
  const site = options.enzyme.recognition.toUpperCase()
  // How far past the recognition site the enzyme cuts, and how wide the
  // overhang it leaves is, both taken from the enzyme itself.
  const reach = Math.max(0, options.enzyme.fwd_cut - site.length)
  const padding = spacer.repeat(Math.max(1, reach)).slice(0, Math.max(1, reach))

  return targets.map((target, index) => {
    const startOverhang = (options.overhangs[index] ?? '').toUpperCase()
    const endOverhang = (options.overhangs[(index + 1) % options.overhangs.length] ?? '').toUpperCase()

    const fwdTail = site + padding + startOverhang

    // At the far end the enzyme has to read inwards too, which on the top
    // strand means the overhang, the spacer, then the site reversed. The
    // reverse primer is that stretch read along the bottom strand, so it
    // comes out as the site the right way round again, followed by the
    // complement of the overhang.
    const revTail = site + reverseComplement(padding) + reverseComplement(endOverhang)

    const pair = designTailedPair(
      target.template,
      target.topology,
      { start: target.start, end: target.end },
      fwdTail,
      revTail,
      constraints,
    )
    if ('error' in pair) {
      return {
        partName: target.name,
        forward: { name: `${target.name} F`, sequence: '', tail: fwdTail, anneal: '', tm: 0 },
        reverse: { name: `${target.name} R`, sequence: '', tail: revTail, anneal: '', tm: 0 },
        warnings: [pair.error],
      }
    }

    const result = named(pair, target.name)
    // A site left inside the part would be cut in the reaction, which no
    // amount of good primer design can rescue.
    const body = read(
      target.template,
      target.start,
      target.end > target.start ? target.end - target.start : target.template.length - target.start + target.end,
      target.topology === 'circular',
    )
    const rc = reverseComplement(site)
    if (body.toUpperCase().includes(site) || body.toUpperCase().includes(rc)) {
      result.warnings.push(
        `${target.name} contains an internal ${options.enzyme.name} site: it will be cut during the ` +
        'assembly. Remove it first, by a silent change if it falls in coding sequence.',
      )
    }
    return result
  })
}
