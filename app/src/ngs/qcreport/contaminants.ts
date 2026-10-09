/**
 * The Possible Source of an overrepresented sequence: its best match in
 * FastQC's contaminant list, found by FastQC's rule. A match is a stretch of
 * more than 20 bases with at most one mismatch, on either strand of the
 * contaminant; queries of 8 to 19 bases match only as an exact substring.
 * The longest match wins, then the one with fewer mismatches.
 */

import { CONTAMINANTS } from './sequences'

interface Hit {
  name: string
  length: number
  /** Percent identity, a whole number, as FastQC rounds it down. */
  identity: number
}

const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' }
const revcomp = (s: string) => {
  let out = ''
  for (let i = s.length - 1; i >= 0; i--) out += COMP[s[i]] ?? 'N'
  return out
}

/**
 * A run of 21 bases with one mismatch has 10 matching bases in a row on one
 * side of it, so only contaminants that share a 10-mer with the query need
 * the full search. An amplicon library can have hundreds of overrepresented
 * sequences; this keeps naming them quick.
 */
const SEED = 10

let prepared: { list: { name: string; strands: [string, string] }[]; seeds: Map<string, number[]> } | null = null
function contaminants() {
  if (prepared) return prepared
  const list = CONTAMINANTS.map(([name, seq]) => ({ name, strands: [seq, revcomp(seq)] as [string, string] }))
  const seeds = new Map<string, number[]>()
  list.forEach((c, i) => {
    for (const s of c.strands) {
      for (let k = 0; k + SEED <= s.length; k++) {
        const key = s.slice(k, k + SEED)
        const at = seeds.get(key)
        if (!at) seeds.set(key, [i])
        else if (at[at.length - 1] !== i) at.push(i)
      }
    }
  })
  prepared = { list, seeds }
  return prepared
}

const better = (a: Hit | null, length: number, identity: number) =>
  !a || length > a.length || (length === a.length && identity > a.identity)

/** The best match of `query` against `ref` at one diagonal: a run of more than 20 bases with one mismatch at most. */
function diagonal(ref: string, query: string, offset: number, name: string, best: Hit | null): Hit | null {
  let mismatches = 0
  let start = 0
  let end = 0
  for (let i = 0; i < ref.length; i++) {
    const j = i + offset
    if (j < 0) { start = i + 1; continue }
    if (j >= query.length) break
    if (ref[i] === query[j]) {
      end = i
      continue
    }
    if (++mismatches > 1) {
      const len = end - start + 1
      if (len > 20) {
        const id = Math.floor(((len - (mismatches - 1)) * 100) / len)
        if (better(best, len, id)) best = { name, length: len, identity: id }
      }
      start = i + 1
      end = i + 1
      mismatches = 0
    }
  }
  const len = end - start + 1
  if (len > 20) {
    const id = Math.floor(((len - mismatches) * 100) / len)
    if (better(best, len, id)) best = { name, length: len, identity: id }
  }
  return best
}

function matchOne(name: string, strands: [string, string], query: string): Hit | null {
  if (query.length >= 8 && query.length < 20) {
    if (strands[0].includes(query) || strands[1].includes(query)) return { name, length: query.length, identity: 100 }
  }
  let best: Hit | null = null
  for (const ref of strands) {
    for (let offset = -(ref.length - 20); offset < query.length - 20; offset++) {
      const h = diagonal(ref, query, offset, name, null)
      // Within one contaminant FastQC keeps the longest; a tie keeps the first found.
      if (h && (!best || h.length > best.length)) best = h
    }
  }
  return best
}

/** The best contaminant hit for a sequence, written as FastQC writes it, or null. */
export function findContaminant(seq: string): string | null {
  const query = seq.toUpperCase()
  const { list, seeds } = contaminants()
  let candidates: Iterable<number>
  if (query.length < 20) {
    candidates = list.keys()
  } else {
    const found = new Set<number>()
    for (let k = 0; k + SEED <= query.length; k++) for (const i of seeds.get(query.slice(k, k + SEED)) ?? []) found.add(i)
    // In list order, so that ties go to the same contaminant as in FastQC.
    candidates = [...found].sort((a, b) => a - b)
  }
  let best: Hit | null = null
  for (const i of candidates) {
    const h = matchOne(list[i].name, list[i].strands, query)
    if (h && better(best, h.length, h.identity)) best = h
  }
  return best ? `${best.name} (${best.identity}% over ${best.length}bp)` : null
}
