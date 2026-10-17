/**
 * How methylation affects one cut site.
 *
 * Dam, Dcm and CpG motifs are palindromic, so each is methylated on both
 * strands. A methyl group only gets in an enzyme's way where it sits on a
 * base the enzyme reads, so a motif merely nearby changes nothing.
 *
 * Shared by the cloning digest, the virtual gel, the maps and the hover card,
 * so they all agree on which sites cut.
 */

import type { RestrictionEnzyme, MethylationSensitivity } from './db'
import type { CutSite } from './finder'

/**
 * A methylation motif and which of its bases carry the methyl group, counted
 * on the top strand: dam puts N6-methyladenine on the A of GATC (offset 1,
 * and offset 2 for the bottom strand's A); dcm puts 5-methylcytosine on the
 * inner C of CCWGG (offset 1, and offset 3 for the bottom strand); CpG
 * methylation is on the C of CG on each strand (offsets 0 and 1).
 */
interface MethylMotif {
  pattern: RegExp
  length: number
  methylated: number[]
}

const DAM: MethylMotif = { pattern: /^GATC$/, length: 4, methylated: [1, 2] }
const DCM: MethylMotif = { pattern: /^CC[AT]GG$/, length: 5, methylated: [1, 3] }
const CPG: MethylMotif = { pattern: /^CG$/, length: 2, methylated: [0, 1] }

export type MethylationKind = 'dam' | 'dcm' | 'cpg'
const MOTIFS: Record<MethylationKind, MethylMotif> = { dam: DAM, dcm: DCM, cpg: CPG }

/** The sequence a site sits in and how the document says it is methylated. */
export interface MethylationContext {
  bases: string
  topology: 'linear' | 'circular'
  dam: boolean
  dcm: boolean
}

/** A document's methylation context: its bases and its Sequence Properties flags. */
export function methylationContextOf(doc: {
  sequence: { bases: string; topology: 'linear' | 'circular' }
  metadata?: { damMethylated?: boolean; dcmMethylated?: boolean } | null
}): MethylationContext {
  return {
    bases: doc.sequence.bases,
    topology: doc.sequence.topology,
    dam: doc.metadata?.damMethylated ?? false,
    dcm: doc.metadata?.dcmMethylated ?? false,
  }
}

/**
 * Whether a methylated base of a `kind` motif lies inside the recognition
 * site that starts at `siteStart`.
 */
export function motifInSite(
  bases: string,
  topology: 'linear' | 'circular',
  siteStart: number,
  siteLength: number,
  kind: MethylationKind,
): boolean {
  const motif = MOTIFS[kind]
  const seqLen = bases.length
  if (seqLen === 0) return false
  const circular = topology === 'circular'
  for (let m = siteStart - motif.length + 1; m < siteStart + siteLength; m++) {
    if (!motif.methylated.some(o => m + o >= siteStart && m + o < siteStart + siteLength)) continue
    let window = ''
    for (let i = m; i < m + motif.length; i++) {
      if (!circular && (i < 0 || i >= seqLen)) { window = ''; break }
      window += bases[((i % seqLen) + seqLen) % seqLen]
    }
    if (window && motif.pattern.test(window.toUpperCase())) return true
  }
  return false
}

export interface SiteMethylationEffect {
  effect: 'blocked' | 'impaired'
  by: 'dam' | 'dcm'
  /** Blocked for want of a methylation the enzyme needs (DpnI on a PCR product). */
  unmethylated?: true
}

/** How Dam and Dcm methylation affect one site: blocked, impaired, or not at all. */
export function siteMethylationEffect(site: CutSite, ctx: MethylationContext): SiteMethylationEffect | null {
  const enzyme = site.enzyme
  const reaches = (kind: MethylationKind) =>
    motifInSite(ctx.bases, ctx.topology, site.position, enzyme.recognition.length, kind)
  // DpnI and the like cut only where the methylation is there.
  if (enzyme.dam === 'required' && !(ctx.dam && reaches('dam'))) return { effect: 'blocked', by: 'dam', unmethylated: true }
  if (enzyme.dcm === 'required' && !(ctx.dcm && reaches('dcm'))) return { effect: 'blocked', by: 'dcm', unmethylated: true }
  const sensitive = (flag: RestrictionEnzyme['dam']) => flag === 'blocked' || flag === 'impaired'
  const damHit = ctx.dam && sensitive(enzyme.dam) && reaches('dam')
  const dcmHit = ctx.dcm && sensitive(enzyme.dcm) && reaches('dcm')
  if (damHit && enzyme.dam === 'blocked') return { effect: 'blocked', by: 'dam' }
  if (dcmHit && enzyme.dcm === 'blocked') return { effect: 'blocked', by: 'dcm' }
  if (damHit) return { effect: 'impaired', by: 'dam' }
  if (dcmHit) return { effect: 'impaired', by: 'dcm' }
  return null
}

