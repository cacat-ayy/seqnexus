/**
 * Prime editing guides.
 *
 * A pegRNA is an ordinary guide with a tail: after the scaffold comes a
 * template for the edit, and after that a short stretch that pairs with the
 * nicked strand and primes the copying. The tail is written 3' of the
 * scaffold and reads as the reverse complement of the strand that will be
 * made, which is the part that is easy to get backwards, so it is built once
 * here and the pieces are reported separately.
 *
 * The construction, in the protospacer strand's own frame:
 *
 *   nick            3 bases in from the PAM, where the nickase cuts
 *   primer site     the bases just before the nick, reverse complemented
 *   template        the edited sequence from the nick onwards, reverse
 *                   complemented, long enough to carry the edit and some
 *                   way past it
 *   pegRNA          spacer + scaffold + template + primer site
 *
 * The edit itself is given as a span to replace and what to put there, which
 * covers a substitution, an insertion and a deletion without three cases.
 */

import { reverseComplement } from '../models/complement'
import { gcFraction } from './score/rules'
import type { GuideCandidate } from './types'

export interface PrimeEdit {
  /** The span of the sequence to replace, in sequence coordinates. */
  start: number
  end: number
  /** What goes there, on the sense strand. Empty for a deletion. */
  replacement: string
}

export interface PegSettings {
  /** Bases of the primer binding site; 13 suits most targets. */
  pbsLength: number
  /** Bases of template after the edit, before the primer site. */
  homologyAfterEdit: number
  /** The scaffold between the spacer and the tail. */
  scaffold: string
  /** Scaffold side, which prime editing always has after the spacer. */
  scaffoldSide?: 'after' | 'before'
}

export const DEFAULT_PEG: Omit<PegSettings, 'scaffold'> = {
  pbsLength: 13,
  homologyAfterEdit: 12,
}

/** Primer binding sites outside this band are worth a word. */
export const PBS_BAND = { low: 8, high: 17 } as const
/** GC of the primer binding site that the usual length suits. */
export const PBS_GC_BAND = { low: 0.4, high: 0.6 } as const

export interface PegRna {
  candidate: GuideCandidate
  /** Where the nickase cuts, in sequence coordinates. */
  nick: number
  spacer: string
  scaffold: string
  /** The template, 5' to 3' as it appears in the pegRNA. */
  template: string
  /** The primer binding site, 5' to 3' as it appears in the pegRNA. */
  pbs: string
  /** Everything after the scaffold. */
  extension: string
  /** The whole thing, as DNA. */
  sequence: string
  /** What the edit does to the sequence, for the panel to show. */
  edit: PrimeEdit
  /** Bases of template past the edit. */
  homology: number
  warnings: string[]
}

/** The strand the protospacer reads on, as a window of sequence with an index. */
function strandWindow(bases: string, site: GuideCandidate['site'], pad: number) {
  const seq = bases.toUpperCase()
  if (site.strand === 1) {
    const from = Math.max(0, site.start - pad)
    const to = Math.min(seq.length, site.end + pad)
    return { text: seq.slice(from, to), offset: from, flip: false }
  }
  // Reading the antisense strand 5' to 3' runs down the sense coordinates, so
  // the window is reverse complemented and positions mirror inside it.
  const from = Math.max(0, site.start - pad)
  const to = Math.min(seq.length, site.end + pad)
  return { text: reverseComplement(seq.slice(from, to)), offset: from, flip: true, span: to - from }
}

/** A sense-strand position as an index into the strand window. */
function toWindow(w: ReturnType<typeof strandWindow>, pos: number): number {
  return w.flip ? (w.span ?? 0) - (pos - w.offset) : pos - w.offset
}

/**
 * Design a pegRNA for one guide and one edit.
 *
 * Returns null when the edit is not downstream of the nick on the
 * protospacer strand, which is the one arrangement prime editing cannot use:
 * the template is copied from the nick onwards, so an edit behind it cannot
 * be written.
 */
