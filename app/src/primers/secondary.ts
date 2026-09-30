/**
 * Melting temperatures of an oligo's own structures: the hairpin it can fold
 * into and the dimer two copies of it can form.
 *
 * A simplified nearest-neighbour model, not Primer3's thermodynamic
 * alignment. Only ungapped helices are considered: a hairpin stem must pair
 * perfectly, a dimer may carry single internal mismatches, and neither may
 * have bulges or internal loops. The results are estimates for judging a
 * primer, and are shown as such. The method is written out in the README
 * ("Hairpin and self-dimer Tm").
 */

import { duplexTm, saltCorrection, type Conditions } from './thermo/duplex'
import { DNA_NN, DNA_TMM, type Params, type Table } from './thermo/tables'
import { bestDimer, type DuplexAlignment } from './structure'

const PAIR: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }
const T37 = 273.15 + 37
const R_KCAL = 1.987e-3 // kcal/(mol·K)

/**
 * Hairpin loop ΔG37 (kcal/mol, 1 M Na⁺) by loop length.
 * SantaLucia & Hicks (2004), Annu Rev Biophys Biomol Struct 33: 415-440, Table 4.
 */
const HAIRPIN_LOOP_DG: ReadonlyArray<readonly [number, number]> = [
  [3, 3.5], [4, 3.5], [5, 3.3], [6, 4.0], [7, 4.2], [8, 4.3], [9, 4.5], [10, 4.6],
  [12, 5.0], [14, 5.1], [16, 5.3], [18, 5.5], [20, 5.7], [25, 6.1], [30, 6.3],
]

/**
 * ΔG37 of closing a hairpin loop of `n` bases: interpolated between the
 * tabulated lengths, and past 30 extended by the Jacobson-Stockmayer term
 * 2.44·R·T·ln(n/30) as SantaLucia & Hicks prescribe.
 */
export function hairpinLoopDG(n: number): number {
  const table = HAIRPIN_LOOP_DG
  if (n <= table[0][0]) return table[0][1]
  const [lastN, lastDG] = table[table.length - 1]
  if (n >= lastN) return lastDG + 2.44 * R_KCAL * T37 * Math.log(n / lastN)
  for (let i = 1; i < table.length; i++) {
    const [n1, g1] = table[i]
    if (n <= n1) {
      const [n0, g0] = table[i - 1]
      return g0 + ((g1 - g0) * (n - n0)) / (n1 - n0)
    }
  }
  return lastDG
}

function lookup(table: Table, key: string): Params | undefined {
  return table[key] ?? table[key.split('').reverse().join('')]
}

export interface HairpinTm {
  /** Paired bases on each arm. */
  stem: number
  /** Unpaired bases in the loop. */
  loop: number
  /** °C under the given conditions. */
  tm: number
  /** kcal/mol at 37 °C. */
  dG: number
  /** The 3' arm ends on the oligo's last base: a polymerase can extend it. */
  threePrime: boolean
  /** Dot-bracket under the sequence: `(` and `)` are the paired arms. */
  dotBracket: string
}

/**
 * The hairpin with the highest Tm, or null if no stem of 3 bp or more can
 * close a loop of at least 3 bases, or none is stable at any temperature.
 *
 * Every loop position is tried with its stem zipped outward as far as it
 * pairs perfectly. The fold is scored as
 *   ΔH = Σ stem neighbours + terminal mismatch at the loop
 *   ΔS = the same + loop penalty, taken as purely entropic (−ΔG_loop / 310.15 K)
 * and melts where ΔG = 0, independent of concentration because the fold is
 * unimolecular: Tm = ΔH / ΔS, then salt-corrected like a duplex of the stem.
 */
