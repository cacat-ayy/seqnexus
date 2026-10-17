/**
 * The guide site finder: every protospacer a nuclease could target.
 *
 * It works the way the restriction enzyme finder does. The PAM is matched as
 * an IUPAC pattern on both strands, the spacer is taken from the side the
 * nuclease expects it, and a circular molecule is searched across its origin
 * so a site spanning the origin is found once, with its coordinates wrapped
 * back into the sequence.
 *
 * Direction is the only fiddly part, so it is computed once. Reading into the
 * protospacer from the PAM means walking down the sense strand for a 3' PAM on
 * the sense strand and for a 5' PAM on the antisense strand, and up it in the
 * other two cases. Everything else (the spacer span, both cut positions)
 * follows from that single sign.
 *
 * A spacer containing anything other than A, C, G or T is not returned: it
 * cannot be ordered and its scores would be meaningless. The scan counts
 * those instead, so the panel can say why a stretch of an unfinished contig
 * offers nothing.
 */

import { recognitionToRegex } from '../models/iupac'
import { reverseComplement } from '../models/complement'
import { defaultSpacerLength } from './nucleases'
import type { GuideSite, Nuclease } from './types'

export interface GuideScanOptions {
  /** Spacer length to use; defaults to the nuclease's first accepted length. */
  spacerLength?: number
  /**
   * Keep only sites whose protospacer overlaps this span (sense coordinates,
   * end exclusive). On a circular sequence a span with end <= start wraps.
   */
  region?: { start: number; end: number }
  /** Stop after this many sites. A two-base PAM on a chromosome is otherwise unbounded. */
  maxSites?: number
}

export interface GuideScan {
  sites: GuideSite[]
  /** Set when maxSites cut the scan short. */
  truncated: boolean
  /** Sites passed over because the spacer held an ambiguous base. */
  skippedAmbiguous: number
}

export const DEFAULT_MAX_SITES = 20000

const PLAIN_BASES = /^[ACGT]+$/

/** A base at a sense-strand index, wrapping on a circular molecule. */
function wrapIndex(i: number, len: number): number {
  return ((i % len) + len) % len
}

/** `len` bases from `start`, wrapping. Callers guarantee the span is in range when linear. */
function sliceWrap(bases: string, start: number, count: number, circular: boolean): string {
  if (!circular) return bases.slice(start, start + count)
  const len = bases.length
  if (count >= len) return ''
  const from = wrapIndex(start, len)
  if (from + count <= len) return bases.slice(from, from + count)
  return bases.slice(from) + bases.slice(0, from + count - len)
}

/**
 * Move one strand's PAM search on to its next match, or past the end.
 *
 * Matches are allowed to overlap, so the next search starts one base along
 * rather than after the match. A circular search looks past the origin far
 * enough for a PAM to straddle it, and a match starting at or after the
 * origin again is the same site a second time, so it ends the walk.
 */
function advance(
  cursor: { pattern: RegExp; at: number },
  searchSeq: string,
  len: number,
): void {
  const from = cursor.at < 0 ? 0 : cursor.at + 1
  cursor.pattern.lastIndex = from
  const m = cursor.pattern.exec(searchSeq)
  cursor.at = m && m.index < len ? m.index : -1
}

/** Does [start, start+count) fall inside a linear sequence? */
function inRange(start: number, count: number, len: number): boolean {
  return start >= 0 && start + count <= len
}

/** Whether a span overlaps a region, both in sense coordinates, either possibly wrapped. */
function overlapsRegion(
  start: number,
  count: number,
  region: { start: number; end: number },
  len: number,
  circular: boolean,
): boolean {
  const spans = splitSpan(start, count, len, circular)
  const regionLen = circular && region.end <= region.start
    ? region.end + len - region.start
    : region.end - region.start
  const regions = splitSpan(region.start, Math.max(0, regionLen), len, circular)
  return spans.some(s => regions.some(r => s[0] < r[1] && r[0] < s[1]))
}

/** A possibly wrapped span as one or two flat ranges. */
function splitSpan(start: number, count: number, len: number, circular: boolean): [number, number][] {
  if (count <= 0) return []
  if (!circular) return [[start, start + count]]
  const from = wrapIndex(start, len)
  if (from + count <= len) return [[from, from + count]]
  return [[from, len], [0, from + count - len]]
}

/**
 * Find every site for one nuclease.
 *
 * Coordinates follow the enzyme finder: starts are inside the sequence, and
 * an end or a cut that passes the origin of a circular molecule is wrapped,
 * so `end` can be smaller than `start` on a site that spans the origin.
 */
