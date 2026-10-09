/**
 * Bases (or residues) from pasted text, or a reason to refuse the paste.
 *
 * Paste used to keep every IUPAC letter in the clipboard and drop the rest,
 * so pasting a FASTA record inserted the letters of its header as bases
 * (">my_seq description" gives MYSDSCRT…), and GenBank text gave the letters
 * of "ORIGIN". Now the parts of common formats that are not sequence are set
 * aside first, layout characters (spaces, line numbers, alignment gaps) are
 * dropped, and anything else that is not a code of the document's alphabet
 * refuses the paste.
 */

import { invalidCharacters, type Alphabet } from '../models/alphabet'

export type PastedBases =
  | { ok: true; bases: string }
  | { ok: false; reason: string }

export function basesFromPaste(text: string, alphabet: Alphabet = 'dna'): PastedBases {
  let lines = text.split(/\r?\n/)

  // GenBank/EMBL record: only the sequence block counts.
  const origin = lines.findIndex(l => /^(ORIGIN|SQ )/.test(l))
  if (origin >= 0) {
    const end = lines.findIndex((l, i) => i > origin && l.startsWith('//'))
    lines = lines.slice(origin + 1, end < 0 ? undefined : end)
  }

  // FASTA headers and comment lines.
  lines = lines.filter(l => !/^\s*[>;]/.test(l))

  const bases = lines.join('').replace(/[\s\d\-.]/g, '')
  const odd = invalidCharacters(bases, alphabet)
  if (odd.length > 0) {
    const what = alphabet === 'protein' ? 'amino acid' : 'nucleotide'
    return { ok: false, reason: `Contains characters that are not ${what} codes: ${odd.slice(0, 8).join(' ')}` }
  }
  return { ok: true, bases: bases.toUpperCase() }
}
