/** Standard genetic code codon table. */
export const CODON_TABLE: Record<string, string> = {
  TTT:'F',TTC:'F',TTA:'L',TTG:'L',CTT:'L',CTC:'L',CTA:'L',CTG:'L',
  ATT:'I',ATC:'I',ATA:'I',ATG:'M',GTT:'V',GTC:'V',GTA:'V',GTG:'V',
  TCT:'S',TCC:'S',TCA:'S',TCG:'S',CCT:'P',CCC:'P',CCA:'P',CCG:'P',
  ACT:'T',ACC:'T',ACA:'T',ACG:'T',GCT:'A',GCC:'A',GCA:'A',GCG:'A',
  TAT:'Y',TAC:'Y',TAA:'*',TAG:'*',CAT:'H',CAC:'H',CAA:'Q',CAG:'Q',
  AAT:'N',AAC:'N',AAA:'K',AAG:'K',GAT:'D',GAC:'D',GAA:'E',GAG:'E',
  TGT:'C',TGC:'C',TGA:'*',TGG:'W',CGT:'R',CGC:'R',CGA:'R',CGG:'R',
  AGT:'S',AGC:'S',AGA:'R',AGG:'R',GGT:'G',GGC:'G',GGA:'G',GGG:'G',
}

/** Translate a single codon to its amino acid letter. */
export function translateCodon(codon: string): string {
  return CODON_TABLE[codon.toUpperCase()] ?? '?'
}

/** Translate a DNA string to an amino acid string. */
export function translate(dna: string): string {
  const upper = dna.toUpperCase()
  const aas: string[] = []
  for (let i = 0; i + 2 < upper.length; i += 3) {
    aas.push(CODON_TABLE[upper.slice(i, i + 3)] ?? '?')
  }
  return aas.join('')
}
