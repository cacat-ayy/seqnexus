/**
 * What a variant does to the coding features it falls in, named as HGVS
 * names it.
 *
 * Each coding feature (CDS or ORF) is read as its ribosome reads it: its
 * exons joined (a spliced CDS skips its introns), on its own strand, from
 * its /codon_start, with its own genetic code (/transl_table), and read on
 * past its end into the sequence that follows. The variant is applied to
 * that coding sequence and both are translated; the effect is what changed
 * between the two proteins, not what the variant's length suggests:
 *
 * - A substitution or an in-frame indel is judged on the codons it touches:
 *   no change is synonymous, a new stop is nonsense, a lost stop reads on
 *   to the next one (an extension), a lost start codon is start lost.
 * - A frameshift is followed to the first residue that differs and on to
 *   the stop the new frame meets, giving "K45Rfs*12".
 * - A variant in an intron of a spliced CDS is an intron variant, or a
 *   splice site variant within SPLICE_SITE bases of an exon (the GT donor
 *   and AG acceptor), or when it takes in both intron and exon.
 *
 * Insertions and deletions are moved as far 3' as the sequence allows
 * within their exon before they are named (the HGVS 3' rule), and an
 * insertion that repeats the bases before it is named a duplication. So a
 * deleted A in AAAA is c.4del, whatever position the caller gave it.
 */

import { reverseComplement } from '../models/complement'
import { geneticCode, translateCodonWith, type GeneticCode } from '../codon/genetic-codes'
import { threeLetter } from '../protein/variants'
import type { RefFeature, VariantType } from './variants'

export type Effect =
  | 'Start lost' | 'Nonsense' | 'Frameshift' | 'Stop lost' | 'Splice site'
  | 'In-frame deletion' | 'In-frame insertion' | 'Missense' | 'Synonymous' | 'Intron'

/** Most severe first: the order a variant's changes are listed in and the effect column sorts by. */
export const EFFECT_ORDER: readonly Effect[] = [
  'Start lost', 'Nonsense', 'Frameshift', 'Stop lost', 'Splice site',
  'In-frame deletion', 'In-frame insertion', 'Missense', 'Synonymous', 'Intron',
]

/** How much an effect is likely to matter to the protein, for coloring it. */
export function effectSeverity(e: Effect): 'severe' | 'moderate' | 'mild' {
  if (e === 'Synonymous' || e === 'Intron') return 'mild'
  if (e === 'Missense' || e === 'In-frame deletion' || e === 'In-frame insertion') return 'moderate'
  return 'severe'
}

export interface CodingChange {
  feature: string
  /** HGVS coding DNA change in the feature's own numbering: "c.134A>G", "c.7dup", "c.88+1G>T". */
  cdna: string
  /** The protein change in the short one-letter form: "K45E", "W4*", "K45Rfs*12", "M1?". Empty in an intron. */
  protein: string
  /** The protein change in the recommended three-letter form, predicted so in parentheses: "p.(Lys45Glu)". */
  hgvsp: string
  effect: Effect
  /** The codons before and after a substitution. */
  codonFrom?: string
  codonTo?: string
}

/** "K45E (missense)", or just the effect when there is no protein change to name. */
export function codingLabel(c: CodingChange): string {
  return c.protein ? `${c.protein} (${c.effect.toLowerCase()})` : c.effect.toLowerCase()
}

/** "gfp: c.134A>G p.(Lys45Glu), missense": the whole change in one line. */
export function codingSummary(c: CodingChange): string {
  return `${c.feature}: ${c.cdna} ${c.hgvsp}, ${c.effect.toLowerCase()}`
}

/** A variant's coding changes, most severe first. */
export function allCoding(v: { coding: CodingChange | null; otherCoding: readonly CodingChange[] }): CodingChange[] {
  return v.coding ? [v.coding, ...v.otherCoding] : []
}

export const CODING = new Set(['CDS', 'ORF'])

/** Bases read past a coding feature's end, to find the stop a frameshift or a lost stop now reaches. */
export const READ_ON = 3000

/** Intron bases at each end that make up the splice site. */
export const SPLICE_SITE = 2

const mod = (a: number, n: number) => ((a % n) + n) % n

/** An exon in reading order: the genomic index of its first base read, and its offset in the coding sequence. */
interface Exon { first: number; len: number; off: number }

/** A coding feature as it is read. */
interface Transcript {
  name: string
  strand: 1 | -1
  exons: Exon[]
  /** Bases in the exons, the ones before the first codon included. */
  len: number
  /** Bases before the first codon (/codon_start minus 1). */
  frame: number
  /** The exons' bases 5' to 3' on the feature's strand, then up to READ_ON bases read on past its end. */
  seq: string
  code: GeneticCode
  /** Codons read as methionine when they open the feature. */
  starts: readonly string[]
  L: number
  circular: boolean
}

