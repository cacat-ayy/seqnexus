/**
 * Melting temperature of a DNA duplex that need not be perfect.
 *
 * A port of the core of Biopython's `Tm_NN` (Bio/SeqUtils/MeltingTemp.py,
 * BSD 3-Clause; see tables.ts): the two strands are given aligned, the
 * oligo 5'→3' on top and its partner 3'→5' below, and every column is
 * scored. Watson-Crick neighbours use the unified parameters, a neighbour
 * pair containing one mismatch uses the internal-mismatch table, an unpaired
 * base at either end uses the terminal-mismatch table, and a '.' opposite a
 * base is a dangling end.
 *
 * Salt: Owczarzy et al. (2008), Biochemistry 47: 5336-5353, which picks
 * between a monovalent and a Mg²⁺ correction from their ratio and accounts
 * for Mg²⁺ bound by dNTPs. The simpler SantaLucia (1998) entropy correction
 * is available for comparison with tools that default to it.
 */

import { DNA_DE, DNA_IMM, DNA_NN, DNA_TMM, type Params, type Table } from './tables'

const R = 1.987 // cal/(mol·K)

export interface Conditions {
  /** Total oligo concentration, nM. The duplex constant is Ct/4. */
  oligoConc: number
  /** Monovalent cations (Na⁺ + K⁺ + Tris/2), mM. */
  mono: number
  /** Mg²⁺, mM. */
  mg: number
  /** Total dNTPs, mM. */
  dntp: number
}

export type SaltMethod = 'owczarzy2008' | 'santalucia1998'

export interface DuplexThermo {
  /** kcal/mol */
  dH: number
  /** cal/(mol·K), before any salt correction */
  dS: number
  /** Some neighbour pair had no parameters (e.g. two adjacent mismatches). */
  approximate: boolean
}

const reverse = (s: string) => s.split('').reverse().join('')

function lookup(tables: Table[], key: string): Params | undefined {
  for (const t of tables) {
    const v = t[key] ?? t[reverse(key)]
    if (v) return v
  }
  return undefined
}

/**
 * ΔH and ΔS of an aligned duplex.
 *
 * `seq` is the oligo 5'→3'; `cseq` is the partner strand written 3'→5' under
 * it, the same length. Either may carry '.' at its ends for a base with
 * nothing opposite.
 */
export function duplexThermo(seq: string, cseq: string): DuplexThermo {
  if (seq.length !== cseq.length) throw new Error('duplexThermo: strands must be aligned to the same length')
  let top = seq.toUpperCase()
  let bot = cseq.toUpperCase()
  let dH = 0
  let dS = 0
  let approximate = false
  const add = (p: Params | undefined) => {
    if (p) { dH += p[0]; dS += p[1] } else approximate = true
  }

  // Dangling ends.
  if (top.startsWith('.') || bot.startsWith('.')) {
    add(DNA_DE[top.slice(0, 2) + '/' + bot.slice(0, 2)])
    top = top.slice(1); bot = bot.slice(1)
  }
  if (top.endsWith('.') || bot.endsWith('.')) {
    add(DNA_DE[reverse(bot.slice(-2)) + '/' + reverse(top.slice(-2))])
    top = top.slice(0, -1); bot = bot.slice(0, -1)
  }

  // Terminal mismatches.
  const leftTmm = reverse(bot.slice(0, 2)) + '/' + reverse(top.slice(0, 2))
  if (DNA_TMM[leftTmm]) {
    add(DNA_TMM[leftTmm])
    top = top.slice(1); bot = bot.slice(1)
  }
  const rightTmm = top.slice(-2) + '/' + bot.slice(-2)
  if (DNA_TMM[rightTmm]) {
    add(DNA_TMM[rightTmm])
    top = top.slice(0, -1); bot = bot.slice(0, -1)
  }

  // Initiation, from the ends of the oligo as given.
  const oligo = seq.toUpperCase().replace(/\./g, '')
  add(DNA_NN['init'])
  for (const end of [oligo[0], oligo[oligo.length - 1]]) {
    add(end === 'A' || end === 'T' ? DNA_NN['init_A/T'] : DNA_NN['init_G/C'])
  }

  // Zipping.
  for (let i = 0; i < top.length - 1; i++) {
    add(lookup([DNA_IMM, DNA_NN], top.slice(i, i + 2) + '/' + bot.slice(i, i + 2)))
  }
  return { dH, dS, approximate }
}

