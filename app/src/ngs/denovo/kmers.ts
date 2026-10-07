/**
 * How much of one sequence is in another, by shared k-mers.
 *
 * Contigs are compared by their canonical 15-mers (a k-mer and its reverse
 * complement count as one, so strand does not matter). Two unrelated
 * sequences of plasmid size share next to none; a contig made from a dimer
 * read has every k-mer of the monomer and the monomer every k-mer of it; a
 * plasmid without an insert has nearly every k-mer of the one with it, but
 * not the other way round.
 */

export const CONTAIN_K = 15

const CODE: Record<string, number> = { A: 0, C: 1, G: 2, T: 3, a: 0, c: 1, g: 2, t: 3 }

/** Canonical k-mers of a sequence (k at most 15, so each fits in 30 bits); `circular` adds those across the origin. */
export function kmerSet(seq: string, circular = false, k = CONTAIN_K): Set<number> {
  const out = new Set<number>()
  const s = circular && seq.length >= k ? seq + seq.slice(0, k - 1) : seq
  const mask = (1 << (2 * k)) - 1
  const shift = 2 * (k - 1)
  let fwd = 0
  let rev = 0
  let valid = 0
  for (let i = 0; i < s.length; i++) {
    const c = CODE[s[i]]
    if (c === undefined) { valid = 0; fwd = 0; rev = 0; continue }
    fwd = ((fwd << 2) | c) & mask
    rev = (rev >>> 2) | ((3 - c) << shift)
    if (++valid >= k) out.add(Math.min(fwd >>> 0, rev >>> 0))
  }
  return out
}

/** Share of `a`'s k-mers that are in `b`. */
export function containment(a: Set<number>, b: Set<number>): number {
  if (a.size === 0) return 0
  let n = 0
  for (const x of a) if (b.has(x)) n++
  return n / a.size
}