/** Where a reference position falls in a transcript. */
type Place =
  /** An index into `seq`: negative before the first exon, past `len` after the last. */
  | { at: number }
  /** In the intron after exon `exon`, d5 bases into it from that exon and d3 from the next. */
  | { exon: number; d5: number; d3: number }

const cache = new WeakMap<RefFeature, { refSeq: string; circular: boolean; t: Transcript | null }>()

function transcriptOf(f: RefFeature, refSeq: string, circular: boolean): Transcript | null {
  const hit = cache.get(f)
  if (hit && hit.refSeq === refSeq && hit.circular === circular) return hit.t
  const t = buildTranscript(f, refSeq, circular)
  cache.set(f, { refSeq, circular, t })
  return t
}

function buildTranscript(f: RefFeature, refSeq: string, circular: boolean): Transcript | null {
  const L = refSeq.length
  if (L === 0 || f.strand === 0) return null
  const strand = f.strand
  const spans = f.segments?.length ? f.segments : [[f.start, f.end] as [number, number]]
  // Bases from s for n, across the origin of a circular sequence.
  const stretch = (s: number, n: number): string => {
    if (n <= 0) return ''
    if (!circular) return refSeq.slice(Math.max(0, s), Math.max(0, s + n))
    const a = mod(s, L)
    return a + n <= L ? refSeq.slice(a, a + n) : refSeq.slice(a) + refSeq.slice(0, Math.min(L, a + n - L))
  }
  const parts = spans.map(([s, e]) => ({ s, len: s <= e ? e - s : L - s + e })).filter(p => p.len > 0)
  if (parts.length === 0) return null
  const ordered = strand === 1 ? parts : [...parts].reverse()
  const exons: Exon[] = []
  let off = 0
  let seq = ''
  for (const p of ordered) {
    exons.push({ first: strand === 1 ? p.s : mod(p.s + p.len - 1, L), len: p.len, off })
    const bases = stretch(p.s, p.len)
    seq += strand === 1 ? bases : reverseComplement(bases)
    off += p.len
  }
  // Read on past the end, into what follows on the feature's strand.
  const last = ordered[ordered.length - 1]
  if (strand === 1) {
    const end = last.s + last.len
    seq += stretch(end, circular ? Math.min(READ_ON, L) : Math.min(READ_ON, L - end))
  } else {
    const n = circular ? Math.min(READ_ON, L) : Math.min(READ_ON, last.s)
    seq += reverseComplement(stretch(last.s - n, n))
  }
  const code = geneticCode(f.code ?? 1)
  return {
    name: f.name, strand, exons, len: off, frame: f.frame ?? 0, seq: seq.toUpperCase(), code,
    // Without a /transl_table only ATG is taken as the start.
    starts: f.code ? code.starts : ['ATG'],
    L, circular,
  }
}

function placeOf(t: Transcript, p: number): Place | null {
  const { L, strand, exons, circular } = t
  if (!circular && (p < 0 || p >= L)) return null
  p = mod(p, L)
  const along = (from: number, to: number) => (strand === 1 ? mod(to - from, L) : mod(from - to, L))
  for (const x of exons) {
    const k = along(x.first, p)
    if (k < x.len) return { at: x.off + k }
  }
  for (let j = 0; j + 1 < exons.length; j++) {
    const a = exons[j]
    const lastA = mod(a.first + strand * (a.len - 1), L)
    const gap = along(lastA, exons[j + 1].first) - 1
    const d5 = along(lastA, p)
    if (d5 >= 1 && d5 <= gap) return { exon: j, d5, d3: gap - d5 + 1 }
  }
  // Before the first exon, or after the last, whichever is nearer.
  const first = exons[0].first
  const lx = exons[exons.length - 1]
  const lastBase = mod(lx.first + strand * (lx.len - 1), L)
  const up = circular ? along(p, first) : strand === 1 ? first - p : p - first
  const down = circular ? along(lastBase, p) : strand === 1 ? p - lastBase : lastBase - p
  const upOk = up >= 1 && up <= READ_ON
  const downOk = down >= 1 && t.len + down - 1 < t.seq.length
  if (upOk && (!downOk || up < down)) return { at: -up }
  if (downOk) return { at: t.len + down - 1 }
  return null
}