/**
 * Tm (°C) of an aligned duplex. NaN when it cannot form: fewer than two
 * bases, or no salt at all.
 */
export function duplexTm(
  seq: string,
  cseq: string,
  c: Conditions,
  method: SaltMethod = 'owczarzy2008',
): number {
  const oligo = seq.toUpperCase().replace(/\./g, '')
  if (oligo.length < 2) return NaN
  const { dH, dS } = duplexThermo(seq, cseq)
  const k = (c.oligoConc / 4) * 1e-9

  if (method === 'santalucia1998') {
    // Biopython saltcorr=5, with the von Ahsen (2001) sodium equivalent when
    // Mg²⁺ is present.
    let mono = c.mono
    if (c.mg > c.dntp) mono += 120 * Math.sqrt(c.mg - c.dntp)
    if (mono <= 0) return NaN
    const corrS = dS + 0.368 * (oligo.length - 1) * Math.log(mono * 1e-3)
    return (1000 * dH) / (corrS + R * Math.log(k)) - 273.15
  }

  const tm = (1000 * dH) / (dS + R * Math.log(k))
  const corr = saltCorrection(oligo, c)
  if (corr === null) return NaN
  return 1 / (1 / tm + corr) - 273.15
}

/**
 * Owczarzy (2008) correction to 1/Tm (1/K) for a helix whose top strand
 * reads `seq`; null when there is no salt at all. Hairpin stems use it too:
 * it was fitted on duplexes, but there is no better model here.
 */
export function saltCorrection(seq: string, c: Conditions): number | null {
  const mon = c.mono * 1e-3
  let mg = c.mg * 1e-3
  if (c.dntp > 0 && mg > 0) {
    // Free Mg²⁺ after dNTP binding (Ka = 3·10⁴ M⁻¹).
    const ka = 3e4
    const dntps = c.dntp * 1e-3
    const b = ka * dntps - ka * mg + 1
    mg = (-b + Math.sqrt(b * b + 4 * ka * mg)) / (2 * ka)
  }
  const fGC = gcFraction(seq)
  const monoOnly = () => (4.29 * fGC - 3.95) * 1e-5 * Math.log(mon) + 9.4e-6 * Math.log(mon) ** 2

  if (mg <= 0) return mon > 0 ? monoOnly() : null

  let a = 3.92, d = 1.42, g = 8.31
  const b = -0.911, cc = 6.26, e = -48.2, f = 52.5
  if (mon > 0) {
    const ratio = Math.sqrt(mg) / mon
    if (ratio < 0.22) return monoOnly()
    if (ratio < 6) {
      const lm = Math.log(mon)
      a = 3.92 * (0.843 - 0.352 * Math.sqrt(mon) * lm)
      d = 1.42 * (1.279 - 4.03e-3 * lm - 8.03e-3 * lm ** 2)
      g = 8.31 * (0.486 - 0.258 * lm + 5.25e-3 * lm ** 3)
    }
  }
  const lmg = Math.log(mg)
  return (a + b * lmg + fGC * (cc + d * lmg)
    + (1 / (2 * (seq.length - 1))) * (e + f * lmg + g * lmg ** 2)) * 1e-5
}

function gcFraction(s: string): number {
  let gc = 0
  for (const ch of s) if (ch === 'G' || ch === 'C') gc++
  return s.length ? gc / s.length : 0
}

const PAIR: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }

/** The perfect partner of an oligo, written 3'→5' under it. */
export function complementStrand(seq: string): string {
  return seq.toUpperCase().split('').map(b => PAIR[b] ?? 'N').join('')
}
