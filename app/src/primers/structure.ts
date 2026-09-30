/**
 * Where an oligo pairs with itself or its partner, drawn as text.
 *
 * The scoring already measures these (longest complementary run, longest
 * stem); this finds where they are so the designer can show them. A number
 * says a primer has a 5 bp self-dimer; the duplex says whether it sits on
 * the 3' end, which is the one that matters.
 */

import { DNA_IMM, DNA_NN } from './thermo/tables'

const PAIR: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }

export interface DuplexAlignment {
  /** Longest contiguous complementary run, bp. */
  run: number
  /** ΔG of that run at 37 °C, kcal/mol. */
  dG: number
  /** The run reaches the 3' end of either strand, so it can be extended. */
  threePrime: boolean
  /**
   * Three lines: `a` 5'→3', the pairing marks, `b` 3'→5'. `|` marks the
   * run, `:` any other complementary position in the overlap.
   */
  lines: [string, string, string]
  /** The stretch scored for `dG`, as two aligned strands: `a` 5'→3' over `b` 3'→5'. */
  stretch: [string, string]
}

/**
 * The most stable way `b` can lie antiparallel on `a`. For a self-dimer pass
 * the same oligo twice. Null when nothing pairs for 3 bp or more.
 *
 * Stability is ΔG37 of the best ungapped stretch in each alignment, scored
 * with the nearest-neighbour tables including single internal mismatches,
 * so a 10 bp dimer interrupted once is not mistaken for two harmless 4 bp
 * ones. Loops and bulges are not modelled.
 */
export function bestDimer(a: string, b: string): DuplexAlignment | null {
  const A = a.toUpperCase()
  const rb = b.toUpperCase().split('').reverse().join('') // b written 3'→5'
  let best: { offset: number; seg: Segment; run: number } | null = null

  // Column c holds A[c] over rb[c - offset].
  for (let offset = -(rb.length - 1); offset < A.length; offset++) {
    const lo = Math.max(0, offset)
    const hi = Math.min(A.length, offset + rb.length)
    if (hi - lo < 3) continue
    const seg = mostStable(A.slice(lo, hi), rb.slice(lo - offset, hi - offset))
    if (!seg || seg.pairs < 3) continue
    const s: Segment = { ...seg, from: seg.from + lo, to: seg.to + lo }
    if (!best || s.dG < best.seg.dG) best = { offset, seg: s, run: longestRun(A, rb, offset, s.from, s.to) }
  }
  if (!best || best.run < 3) return null

  const { offset, seg } = best
  const minCol = Math.min(0, offset)
  const pad = (n: number) => ' '.repeat(n)
  const top = pad(-minCol) + "5'-" + A + "-3'"
  const bottom = pad(offset - minCol) + "3'-" + rb + "-5'"
  let marks = ''
  const lo = Math.max(0, offset)
  const hi = Math.min(A.length, offset + rb.length)
  for (let c = minCol; c < hi; c++) {
    if (c < lo) { marks += ' '; continue }
    const paired = PAIR[A[c]] === rb[c - offset]
    marks += paired ? (c >= seg.from && c < seg.to ? '|' : ':') : ' '
  }
  return {
    run: best.run,
    dG: seg.dG,
    // a's 3' end is its last column; b's 3' end is rb[0], at column `offset`.
    threePrime: seg.to === A.length || seg.from === offset,
    lines: [top, pad(3) + marks, bottom],
    stretch: [A.slice(seg.from, seg.to), rb.slice(seg.from - offset, seg.to - offset)],
  }
}

interface Segment {
  /** Columns [from, to), relative to the strings passed in. */
  from: number
  to: number
  dG: number
  pairs: number
}

const T37 = 273.15 + 37

/** ΔG37 (kcal/mol) of one neighbour pair, or null if it has no parameters. */
function doubletDG(top: string, bot: string): number | null {
  const p = lookupNN(`${top}/${bot}`)
  return p ? p[0] - (T37 * p[1]) / 1000 : null
}

function lookupNN(key: string) {
  const rev = key.split('').reverse().join('')
  return DNA_IMM[key] ?? DNA_IMM[rev] ?? DNA_NN[key] ?? DNA_NN[rev]
}

/**
 * Most negative-ΔG stretch of an aligned pair of strings (maximum subarray
 * over neighbour-pair energies). Must start and end on a paired column; a
 * doublet with no parameters (two mismatches in a row) splits stretches.
 */
function mostStable(top: string, bot: string): Segment | null {
  let best: Segment | null = null
  let runStart = -1
  let sum = 0
  for (let c = 0; c + 1 < top.length; c++) {
    const pairedHere = PAIR[top[c]] === bot[c]
    if (runStart < 0) {
      if (!pairedHere) continue
      runStart = c
      sum = 0
    }
    const dg = doubletDG(top.slice(c, c + 2), bot.slice(c, c + 2))
    if (dg === null) { runStart = -1; continue }
    sum += dg
    if (sum >= 0) { runStart = -1; continue }
    // Only a stretch that ends on a pair counts.
    if (PAIR[top[c + 1]] === bot[c + 1]) {
      const from = runStart
      const to = c + 2
      let pairs = 0
      for (let k = from; k < to; k++) if (PAIR[top[k]] === bot[k]) pairs++
      const init = initDG(top[from]) + initDG(top[to - 1])
      const dG = sum + init
      if (!best || dG < best.dG) best = { from, to, dG, pairs }
    }
  }
  return best
}

function initDG(base: string): number {
  const p = base === 'A' || base === 'T' ? DNA_NN['init_A/T'] : DNA_NN['init_G/C']
  return p[0] - (T37 * p[1]) / 1000
}

function longestRun(A: string, rb: string, offset: number, from: number, to: number): number {
  let run = 0
  let best = 0
  for (let c = from; c < to; c++) {
    if (PAIR[A[c]] === rb[c - offset]) { run++; best = Math.max(best, run) } else run = 0
  }
  return best
}

export interface Hairpin {
  stem: number
  loop: number
  /** Dot-bracket under the sequence: `(` and `)` are the paired arms. */
  dotBracket: string
}

/**
 * Longest stem the oligo can fold into with a loop of at least 3 bases.
 * Null when no stem of 3 bp or more exists.
 */
export function bestHairpin(seq: string): Hairpin | null {
  const s = seq.toUpperCase()
  const n = s.length
  let best: { stem: number; loopStart: number; loopEnd: number } | null = null
  for (let loopStart = 3; loopStart < n - 3; loopStart++) {
    for (let loopEnd = loopStart + 3; loopEnd < n; loopEnd++) {
      let stem = 0
      let i = loopStart - 1
      let j = loopEnd
      while (i >= 0 && j < n && PAIR[s[i]] === s[j]) { stem++; i--; j++ }
      // Prefer the tighter loop on a tie: it is the more stable fold.
      if (stem >= 3 && (!best || stem > best.stem)) best = { stem, loopStart, loopEnd }
    }
  }
  if (!best) return null
  const chars = new Array<string>(n).fill('.')
  for (let k = 0; k < best.stem; k++) {
    chars[best.loopStart - 1 - k] = '('
    chars[best.loopEnd + k] = ')'
  }
  return { stem: best.stem, loop: best.loopEnd - best.loopStart, dotBracket: chars.join('') }
}