/** HGVS c. position of an index into `seq`: "45", "-3" before the first codon, "*7" past the last. */
function cPos(t: Transcript, i: number): string {
  const j = i - t.frame
  const n = t.len - t.frame
  if (j < 0) return String(j)
  if (j < n) return String(j + 1)
  return `*${j - n + 1}`
}

/** HGVS c. position of any place: in an intron, counted from the nearer exon ("88+1", "89-2"). */
function placePos(t: Transcript, pl: Place): string {
  if ('at' in pl) return cPos(t, pl.at)
  const a = t.exons[pl.exon]
  const b = t.exons[pl.exon + 1]
  return pl.d5 <= pl.d3 ? `${cPos(t, a.off + a.len - 1)}+${pl.d5}` : `${cPos(t, b.off)}-${pl.d3}`
}

/**
 * The coding changes of a variant in the coding features it falls in, most
 * severe first. `refStart` is the first reference base changed, or for an
 * insertion the base after it; `ref` and `alt` are on the forward strand.
 */
export function codingChanges(
  type: VariantType,
  refStart: number,
  ref: string,
  alt: string,
  feats: readonly RefFeature[],
  refSeq: string,
  circular = false,
): CodingChange[] {
  const out: CodingChange[] = []
  for (const f of feats) {
    if (!CODING.has(f.type) || f.strand === 0) continue
    const t = transcriptOf(f, refSeq, circular)
    const c = t ? changeIn(t, type, refStart, ref.toUpperCase(), alt.toUpperCase()) : null
    if (c) out.push(c)
  }
  return out.sort((a, b) => EFFECT_ORDER.indexOf(a.effect) - EFFECT_ORDER.indexOf(b.effect))
}

function changeIn(t: Transcript, type: VariantType, g0: number, ref: string, alt: string): CodingChange | null {
  const oriented = (s: string) => (t.strand === 1 ? s : reverseComplement(s))
  const ins = oriented(alt)
  let places: (Place | null)[]
  if (type === 'Insertion') {
    // The bases either side, in reading order.
    places = [placeOf(t, g0 - 1), placeOf(t, g0)]
    if (t.strand === -1) places.reverse()
  } else {
    places = Array.from({ length: Math.max(1, ref.length) }, (_, k) => placeOf(t, g0 + k))
    if (t.strand === -1) places.reverse()
  }
  if (places.some(p => p === null)) return null
  const ps = places as Place[]
  const exonic = ps.every(p => 'at' in p)
  if (!exonic) return intronChange(t, type, ps, oriented(ref), ins)
  const idx = ps.map(p => (p as { at: number }).at)
  for (let k = 1; k < idx.length; k++) if (idx[k] !== idx[k - 1] + 1) return null
  if (type === 'Insertion') return exonChange(t, idx[1], 0, ins)
  return exonChange(t, idx[0], idx.length, ins)
}

function intronChange(t: Transcript, type: VariantType, ps: Place[], ref: string, ins: string): CodingChange {
  // Touching an exon too, or within the splice site, it is a splice site variant.
  const near = ps.some(p => 'at' in p || Math.min(p.d5, p.d3) <= SPLICE_SITE)
  const first = placePos(t, ps[0])
  const last = placePos(t, ps[ps.length - 1])
  const cdna = type === 'SNP' ? `c.${first}${ref}>${ins}`
    : type === 'Insertion' ? `c.${first}_${last}ins${ins}`
    : `c.${first}${ps.length > 1 ? `_${last}` : ''}del`
  return { feature: t.name, cdna, protein: '', hgvsp: near ? 'p.?' : 'p.(=)', effect: near ? 'Splice site' : 'Intron' }
}

/** The residue of codon k of `s` (read from the first codon); '' past its end. */
function residue(t: Transcript, s: string, k: number): string {
  const codon = s.slice(k * 3, k * 3 + 3)
  if (codon.length < 3) return ''
  // The first codon of a CDS that starts whole is read as methionine when
  // it is one of its code's start codons (GTG and TTG in bacteria).
  if (k === 0 && t.frame === 0 && t.starts.includes(codon)) return 'M'
  return translateCodonWith(t.code, codon)
}

function residues(t: Transcript, s: string, from: number, to: number): string {
  let out = ''
  for (let k = from; k < to; k++) out += residue(t, s, k) || ''
  return out
}

/** Codons from k on in `s` until the first stop; its 1-based place counted from k, or '?' when it never comes. */
function stopFrom(t: Transcript, s: string, k: number): string {
  for (let i = k; ; i++) {
    const r = residue(t, s, i)
    if (r === '') return '?'
    if (r === '*') return String(i - k + 1)
  }
}

const three = (r: string) => (r === '?' ? '?' : threeLetter(r))

