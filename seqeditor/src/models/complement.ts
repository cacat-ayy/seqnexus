/**
 * DNA/RNA complement map and utility functions.
 *
 * Single source of truth - imported by Sequence, SequenceView, enzyme finder,
 * and ORF finder worker.
 */

export const COMPLEMENT: Record<string, string> = {
  A: 'T', T: 'A', G: 'C', C: 'G',
  a: 't', t: 'a', g: 'c', c: 'g',
  R: 'Y', Y: 'R', S: 'S', W: 'W',
  K: 'M', M: 'K', B: 'V', V: 'B',
  D: 'H', H: 'D', N: 'N',
  r: 'y', y: 'r', s: 's', w: 'w',
  k: 'm', m: 'k', b: 'v', v: 'b',
  d: 'h', h: 'd', n: 'n',
  U: 'A', u: 'a',
}

/** Complement a single base. Returns 'N' for unknown bases. */
export function complementBase(base: string): string {
  return COMPLEMENT[base] ?? base
}

/** Reverse-complement a DNA/RNA string. */
export function reverseComplement(seq: string): string {
  const len = seq.length
  const result: string[] = new Array(len)
  for (let i = 0; i < len; i++) {
    result[len - 1 - i] = COMPLEMENT[seq[i]] ?? 'N'
  }
  return result.join('')
}