export function findGuideSites(
  bases: string,
  nuclease: Nuclease,
  topology: 'linear' | 'circular' = 'linear',
  options: GuideScanOptions = {},
): GuideScan {
  const upper = bases.toUpperCase()
  const len = upper.length
  const spacerLen = options.spacerLength ?? defaultSpacerLength(nuclease)
  const pamLen = nuclease.pam.length
  const maxSites = options.maxSites ?? DEFAULT_MAX_SITES
  const circular = topology === 'circular'
  const sites: GuideSite[] = []
  let skippedAmbiguous = 0

  if (len === 0 || spacerLen <= 0 || pamLen === 0) {
    return { sites, truncated: false, skippedAmbiguous }
  }
  if (!circular && len < spacerLen + pamLen) {
    return { sites, truncated: false, skippedAmbiguous }
  }
  if (circular && len <= spacerLen + pamLen) {
    return { sites, truncated: false, skippedAmbiguous }
  }

  // A circular search needs to see past the origin far enough for a PAM to
  // match across it; the spacer is then taken with wrapping slices.
  const searchSeq = circular ? upper + upper.slice(0, pamLen - 1) : upper
  const threePrime = nuclease.pamSide === 'threePrime'
  let truncated = false

  // Both strands are walked together, in position order, so that a scan the
  // site cap stops short is the first part of the sequence on both strands.
  // Finishing one strand before starting the other would make a truncated
  // list read as though the antisense strand held nothing at all.
  const cursors = ([1, -1] as const).map(strand => {
    const sensePam = strand === 1 ? nuclease.pam : reverseComplement(nuclease.pam.toUpperCase())
    const pattern = new RegExp(recognitionToRegex(sensePam), 'gi')
    const cursor = { strand, pattern, at: -1 }
    advance(cursor, searchSeq, len)
    return cursor
  })

  for (;;) {
    // The next PAM along the sequence, whichever strand it is on.
    let cursor: typeof cursors[number] | null = null
    for (const c of cursors) if (c.at >= 0 && (!cursor || c.at < cursor.at)) cursor = c
    if (!cursor) break
    const strand = cursor.strand
    const pamStartRaw = cursor.at
    advance(cursor, searchSeq, len)
    const pamEndRaw = pamStartRaw + pamLen

    // Walking from the PAM into the protospacer: down the sense strand for
    // a 3' PAM read on the sense strand, and for a 5' PAM read on the
    // antisense strand; up it otherwise.
    const dir = (strand === 1) === threePrime ? -1 : 1
    const boundary = dir === -1 ? pamStartRaw : pamEndRaw
    const spacerStartRaw = dir === -1 ? boundary - spacerLen : boundary

    if (!circular && (!inRange(spacerStartRaw, spacerLen, len) || !inRange(pamStartRaw, pamLen, len))) {
      continue
    }

    const senseSpacer = sliceWrap(upper, spacerStartRaw, spacerLen, circular)
    if (senseSpacer.length !== spacerLen) continue
    if (!PLAIN_BASES.test(senseSpacer)) {
      skippedAmbiguous++
      continue
    }
    const sensePamSeq = sliceWrap(upper, pamStartRaw, pamLen, circular)
    if (sensePamSeq.length !== pamLen) continue

    if (options.region && !overlapsRegion(spacerStartRaw, spacerLen, options.region, len, circular)) {
      continue
    }

    // Both cuts, measured from the PAM edge into the protospacer, then
    // labelled by which sense-strand they land on.
    const cutProtospacerStrand = boundary + dir * nuclease.cut.site
    const cutOther = boundary + dir * nuclease.cut.opposite
    const cutTopRaw = strand === 1 ? cutProtospacerStrand : cutOther
    const cutBottomRaw = strand === 1 ? cutOther : cutProtospacerStrand
    const offEnd = !circular && (
      cutTopRaw < 0 || cutTopRaw > len || cutBottomRaw < 0 || cutBottomRaw > len
    )

    sites.push({
      nucleaseId: nuclease.id,
      start: circular ? wrapIndex(spacerStartRaw, len) : spacerStartRaw,
      end: circular ? wrapIndex(spacerStartRaw + spacerLen, len) : spacerStartRaw + spacerLen,
      pamStart: circular ? wrapIndex(pamStartRaw, len) : pamStartRaw,
      pamEnd: circular ? wrapIndex(pamEndRaw, len) : pamEndRaw,
      strand,
      spacer: strand === 1 ? senseSpacer : reverseComplement(senseSpacer),
      pam: strand === 1 ? sensePamSeq : reverseComplement(sensePamSeq),
      cutTop: circular ? wrapIndex(cutTopRaw, len) : cutTopRaw,
      cutBottom: circular ? wrapIndex(cutBottomRaw, len) : cutBottomRaw,
      ...(offEnd ? { offEnd: true as const } : {}),
    })

    if (sites.length >= maxSites) {
      truncated = true
      break
    }
  }

  sites.sort((a, b) => a.start - b.start || a.strand - b.strand)
  return { sites, truncated, skippedAmbiguous }
}

/** Sites that actually cut, for anything that measures fragments or draws a break. */
export function cuttingGuides(sites: readonly GuideSite[], nuclease: Nuclease): GuideSite[] {
  if (nuclease.cleaves === 'none') return []
  return sites.filter(s => !s.offEnd)
}

/**
 * The blunt-end position of a site, which is what a map labels and what a
 * strategy measures distances from. For a staggered cutter it is the midpoint
 * of the two cuts, rounded down, since there is no single break there.
 */
export function cutPosition(site: GuideSite, len: number, circular: boolean): number {
  if (site.cutTop === site.cutBottom) return site.cutTop
  if (!circular) return Math.floor((site.cutTop + site.cutBottom) / 2)
  // On a circle take the short way round, so a pair straddling the origin
  // does not land on the far side of the molecule.
  const diff = ((site.cutBottom - site.cutTop) % len + len) % len
  const step = diff <= len / 2 ? Math.floor(diff / 2) : -Math.floor((len - diff) / 2)
  return wrapIndex(site.cutTop + step, len)
}

/** The spacer plus PAM as it reads on the protospacer strand, for display. */
export function siteSequence(site: GuideSite, nuclease: Nuclease): string {
  return nuclease.pamSide === 'threePrime' ? site.spacer + site.pam : site.pam + site.spacer
}