/**
 * An exonic change: `del` bases at `i0` of `seq` replaced by `ins`, all on
 * the feature's strand. Null when it falls wholly outside the coding part.
 */
function exonChange(t: Transcript, i0: number, del: number, ins: string): CodingChange | null {
  const j0 = i0 - t.frame
  const n = t.len - t.frame
  if (del > 0 ? j0 + del <= 0 || j0 >= n : j0 <= 0 || j0 >= n) return null
  const C = t.seq.slice(t.frame)
  const R = (k: number) => residue(t, C, k)

  // A deletion across the first codon from before it.
  if (j0 < 0) {
    const cdna = `c.${cPos(t, i0)}_${cPos(t, i0 + del - 1)}${ins ? `delins${ins}` : 'del'}`
    return { feature: t.name, cdna, protein: `${R(0)}1?`, hgvsp: `p.(${three(R(0))}1?)`, effect: 'Start lost' }
  }

  // HGVS 3' rule: an insertion or deletion moves as far 3' as its exon allows.
  if ((del === 0) !== (ins === '')) {
    const exon = t.exons.find(x => i0 >= x.off && i0 < x.off + x.len) ?? t.exons[t.exons.length - 1]
    const bound = Math.min(exon.off + exon.len, t.len)
    if (del > 0) {
      while (i0 + del < bound && t.seq[i0] === t.seq[i0 + del]) i0++
    } else {
      while (i0 < bound && t.seq[i0] === ins[0]) { ins = ins.slice(1) + t.seq[i0]; i0++ }
    }
  }
  const j = i0 - t.frame
  const cdna = cdnaOf(t, i0, del, ins)
  const A = C.slice(0, j) + ins + C.slice(j + del)
  const base = { feature: t.name, cdna }

  if ((ins.length - del) % 3 !== 0) return { ...base, ...frameshift(t, C, A, Math.floor(j / 3)) }

  // In frame: the codons the change touches, before and after.
  const c0 = Math.floor(j / 3)
  const rE = Math.max(c0 * 3, Math.ceil((j + del) / 3) * 3)
  const refFoot = C.slice(c0 * 3, rE)
  const altFoot = A.slice(c0 * 3, rE + ins.length - del)
  const rAA = residues(t, C, c0, rE / 3)
  const aAA = residues(t, A, c0, c0 + altFoot.length / 3)
  const codons = del === ins.length ? { codonFrom: refFoot, codonTo: altFoot } : {}

  if (c0 === 0 && t.frame === 0 && rAA[0] === 'M' && aAA[0] !== 'M') {
    return { ...base, ...codons, protein: 'M1?', hgvsp: 'p.(Met1?)', effect: 'Start lost' }
  }
  const rk = rAA.indexOf('*')
  const ak = aAA.indexOf('*')
  const r = rk >= 0 ? rAA.slice(0, rk + 1) : rAA
  const a = ak >= 0 ? aAA.slice(0, ak + 1) : aAA
  let p = 0
  while (p < r.length && p < a.length && r[p] === a[p]) p++
  let s = 0
  while (s < r.length - p && s < a.length - p && r[r.length - 1 - s] === a[a.length - 1 - s]) s++
  const r2 = r.slice(p, r.length - s)
  const a2 = a.slice(p, a.length - s)
  const pos = c0 + p

  if (r2 === '' && a2 === '') {
    const tail = rAA.length > 1 ? `_${rAA[rAA.length - 1]}${c0 + rAA.length}` : ''
    const tail3 = rAA.length > 1 ? `_${three(rAA[rAA.length - 1])}${c0 + rAA.length}` : ''
    return { ...base, ...codons, protein: `${rAA[0]}${c0 + 1}${tail}=`, hgvsp: `p.(${three(rAA[0])}${c0 + 1}${tail3}=)`, effect: 'Synonymous' }
  }
  const effect: Effect = ak >= 0 && rk < 0 ? 'Nonsense'
    : rk >= 0 && ak < 0 ? 'Stop lost'
    : del === ins.length ? 'Missense'
    : del > ins.length ? 'In-frame deletion' : 'In-frame insertion'

  if (effect === 'Stop lost' && r2[0] === '*') {
    // The stop becomes a residue and the protein reads on to the next stop.
    const x = residue(t, A, pos) || '?'
    const k = stopFrom(t, A, pos)
    return { ...base, ...codons, protein: `*${pos + 1}${x}ext*${k}`, hgvsp: `p.(Ter${pos + 1}${three(x)}extTer${k})`, effect }
  }
  if (effect === 'Nonsense' && a2 === '*') {
    // The protein now ends before residue pos + 1.
    const x = r2[0] ?? R(pos)
    return { ...base, ...codons, protein: `${x}${pos + 1}*`, hgvsp: `p.(${three(x)}${pos + 1}Ter)`, effect }
  }
  const named = proteinName(t, C, pos, r2, a2)
  return { ...base, ...codons, protein: named.short, hgvsp: `p.(${named.long})`, effect }
}

