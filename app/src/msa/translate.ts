/**
 * Translating alignment rows in place, for the translation strip and for
 * colouring bases by the amino acid they encode.
 *
 * Each row is read from its own first residue in the chosen frame, skipping
 * gaps, so a codon can straddle a gap. A gap run whose length is not a
 * multiple of three inside the coding stretch shifts the frame for the rest
 * of the row; those are reported, because they are usually alignment or
 * sequencing errors to correct.
 */

import { geneticCode } from '../codon/genetic-codes'
import type { AlnRow } from './model'

export interface RowTranslation {
  /** For each column: the amino acid (char code) of the codon its base belongs to, or 0. */
  aa: Uint8Array
  /** For each column: 0, 1 or 2 for the base's place in its codon, 255 for gaps and leftover bases. */
  pos: Uint8Array
  /** Codons as [first, middle, last] columns with their amino acid. */
  codons: { cols: [number, number, number]; aa: string }[]
  /** Columns where an internal stop codon starts. */
  stops: number[]
  /** Gap runs inside the row whose length is not a multiple of 3: [start, end) columns. */
  frameshifts: [number, number][]
}

const CACHE = new WeakMap<AlnRow, Map<string, RowTranslation>>()

export function translateRow(row: AlnRow, frame: 0 | 1 | 2, codeId: number): RowTranslation {
  const key = `${frame}:${codeId}`
  let byKey = CACHE.get(row)
  const hit = byKey?.get(key)
  if (hit) return hit
  const t = build(row.seq, frame, codeId)
  if (!byKey) { byKey = new Map(); CACHE.set(row, byKey) }
  byKey.set(key, t)
  return t
}

function build(seq: string, frame: number, codeId: number): RowTranslation {
  const table = geneticCode(codeId).table
  const w = seq.length
  const aa = new Uint8Array(w)
  const pos = new Uint8Array(w).fill(255)
  const codons: RowTranslation['codons'] = []
  const stops: number[] = []

  // Columns holding residues, in order.
  const cols: number[] = []
  for (let c = 0; c < w; c++) if (seq.charCodeAt(c) !== 45) cols.push(c)

  for (let i = frame; i + 2 < cols.length; i += 3) {
    const c1 = cols[i], c2 = cols[i + 1], c3 = cols[i + 2]
    const codon = (seq[c1] + seq[c2] + seq[c3]).replace(/U/g, 'T')
    const a = table[codon] ?? 'X'
    const code = a.charCodeAt(0)
    aa[c1] = aa[c2] = aa[c3] = code
    pos[c1] = 0; pos[c2] = 1; pos[c3] = 2
    codons.push({ cols: [c1, c2, c3], aa: a })
    if (a === '*' && i + 5 < cols.length) stops.push(c1)
  }

  const frameshifts: [number, number][] = []
  if (cols.length > 0) {
    const first = cols[0]
    const last = cols[cols.length - 1]
    let c = first
    while (c <= last) {
      if (seq.charCodeAt(c) !== 45) { c++; continue }
      const start = c
      while (c <= last && seq.charCodeAt(c) === 45) c++
      if ((c - start) % 3 !== 0) frameshifts.push([start, c])
    }
  }
  return { aa, pos, codons, stops, frameshifts }
}
