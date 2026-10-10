/**
 * In-silico proteolysis: where a protease cuts, and the peptides a digest
 * gives, with the numbers a mass spectrometrist reads off a peptide list.
 *
 * The rules follow ExPASy PeptideCutter where it states a simple rule: a
 * residue in P1 (before the bond) and a residue in P1' (after it) that
 * blocks the cut, proline being the usual blocker. PeptideCutter's longer
 * exception lists (trypsin's CKD, DKD, CKH, CKY, RRH, RRR and the WKP and
 * MRP exceptions to the proline rule) are not applied: they fine-tune a
 * minority of sites and the simple rule is what every other tool uses. The
 * engineered proteases (TEV, thrombin, Factor Xa, enterokinase, HRV 3C)
 * cut at their recognition sequence only.
 */

import { proteinMass, chargeGroups, isoelectricPoint, pkaSet, gravy } from './properties'

export interface Protease {
  id: string
  name: string
  description: string
  /** Residues in P1 (the bond follows them), for the residue-rule proteases. */
  p1?: string
  /** Residues in P1' that block the cut. */
  blockP1prime?: string
  /** Residues in P2 that block the cut. */
  blockP2?: string
  /** Cut before the residue rather than after it (Asp-N). */
  before?: string
  /** A recognition sequence, cut after its last residue, with an optional P1' requirement. */
  site?: { sequence: string; p1prime?: string }
  /** 'enzyme' for the proteases; 'chemical' for CNBr. */
  kind: 'enzyme' | 'chemical'
}

export const PROTEASES: readonly Protease[] = [
  { id: 'trypsin', name: 'Trypsin', kind: 'enzyme', p1: 'KR', blockP1prime: 'P',
    description: 'After Lys or Arg, not before Pro' },
  { id: 'chymotrypsin', name: 'Chymotrypsin (high specificity)', kind: 'enzyme', p1: 'FYW', blockP1prime: 'P',
    description: 'After Phe, Tyr or Trp, not before Pro' },
  { id: 'chymotrypsin-low', name: 'Chymotrypsin (low specificity)', kind: 'enzyme', p1: 'FYWLM', blockP1prime: 'P',
    description: 'After Phe, Tyr, Trp, Leu or Met, not before Pro' },
  { id: 'lys-c', name: 'Lys-C', kind: 'enzyme', p1: 'K',
    description: 'After Lys' },
  { id: 'arg-c', name: 'Arg-C', kind: 'enzyme', p1: 'R', blockP1prime: 'P',
    description: 'After Arg, not before Pro' },
  { id: 'glu-c', name: 'Glu-C (V8, bicarbonate)', kind: 'enzyme', p1: 'E', blockP1prime: 'P',
    description: 'After Glu, not before Pro' },
  { id: 'glu-c-phosphate', name: 'Glu-C (V8, phosphate)', kind: 'enzyme', p1: 'DE', blockP1prime: 'P',
    description: 'After Glu or Asp, not before Pro' },
  { id: 'asp-n', name: 'Asp-N', kind: 'enzyme', before: 'D',
    description: 'Before Asp' },
  { id: 'pepsin', name: 'Pepsin (pH 1.3)', kind: 'enzyme', p1: 'FL', blockP1prime: 'P', blockP2: 'P',
    description: 'After Phe or Leu, not before Pro nor after a Pro at P2' },
  { id: 'cnbr', name: 'CNBr', kind: 'chemical', p1: 'M',
    description: 'After Met (cyanogen bromide)' },
  { id: 'tev', name: 'TEV protease', kind: 'enzyme', site: { sequence: 'ENLYFQ', p1prime: 'GS' },
    description: 'ENLYFQ^G/S' },
  { id: 'thrombin', name: 'Thrombin', kind: 'enzyme', site: { sequence: 'LVPR', p1prime: 'GS' },
    description: 'LVPR^GS' },
  { id: 'factor-xa', name: 'Factor Xa', kind: 'enzyme', site: { sequence: 'IEGR' },
    description: 'I(E/D)GR^' },
  { id: 'enterokinase', name: 'Enterokinase', kind: 'enzyme', site: { sequence: 'DDDDK' },
    description: 'DDDDK^' },
  { id: 'hrv-3c', name: 'HRV 3C (PreScission)', kind: 'enzyme', site: { sequence: 'LEVLFQ', p1prime: 'G' },
    description: 'LEVLFQ^GP' },
]