export function hairpinTm(seq: string, c: Conditions): HairpinTm | null {
  const s = seq.toUpperCase()
  const n = s.length
  let best: (Omit<HairpinTm, 'dotBracket'> & { loopStart: number; loopEnd: number }) | null = null

  for (let loopStart = 3; loopStart < n - 3; loopStart++) {
    for (let loopEnd = loopStart + 3; loopEnd < n; loopEnd++) {
      let stem = 0
      while (loopStart - 1 - stem >= 0 && loopEnd + stem < n
        && PAIR[s[loopStart - 1 - stem]] === s[loopEnd + stem]) stem++
      if (stem < 3) continue

      const scored = scoreHairpin(s, loopStart, loopEnd, stem, c)
      if (!scored) continue
      if (!best || scored.tm > best.tm) {
        best = { ...scored, loopStart, loopEnd }
      }
    }
  }
  if (!best) return null

  const chars = new Array<string>(n).fill('.')
  for (let k = 0; k < best.stem; k++) {
    chars[best.loopStart - 1 - k] = '('
    chars[best.loopEnd + k] = ')'
  }
  return {
    stem: best.stem,
    loop: best.loop,
    tm: best.tm,
    dG: best.dG,
    threePrime: best.threePrime,
    dotBracket: chars.join(''),
  }
}

function scoreHairpin(
  s: string, loopStart: number, loopEnd: number, stem: number, c: Conditions,
): Omit<HairpinTm, 'dotBracket'> | null {
  // The 5' arm read 5'→3', with its partner arm written 3'→5' beneath it.
  const top = s.slice(loopStart - stem, loopStart)
  const bottom = s.slice(loopEnd, loopEnd + stem).split('').reverse().join('')
  let dH = 0 // kcal/mol
  let dS = 0 // cal/(mol·K)
  for (let k = 0; k + 1 < stem; k++) {
    const p = lookup(DNA_NN, `${top[k]}${top[k + 1]}/${bottom[k]}${bottom[k + 1]}`)
    if (!p) return null
    dH += p[0]
    dS += p[1]
  }
  const loop = loopEnd - loopStart
  // The first and last loop bases face each other across the closing pair.
  if (loop > 3) {
    const tmm = DNA_TMM[`${s[loopStart - 1]}${s[loopStart]}/${s[loopEnd]}${s[loopEnd - 1]}`]
    if (tmm) { dH += tmm[0]; dS += tmm[1] }
  }
  dS -= (1000 * hairpinLoopDG(loop)) / T37
  if (dH >= 0 || dS >= 0) return null

  const tm1M = (1000 * dH) / dS
  const corr = saltCorrection(top, c)
  if (corr === null) return null
  const tm = 1 / (1 / tm1M + corr) - 273.15
  return {
    stem,
    loop,
    tm,
    dG: dH - (T37 * dS) / 1000,
    threePrime: loopEnd + stem === s.length,
  }
}

export interface SelfDimerTm extends DuplexAlignment {
  /** °C under the given conditions. */
  tm: number
}

/**
 * The most stable self-dimer (see `bestDimer`) with its Tm, or null when the
 * oligo pairs with itself for fewer than 3 bp.
 *
 * The paired stretch is scored as a duplex, mismatches included. Both strands
 * are the same molecule, so at the Tm half of all strands are paired with
 * each other and K = 1/Ct: Tm = ΔH / (ΔS + R·ln Ct), not the Ct/4 of two
 * different strands.
 */
export function selfDimerTm(seq: string, c: Conditions): SelfDimerTm | null {
  const d = bestDimer(seq, seq)
  if (!d) return null
  const [top, bottom] = d.stretch
  // duplexTm uses Ct/4; handing it 4·Ct makes that Ct.
  const tm = duplexTm(top, bottom, { ...c, oligoConc: c.oligoConc * 4 })
  return { ...d, tm }
}

export type StructureGrade = 'good' | 'ok' | 'poor'

/**
 * How much a structure threatens priming, judged against the Tm at which the
 * primer itself anneals: comfortably below it is harmless, close to it
 * competes with binding. A structure that pairs the 3' end is a grade worse,
 * because a polymerase can extend it into primer-dimer or self-primed product.
 *
 *   good  Tm ≤ reference − 15 °C (or no structure)
 *   ok    reference − 15 < Tm ≤ reference − 5
 *   poor  Tm > reference − 5
 */
export function structureGrade(tm: number | null, reference: number, threePrime: boolean): StructureGrade {
  if (tm === null || !Number.isFinite(tm) || !Number.isFinite(reference)) return 'good'
  const margin = reference - tm
  const grades: StructureGrade[] = ['good', 'ok', 'poor']
  let i = margin >= 15 ? 0 : margin >= 5 ? 1 : 2
  if (threePrime) i = Math.min(2, i + 1)
  return grades[i]
}