export function designPegRna(
  candidate: GuideCandidate,
  bases: string,
  edit: PrimeEdit,
  settings: PegSettings,
): PegRna | null {
  const site = candidate.site
  const spacer = site.spacer.toUpperCase()
  // The nickase cuts where this nuclease cuts, on the protospacer strand.
  const nickSense = site.strand === 1 ? site.cutTop : site.cutBottom
  const pad = Math.max(200, settings.pbsLength + settings.homologyAfterEdit + edit.replacement.length + 100)
  const w = strandWindow(bases, site, pad)
  const nick = toWindow(w, nickSense)
  const editStart = toWindow(w, w.flip ? edit.end : edit.start)
  const editEnd = toWindow(w, w.flip ? edit.start : edit.end)
  if (editStart < 0 || editEnd > w.text.length || editStart > editEnd) return null
  if (editStart < nick) return null

  const replacement = (w.flip ? reverseComplement(edit.replacement) : edit.replacement).toUpperCase()
  const edited = w.text.slice(0, editStart) + replacement + w.text.slice(editEnd)
  // After the edit the template keeps copying, so it needs room for both.
  const templateLength = (editStart - nick) + replacement.length + settings.homologyAfterEdit
  const templateSense = edited.slice(nick, nick + templateLength)
  if (templateSense.length < templateLength) return null

  const pbsSource = w.text.slice(Math.max(0, nick - settings.pbsLength), nick)
  const pbs = reverseComplement(pbsSource)
  const template = reverseComplement(templateSense)
  const extension = template + pbs
  const scaffold = settings.scaffold.toUpperCase()

  const warnings: string[] = []
  if (settings.pbsLength < PBS_BAND.low || settings.pbsLength > PBS_BAND.high) {
    warnings.push(`A primer site of ${settings.pbsLength} bases is outside the usual ${PBS_BAND.low} to ${PBS_BAND.high}.`)
  }
  const pbsGc = gcFraction(pbs)
  if (pbsGc < PBS_GC_BAND.low) {
    warnings.push('The primer site is AT rich, so a longer one usually primes better.')
  } else if (pbsGc > PBS_GC_BAND.high) {
    warnings.push('The primer site is GC rich, so a shorter one is usually enough.')
  }
  if (settings.homologyAfterEdit < 5) {
    warnings.push('Very little template past the edit; the repair has almost nothing to pair with.')
  }
  if (template.startsWith('C')) {
    warnings.push('The template ends on a C at its 5′ end, which is reported to lower editing.')
  }
  if (edit.replacement.length === 0 && edit.end === edit.start) {
    warnings.push('The edit changes nothing.')
  }

  return {
    candidate,
    nick: nickSense,
    spacer,
    scaffold,
    template,
    pbs,
    extension,
    sequence: spacer + scaffold + extension,
    edit,
    homology: settings.homologyAfterEdit,
    warnings,
  }
}

export interface NickingGuide {
  candidate: GuideCandidate
  /** Distance from the pegRNA's nick, along the sequence. */
  distance: number
  /** Whether it nicks the other strand, which is what the strategy needs. */
  opposite: boolean
}

/** The band of distances a second nick is usually put in. */
export const NICK_BAND = { low: 40, high: 90 } as const

/**
 * Candidates for the second nick.
 *
 * It has to be on the other strand, far enough from the first that the two
 * nicks are not a double-strand break, and near enough to help. The band is
 * a setting because it is a rule of thumb, not a law.
 */
export function nickingGuides(
  candidates: readonly GuideCandidate[],
  peg: PegRna,
  band: { low: number; high: number } = NICK_BAND,
): NickingGuide[] {
  const pegStrand = peg.candidate.site.strand
  const out: NickingGuide[] = []
  for (const candidate of candidates) {
    if (candidate.site.offEnd) continue
    const nick = candidate.site.strand === 1 ? candidate.site.cutTop : candidate.site.cutBottom
    const distance = Math.abs(nick - peg.nick)
    if (distance < band.low || distance > band.high) continue
    out.push({ candidate, distance, opposite: candidate.site.strand !== pegStrand })
  }
  return out
    .filter(n => n.opposite)
    .sort((a, b) => {
      const mid = (band.low + band.high) / 2
      return Math.abs(a.distance - mid) - Math.abs(b.distance - mid)
    })
}

/** What the sequence looks like once the edit is in, for the panel to show. */
export function editedSequence(bases: string, edit: PrimeEdit): string {
  return bases.slice(0, edit.start) + edit.replacement.toUpperCase() + bases.slice(edit.end)
}

/** The edit in the shorthand the panel prints: 12A>G, 20_21insTTT, 30_35del. */
export function describeEdit(edit: PrimeEdit, bases: string): string {
  const from = bases.slice(edit.start, edit.end).toUpperCase()
  const to = edit.replacement.toUpperCase()
  const at = edit.start + 1
  if (from.length === 1 && to.length === 1) return `${at}${from}>${to}`
  if (from.length === 0) return `${at}_${at + 1}ins${to}`
  if (to.length === 0) return `${at}_${edit.end}del`
  return `${at}_${edit.end}delins${to}`
}
