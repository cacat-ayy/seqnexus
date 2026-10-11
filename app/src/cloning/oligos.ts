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
import { chooseOverhangSet } from './fidelity'
import { typeIISFusionSites } from './golden-gate'

export interface OligoPair {
  /** What the pair amplifies. */
  partName: string
  forward: { name: string; sequence: string; tail: string; anneal: string; tm: number }
  reverse: { name: string; sequence: string; tail: string; anneal: string; tm: number }
  warnings: string[]
  /**
   * Why this part needs no oligos: it already carries what the method would
   * have added. Not a warning, since nothing is wrong with it.
   */
  ready?: string
}

/** One piece to be amplified out of a template. */
export interface OligoTarget {
  name: string
  template: string
  topology: 'linear' | 'circular'
  /** Half-open range on the template to amplify. */
  start: number
  end: number
  /**
   * Type IIS: the fusion sites this part already carries, if it is a finished
   * part rather than a template to amplify (see `typeIISFusionSites`).
   */
  ready?: { start: string; end: string }
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
 * its reverse primer carries the start of the part after it; reverse
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

/** A part of a Type IIS design: what to amplify, and the bases it contributes. */
export interface TypeIISPart {
  target: OligoTarget
  /** The part's own bases, with any region already applied. */
  bases: string
  topology: 'linear' | 'circular'
}

export interface TypeIISPlan {
  pairs: OligoPair[]
  /** Overhangs read off the parts that already carry their sites. */
  fromParts: string[]
  /** Overhangs chosen here, for the junctions no part had fixed. */
  chosen: string[]
}

/**
 * The order finished parts assemble in, by following each part's end overhang
 * to the part that starts with it, or null when they were not all finished, a
 * step is ambiguous, or the chain does not close into a ring. Null is the
 * answer for anything the listed order has to be trusted for.
 */
function chainOrder(ready: ({ start: string; end: string } | null)[]): number[] | null {
  if (ready.length < 2 || ready.some(r => !r)) return null
  const sites = ready as { start: string; end: string }[]
  const order = [0]
  const used = new Set([0])
  for (let step = 1; step < sites.length; step++) {
    const from = sites[order[step - 1]].end
    const next = sites.flatMap((s, i) => (!used.has(i) && s.start === from ? [i] : []))
    // More than one candidate is an overhang used twice, which the assembly
    // itself warns about; no candidate is a chain that does not continue.
    if (next.length !== 1) return null
    order.push(next[0])
    used.add(next[0])
  }
  return sites[order[order.length - 1]].end === sites[order[0]].start ? order : null
}

/**
 * What a Type IIS design needs ordering, and the overhangs it runs on.
 *
 * A part that already carries its sites fixes the junction at each of its
 * ends, so those overhangs are kept rather than invented: primers built around
 * a fresh set would not fit the parts the design is actually made of. Only the
 * junctions left over are chosen, and they are chosen against the fixed ones so
 * the set as a whole still tells itself apart.
 *
 * Parts are taken to assemble in the order given, which is the order the
 * design lists them in. Two finished parts that disagree about the overhang
 * where they meet say so, since then the order is not the assembly's.
 */
export function planTypeIISOligos(
  parts: TypeIISPart[],
  enzyme: RestrictionEnzyme,
  constraints?: PrimerConstraints,
): TypeIISPlan {
  const n = parts.length
  if (n === 0) return { pairs: [], fromParts: [], chosen: [] }

  const ready = parts.map(p => typeIISFusionSites(p.bases, p.topology, enzyme))

  // Every part finished and the overhangs chain into one ring: then the order
  // is the overhangs' own, whatever order the parts were listed in, which is
  // how the assembly itself reads them. Nothing is chosen and nothing is
  // ordered, so the listed order never comes into it.
  const ring = chainOrder(ready)
  if (ring) {
    return {
      pairs: designTypeIISOligos(
        parts.map((p, i) => ({ ...p.target, ready: ready[i]! })),
        { enzyme, overhangs: ready.map(r => r!.start), constraints },
      ),
      fromParts: [...new Set(ring.flatMap(i => [ready[i]!.start, ready[i]!.end]))],
      chosen: [],
    }
  }

  // junction[i] is the overhang at the start of part i, and the end of part i-1.
  const junction: (string | null)[] = new Array(n).fill(null)
  const clashes: string[] = []
  const fix = (at: number, overhang: string, from: number, neighbour: number) => {
    const existing = junction[at]
    if (existing && existing !== overhang) {
      clashes.push(
        `${parts[from].target.name} presents ${overhang} where it meets ` +
        `${parts[neighbour].target.name}, but ${existing} is already fixed there: the parts are ` +
        'not listed in the order they assemble in.',
      )
      return
    }
    junction[at] = overhang
  }
  ready.forEach((sites, i) => {
    if (!sites) return
    // The junction at a part's start is shared with the part before it, and
    // the one at its end with the part after.
    fix(i, sites.start, i, (i - 1 + n) % n)
    fix((i + 1) % n, sites.end, i, (i + 1) % n)
  })

  const fromParts = [...new Set(junction.filter((o): o is string => o !== null))]
  // Starting from what the design already fixes is how the published
  // high-fidelity sets were built up (see ./fidelity).
  const spare = chooseOverhangSet(n, { include: fromParts }).filter(o => !fromParts.includes(o))
  const overhangs = junction.map(o => o ?? spare.shift() ?? '')

  const pairs = designTypeIISOligos(
    parts.map((p, i) => (ready[i] ? { ...p.target, ready: ready[i]! } : p.target)),
    { enzyme, overhangs, constraints },
  )
  if (clashes.length) pairs[0] = { ...pairs[0], warnings: [...pairs[0].warnings, ...clashes] }

  return { pairs, fromParts, chosen: overhangs.filter(o => o && !fromParts.includes(o)) }
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

    // A part that already carries the sites goes into the pot as it is. Giving
    // it primers would add a second pair of sites outside the first, and the
    // overhangs it is built around are the ones the assembly uses.
    if (target.ready) {
      const empty = { sequence: '', tail: '', anneal: '', tm: 0 }
      return {
        partName: target.name,
        forward: { name: `${target.name} F`, ...empty },
        reverse: { name: `${target.name} R`, ...empty },
        warnings: [],
        ready: `${target.name} already carries ${options.enzyme.name} sites and goes into the reaction ` +
          `as it is, with overhangs ${target.ready.start} and ${target.ready.end}.`,
      }
    }

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
