/**
 * The two alphabets a document can be written in.
 *
 * A protein is the same document as a DNA sequence: the same piece table,
 * the same annotations, the same undo history. Only the letters differ, and
 * what can sensibly be done with them (nothing here complements or
 * translates a protein). The alphabet lives on the Sequence next to its
 * topology, and everything that is DNA-only reads it from there.
 */

export type Alphabet = 'dna' | 'protein'

/**
 * The residues a protein document may hold: the twenty standard amino acids,
 * selenocysteine (U) and pyrrolysine (O), the ambiguity codes B (D or N),
 * Z (E or Q), J (I or L) and X (any), and the stop.
 */
export const PROTEIN_RESIDUES = 'ACDEFGHIKLMNPQRSTVWYUOBZJX*'

/** Every nucleotide code: the four bases, U, and the IUPAC ambiguity codes. */
export const NUCLEOTIDE_CODES = 'ACGTURYSWKMBDHVN'

const PROTEIN_RE = /^[ACDEFGHIKLMNPQRSTVWYUOBZJX*]*$/i
const NUCLEOTIDE_RE = /^[ACGTURYSWKMBDHVN]*$/i
/** Letters that occur in proteins but are not nucleotide codes. */
const PROTEIN_ONLY_RE = /[EFIJLOPQXZ*]/i

export function isValidSequence(text: string, alphabet: Alphabet): boolean {
  return (alphabet === 'protein' ? PROTEIN_RE : NUCLEOTIDE_RE).test(text)
}

/** The characters of `text` that are not codes of the alphabet, each once. */
export function invalidCharacters(text: string, alphabet: Alphabet): string[] {
  const re = alphabet === 'protein' ? /[ACDEFGHIKLMNPQRSTVWYUOBZJX*]/gi : /[ACGTURYSWKMBDHVN]/gi
  return [...new Set(text.replace(re, ''))]
}

/**
 * Which alphabet a stretch of letters is written in.
 *
 * A letter that only a protein can hold settles it. Otherwise nucleotide
 * letters have to dominate: a real DNA sequence is almost entirely A, C, G,
 * T, U and N even with ambiguity codes about, while a protein written only
 * in letters that happen to be IUPAC codes (all of ACDGHKMNRSTVWY are) is
 * still mostly not ACGTUN.
 */
export function guessAlphabet(text: string): Alphabet {
  if (PROTEIN_ONLY_RE.test(text)) return 'protein'
  let nuc = 0
  let total = 0
  for (let i = 0; i < text.length && total < 200_000; i++) {
    const c = text.charCodeAt(i) & ~0x20 // upper case
    if (c < 65 || c > 90) continue
    total++
    // A C G T U N
    if (c === 65 || c === 67 || c === 71 || c === 84 || c === 85 || c === 78) nuc++
  }
  if (total === 0) return 'dna'
  return nuc / total >= 0.9 ? 'dna' : 'protein'
}

/** "bp" or "aa": the unit a length is counted in. */
export function unitOf(alphabet: Alphabet): string {
  return alphabet === 'protein' ? 'aa' : 'bp'
}