export const DEFAULT_PROTEASE_ID = 'trypsin'

export function protease(id: string): Protease | undefined {
  return PROTEASES.find(p => p.id === id)
}

/**
 * The bonds a protease cuts: each as the index of the residue that follows
 * the cut (so a cut at `i` makes peptides [..i) and [i..)). Sorted, unique,
 * never 0 or the length.
 */
export function cleavageSites(residues: string, p: Protease): number[] {
  const s = residues.toUpperCase()
  const n = s.length
  const out = new Set<number>()
  if (p.site) {
    const seq = p.site.sequence
    // Factor Xa takes Glu or Asp at P3.
    const alts = p.id === 'factor-xa' ? ['IEGR', 'IDGR'] : [seq]
    for (const site of alts) {
      let from = 0
      for (;;) {
        const i = s.indexOf(site, from)
        if (i < 0) break
        const cut = i + site.length
        const next = s[cut]
        if (cut > 0 && cut < n && (!p.site.p1prime || (next && p.site.p1prime.includes(next)))) out.add(cut)
        from = i + 1
      }
    }
  } else if (p.before) {
    for (let i = 1; i < n; i++) if (p.before.includes(s[i])) out.add(i)
  } else if (p.p1) {
    for (let i = 0; i < n - 1; i++) {
      if (!p.p1.includes(s[i])) continue
      if (p.blockP1prime && p.blockP1prime.includes(s[i + 1])) continue
      if (p.blockP2 && i > 0 && p.blockP2.includes(s[i - 1])) continue
      out.add(i + 1)
    }
  }
  return [...out].sort((a, b) => a - b)
}

export interface Peptide {
  /** 0-based, half-open residues. */
  start: number
  end: number
  sequence: string
  /** Cleavage sites skipped inside it. */
  missed: number
  /** Average and monoisotopic mass, Da. */
  average: number
  mono: number
  /** m/z at charge 1, 2 and 3, from the monoisotopic mass. */
  mz: [number, number, number]
  pI: number | null
  gravy: number | null
}

/** The mass of a proton, for m/z. */
const PROTON = 1.007276

function peptideOf(residues: string, start: number, end: number, missed: number): Peptide {
  const sequence = residues.slice(start, end).toUpperCase()
  const mass = proteinMass(sequence)
  const groups = chargeGroups(sequence)
  return {
    start, end, sequence, missed,
    average: mass.average,
    mono: mass.monoisotopic,
    mz: [1, 2, 3].map(z => (mass.monoisotopic + z * PROTON) / z) as [number, number, number],
    pI: isoelectricPoint(groups, pkaSet('emboss')),
    gravy: gravy(sequence),
  }
}

export interface DigestOptions {
  /** Up to this many sites skipped per peptide; 0 is a complete digest. */
  missedCleavages?: number
}

/**
 * The peptides of a digest with one or more proteases, every cut applied
 * (the sites of several proteases are pooled). With missed cleavages, every
 * run of up to n+1 consecutive fragments is a peptide too, so the list
 * holds the complete digest and the partials beside it, in sequence order.
 */
export function digest(residues: string, proteases: readonly Protease[], opts: DigestOptions = {}): Peptide[] {
  const n = residues.length
  if (n === 0) return []
  const missed = Math.max(0, Math.min(5, opts.missedCleavages ?? 0))
  const sites = [...new Set(proteases.flatMap(p => cleavageSites(residues, p)))].sort((a, b) => a - b)
  const bounds = [0, ...sites, n]
  const out: Peptide[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    for (let k = 0; k <= missed && i + k + 1 < bounds.length; k++) {
      out.push(peptideOf(residues, bounds[i], bounds[i + k + 1], k))
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end)
}

/** The fraction of residues inside at least one of these peptides. */
export function coverage(peptides: readonly Peptide[], length: number): number {
  if (length === 0) return 0
  const covered = new Uint8Array(length)
  for (const p of peptides) for (let i = p.start; i < p.end && i < length; i++) covered[i] = 1
  let n = 0
  for (let i = 0; i < length; i++) n += covered[i]
  return n / length
}