const KIND_NAME: Record<MethylationKind, string> = { dam: 'Dam', dcm: 'Dcm', cpg: 'CpG' }

/** A site's methylation effect in words, for hover cards and lists. */
export function siteMethylationNote(effect: SiteMethylationEffect): string {
  const name = KIND_NAME[effect.by]
  if (effect.unmethylated) return `Cuts only ${name}-methylated DNA`
  return `${effect.effect === 'blocked' ? 'Blocked' : 'Impaired'} by ${name} methylation here`
}

/** What methylation does to one enzyme's sites in a sequence, for a list row. */
export interface MethylationSummary {
  /** The effect at each site, in the order given; null where it cuts freely or does not cut at all. */
  effects: (SiteMethylationEffect | null)[]
  /** Sites that cut, and of those how many methylation blocks or impairs. */
  total: number
  blocked: number
  impaired: number
  /** The row's tag ("blocked", "2/3 blocked", "impaired"), or null when no site is affected. */
  tag: string | null
  /** The effect in words, for the row's tooltip. */
  note: string | null
}

/**
 * One enzyme's sites summarized by the per-site rule, so a list says an
 * enzyme is blocked only where its sites are: XbaI on Dam-methylated DNA is
 * blocked at a TCTAGATC and cuts every other TCTAGA.
 */
export function summarizeMethylation(sites: readonly CutSite[], ctx: MethylationContext): MethylationSummary {
  const effects = sites.map(s => (s.offEnd ? null : siteMethylationEffect(s, ctx)))
  const total = sites.filter(s => !s.offEnd).length
  const blocked = effects.filter(e => e?.effect === 'blocked').length
  const impaired = effects.filter(e => e?.effect === 'impaired').length
  const first = effects.find(e => e !== null) ?? null
  const share = (n: number) => (n === total ? '' : `${n}/${total} `)
  const tag = blocked > 0 ? `${share(blocked)}blocked` : impaired > 0 ? `${share(impaired)}impaired` : null
  let note: string | null = null
  const at = (n: number) => (n === total ? (total === 1 ? 'its site' : 'every site') : `${n} of ${total} sites`)
  if (first?.unmethylated) {
    // MspJI on Dcm-methylated DNA: cuts where a methylated C is in the site, not elsewhere.
    const needs = `Cuts only ${KIND_NAME[first.by]}-methylated DNA`
    note = blocked === total ? needs : `${needs}: none at ${at(blocked)}`
  } else if (first) {
    const parts: string[] = []
    if (blocked > 0) parts.push(`blocked at ${at(blocked)}`)
    if (impaired > 0) parts.push(`impaired at ${at(impaired)}`)
    const kinds = [...new Set(effects.flatMap(e => (e ? [KIND_NAME[e.by]] : [])))].join(' and ')
    note = `${kinds} methylation: ${parts.join(', ')}`
  }
  return { effects, total, blocked, impaired, tag, note }
}

/** One line of the hover card's methylation row: a kind the enzyme cares about, at this site. */
export interface MethylationLine {
  text: string
  tone: 'danger' | 'warning' | 'muted'
}

/**
 * What each methylation the enzyme is sensitive to does at this one site.
 * A sensitivity whose motif does not reach the site is "not affected here",
 * whatever the enzyme's flag says, so a red flag means this site.
 */
export function siteMethylationLines(site: CutSite, ctx: MethylationContext): MethylationLine[] {
  const enzyme = site.enzyme
  const lines: MethylationLine[] = []
  const len = enzyme.recognition.length
  const on: Record<MethylationKind, boolean> = { dam: ctx.dam, dcm: ctx.dcm, cpg: false }
  for (const kind of ['dam', 'dcm', 'cpg'] as const) {
    const flag: MethylationSensitivity | undefined = enzyme[kind]
    if (flag !== 'blocked' && flag !== 'impaired' && flag !== 'required') continue
    const name = KIND_NAME[kind]
    const here = motifInSite(ctx.bases, ctx.topology, site.position, len, kind)
    if (flag === 'required') {
      lines.push(
        !here ? { text: `${name}: no motif here, so no cut`, tone: 'danger' }
        : on[kind] ? { text: `${name}: methylated here, so it cuts`, tone: 'muted' }
        : { text: `${name}: cuts only if ${name}-methylated`, tone: 'danger' })
    } else if (!here) {
      lines.push({ text: `${name}: not affected here`, tone: 'muted' })
    } else if (on[kind]) {
      lines.push({ text: `${name}: ${flag} here`, tone: flag === 'blocked' ? 'danger' : 'warning' })
    } else {
      // CpG methylation is never marked (E. coli does not make it), so it reads as a condition.
      lines.push({ text: `${name}: ${flag} here if ${name}-methylated`, tone: kind === 'cpg' ? 'muted' : 'warning' })
    }
  }
  return lines
}