/** The HGVS c. name of an exonic change, already moved 3'. */
function cdnaOf(t: Transcript, i0: number, del: number, ins: string): string {
  const at = (i: number) => cPos(t, i)
  if (del === ins.length) {
    return del === 1 ? `c.${at(i0)}${t.seq[i0]}>${ins}` : `c.${at(i0)}_${at(i0 + del - 1)}delins${ins}`
  }
  if (ins === '') return `c.${at(i0)}${del > 1 ? `_${at(i0 + del - 1)}` : ''}del`
  if (del === 0) {
    const n = ins.length
    if (i0 - n >= 0 && t.seq.slice(i0 - n, i0) === ins) return `c.${at(i0 - n)}${n > 1 ? `_${at(i0 - 1)}` : ''}dup`
    return `c.${at(i0 - 1)}_${at(i0)}ins${ins}`
  }
  return `c.${at(i0)}${del > 1 ? `_${at(i0 + del - 1)}` : ''}delins${ins}`
}

/** A frameshift: the first residue that differs, what replaces it, and where the new frame stops. */
function frameshift(t: Transcript, C: string, A: string, from: number): Pick<CodingChange, 'protein' | 'hgvsp' | 'effect'> {
  let k = from
  let r = residue(t, C, k)
  let a = residue(t, A, k)
  while (r !== '' && a !== '' && r === a && r !== '*') { k++; r = residue(t, C, k); a = residue(t, A, k) }
  if (r === '' || a === '') return { protein: '?', hgvsp: 'p.?', effect: 'Frameshift' }
  // The same protein to its stop: the shift lies past it.
  if (r === a) return { protein: `*${k + 1}=`, hgvsp: `p.(Ter${k + 1}=)`, effect: 'Synonymous' }
  if (k === 0 && t.frame === 0 && r === 'M') return { protein: 'M1?', hgvsp: 'p.(Met1?)', effect: 'Start lost' }
  if (r === '*') {
    const n = stopFrom(t, A, k)
    return { protein: `*${k + 1}${a}ext*${n}`, hgvsp: `p.(Ter${k + 1}${three(a)}extTer${n})`, effect: 'Frameshift' }
  }
  if (a === '*') return { protein: `${r}${k + 1}*`, hgvsp: `p.(${three(r)}${k + 1}Ter)`, effect: 'Frameshift' }
  const n = stopFrom(t, A, k)
  return { protein: `${r}${k + 1}${a}fs*${n}`, hgvsp: `p.(${three(r)}${k + 1}${three(a)}fsTer${n})`, effect: 'Frameshift' }
}

/** Residues r2 from `pos` (0-based) replaced by a2: a substitution, deletion, insertion, duplication or deletion-insertion. */
function proteinName(t: Transcript, C: string, pos: number, r2: string, a2: string): { short: string; long: string } {
  const one = (k: number, r: string) => ({ s: `${r}${k + 1}`, l: `${three(r)}${k + 1}` })
  const span = (k: number, rs: string) => {
    const a = one(k, rs[0])
    if (rs.length === 1) return a
    const b = one(k + rs.length - 1, rs[rs.length - 1])
    return { s: `${a.s}_${b.s}`, l: `${a.l}_${b.l}` }
  }
  if (r2.length === 1 && a2.length === 1) {
    const x = one(pos, r2)
    return { short: `${x.s}${a2}`, long: `${x.l}${three(a2)}` }
  }
  if (a2 === '') {
    const x = span(pos, r2)
    return { short: `${x.s}del`, long: `${x.l}del` }
  }
  if (r2 === '') {
    const n = a2.length
    if (pos - n >= 0 && residues(t, C, pos - n, pos) === a2) {
      const x = span(pos - n, a2)
      return { short: `${x.s}dup`, long: `${x.l}dup` }
    }
    const before = one(pos - 1, residue(t, C, pos - 1) || '?')
    const after = one(pos, residue(t, C, pos) || '?')
    return { short: `${before.s}_${after.s}ins${a2}`, long: `${before.l}_${after.l}ins${threeLetter(a2)}` }
  }
  const x = span(pos, r2)
  return { short: `${x.s}delins${a2}`, long: `${x.l}delins${threeLetter(a2)}` }
}
