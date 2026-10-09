/**
 * Per-residue scales. One table per scale, keyed by one-letter code; a
 * residue a scale does not know (X, B, Z, stops) is simply absent, and the
 * callers average over the residues that are present.
 */

/** Kyte J, Doolittle RF (1982) hydropathy. Positive is hydrophobic. */
export const KYTE_DOOLITTLE: Readonly<Record<string, number>> = {
  I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8, G: -0.4, T: -0.7, S: -0.8,
  W: -0.9, Y: -1.3, P: -1.6, H: -3.2, E: -3.5, Q: -3.5, D: -3.5, N: -3.5, K: -3.9, R: -4.5,
}
