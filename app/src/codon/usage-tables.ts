/**
 * Codon usage tables.
 *
 * A table says how often each codon is used for its amino acid in a host. The
 * optimizer reads two things off it: which codon to reach for first, and which
 * codons are rare enough to be worth replacing.
 *
 * Provenance matters here, so every table carries a `source` line and the
 * built-ins are flagged `approximate`. They are written from published
 * genome-wide averages: the rankings and the rare-codon calls are right, but
 * the low-order digits may differ from any particular reference set. Anyone
 * who needs exact numbers imports their own table or derives one from the
 * CDS features of the sequence in front of them, which is the most defensible
 * option of the three.
 *
 * Fractions are stored per amino acid family under the standard code. When a
 * different genetic code regroups codons (TGA joining tryptophan in the
 * mitochondrial codes, say) the family is renormalised on the fly. That is an
 * approximation for those codes and exact for tables 1 and 11.
 */

import { geneticCode, synonymsFor, type GeneticCode } from './genetic-codes'

export interface CodonUsageTable {
  id: string
  name: string
  /** Where the numbers came from. Shown next to the selector. */
  source: string
  /** True for the shipped tables: published averages, not a specific dataset. */
  approximate: boolean
  /** Relative frequency within the amino acid family, 0..1, per codon. */
  fractions: Record<string, number>
}

/**
 * Build a table, normalising each standard-code family to sum to 1.
 *
 * Hand-written percentages never quite add up, and a family that sums to 0.98
 * would quietly bias every weight derived from it.
 */
function defineTable(
  id: string, name: string, source: string, raw: Record<string, number>,
): CodonUsageTable {
  const standard = geneticCode(1)
  const fractions: Record<string, number> = {}
  const seen = new Set<string>()
  for (const codon of Object.keys(raw)) {
    const aa = standard.table[codon]
    if (!aa || seen.has(codon)) continue
    const family = synonymsFor(standard, aa)
    const total = family.reduce((sum, c) => sum + (raw[c] ?? 0), 0)
    for (const c of family) {
      fractions[c] = total > 0 ? (raw[c] ?? 0) / total : 1 / family.length
      seen.add(c)
    }
  }
  return { id, name, source, approximate: true, fractions }
}

const KAZUSA = 'Published genome-wide averages (Kazusa-style codon usage), rounded'

export const BUILTIN_USAGE_TABLES: CodonUsageTable[] = [
  defineTable('ecoli-k12', 'E. coli K-12', KAZUSA, {
    TTT: 58, TTC: 42, TTA: 14, TTG: 13, CTT: 12, CTC: 10, CTA: 4, CTG: 47,
    ATT: 49, ATC: 39, ATA: 11, ATG: 100, GTT: 28, GTC: 20, GTA: 17, GTG: 35,
    TCT: 15, TCC: 15, TCA: 14, TCG: 14, AGT: 16, AGC: 26,
    CCT: 18, CCC: 13, CCA: 20, CCG: 49, ACT: 19, ACC: 40, ACA: 17, ACG: 24,
    GCT: 18, GCC: 26, GCA: 23, GCG: 33, TAT: 59, TAC: 41,
    TAA: 61, TAG: 9, TGA: 30, CAT: 57, CAC: 43, CAA: 34, CAG: 66,
    AAT: 49, AAC: 51, AAA: 74, AAG: 26, GAT: 63, GAC: 37, GAA: 68, GAG: 32,
    TGT: 46, TGC: 54, TGG: 100,
    CGT: 36, CGC: 36, CGA: 7, CGG: 10, AGA: 7, AGG: 4,
    GGT: 35, GGC: 37, GGA: 13, GGG: 15,
  }),
  defineTable('bsubtilis', 'B. subtilis 168', KAZUSA, {
    TTT: 70, TTC: 30, TTA: 21, TTG: 15, CTT: 23, CTC: 11, CTA: 6, CTG: 24,
    ATT: 49, ATC: 37, ATA: 14, ATG: 100, GTT: 26, GTC: 20, GTA: 19, GTG: 35,
    TCT: 13, TCC: 10, TCA: 24, TCG: 11, AGT: 13, AGC: 29,
    CCT: 24, CCC: 13, CCA: 19, CCG: 44, ACT: 22, ACC: 17, ACA: 39, ACG: 22,
    GCT: 26, GCC: 20, GCA: 28, GCG: 26, TAT: 66, TAC: 34,
    TAA: 61, TAG: 15, TGA: 24, CAT: 67, CAC: 33, CAA: 51, CAG: 49,
    AAT: 57, AAC: 43, AAA: 70, AAG: 30, GAT: 64, GAC: 36, GAA: 68, GAG: 32,
    TGT: 45, TGC: 55, TGG: 100,
    CGT: 18, CGC: 21, CGA: 10, CGG: 16, AGA: 23, AGG: 12,
    GGT: 24, GGC: 31, GGA: 24, GGG: 21,
  }),
  defineTable('scerevisiae', 'S. cerevisiae', KAZUSA, {
    TTT: 59, TTC: 41, TTA: 28, TTG: 29, CTT: 13, CTC: 6, CTA: 13, CTG: 11,
    ATT: 46, ATC: 26, ATA: 28, ATG: 100, GTT: 39, GTC: 21, GTA: 21, GTG: 19,
    TCT: 26, TCC: 16, TCA: 21, TCG: 10, AGT: 16, AGC: 11,
    CCT: 31, CCC: 15, CCA: 42, CCG: 12, ACT: 35, ACC: 22, ACA: 30, ACG: 13,
    GCT: 38, GCC: 22, GCA: 29, GCG: 11, TAT: 56, TAC: 44,
    TAA: 47, TAG: 23, TGA: 30, CAT: 64, CAC: 36, CAA: 69, CAG: 31,
    AAT: 59, AAC: 41, AAA: 58, AAG: 42, GAT: 65, GAC: 35, GAA: 70, GAG: 30,
    TGT: 63, TGC: 37, TGG: 100,
    CGT: 14, CGC: 6, CGA: 7, CGG: 4, AGA: 48, AGG: 21,
    GGT: 47, GGC: 19, GGA: 22, GGG: 12,
  }),
  defineTable('ppastoris', 'P. pastoris (K. phaffii)', KAZUSA, {
    TTT: 56, TTC: 44, TTA: 15, TTG: 33, CTT: 17, CTC: 8, CTA: 12, CTG: 15,
    ATT: 50, ATC: 31, ATA: 19, ATG: 100, GTT: 42, GTC: 23, GTA: 16, GTG: 19,
    TCT: 29, TCC: 20, TCA: 19, TCG: 9, AGT: 14, AGC: 9,
    CCT: 34, CCC: 16, CCA: 40, CCG: 10, ACT: 38, ACC: 26, ACA: 24, ACG: 12,
    GCT: 45, GCC: 26, GCA: 22, GCG: 7, TAT: 45, TAC: 55,
    TAA: 47, TAG: 23, TGA: 30, CAT: 55, CAC: 45, CAA: 63, CAG: 37,
    AAT: 51, AAC: 49, AAA: 47, AAG: 53, GAT: 61, GAC: 39, GAA: 58, GAG: 42,
    TGT: 62, TGC: 38, TGG: 100,
    CGT: 16, CGC: 5, CGA: 11, CGG: 5, AGA: 47, AGG: 16,
    GGT: 42, GGC: 16, GGA: 30, GGG: 12,
  }),
  defineTable('human', 'H. sapiens', KAZUSA, {
    TTT: 45, TTC: 55, TTA: 7, TTG: 13, CTT: 13, CTC: 20, CTA: 7, CTG: 40,
    ATT: 36, ATC: 48, ATA: 16, ATG: 100, GTT: 18, GTC: 24, GTA: 11, GTG: 47,
    TCT: 18, TCC: 22, TCA: 15, TCG: 6, AGT: 15, AGC: 24,
    CCT: 28, CCC: 33, CCA: 27, CCG: 12, ACT: 24, ACC: 36, ACA: 28, ACG: 12,
    GCT: 26, GCC: 40, GCA: 23, GCG: 11, TAT: 43, TAC: 57,
    TAA: 28, TAG: 20, TGA: 52, CAT: 41, CAC: 59, CAA: 25, CAG: 75,
    AAT: 46, AAC: 54, AAA: 42, AAG: 58, GAT: 46, GAC: 54, GAA: 42, GAG: 58,
    TGT: 45, TGC: 55, TGG: 100,
    CGT: 8, CGC: 19, CGA: 11, CGG: 21, AGA: 20, AGG: 21,
    GGT: 16, GGC: 34, GGA: 25, GGG: 25,
  }),
  defineTable('cho', 'CHO (C. griseus)', KAZUSA, {
    TTT: 46, TTC: 54, TTA: 6, TTG: 13, CTT: 13, CTC: 19, CTA: 8, CTG: 41,
    ATT: 34, ATC: 51, ATA: 15, ATG: 100, GTT: 18, GTC: 24, GTA: 12, GTG: 46,
    TCT: 20, TCC: 22, TCA: 14, TCG: 5, AGT: 15, AGC: 24,
    CCT: 31, CCC: 32, CCA: 28, CCG: 9, ACT: 26, ACC: 37, ACA: 28, ACG: 9,
    GCT: 31, GCC: 38, GCA: 23, GCG: 8, TAT: 42, TAC: 58,
    TAA: 27, TAG: 19, TGA: 54, CAT: 43, CAC: 57, CAA: 25, CAG: 75,
    AAT: 44, AAC: 56, AAA: 40, AAG: 60, GAT: 47, GAC: 53, GAA: 42, GAG: 58,
    TGT: 47, TGC: 53, TGG: 100,
    CGT: 10, CGC: 18, CGA: 13, CGG: 19, AGA: 21, AGG: 19,
    GGT: 19, GGC: 33, GGA: 25, GGG: 23,
  }),
  defineTable('sf9', 'S. frugiperda (Sf9)', KAZUSA, {
    TTT: 38, TTC: 62, TTA: 7, TTG: 23, CTT: 15, CTC: 16, CTA: 6, CTG: 33,
    ATT: 35, ATC: 47, ATA: 18, ATG: 100, GTT: 23, GTC: 25, GTA: 13, GTG: 39,
    TCT: 17, TCC: 20, TCA: 14, TCG: 17, AGT: 13, AGC: 19,
    CCT: 23, CCC: 30, CCA: 28, CCG: 19, ACT: 23, ACC: 36, ACA: 24, ACG: 17,
    GCT: 27, GCC: 35, GCA: 22, GCG: 16, TAT: 39, TAC: 61,
    TAA: 40, TAG: 25, TGA: 35, CAT: 42, CAC: 58, CAA: 34, CAG: 66,
    AAT: 42, AAC: 58, AAA: 36, AAG: 64, GAT: 50, GAC: 50, GAA: 40, GAG: 60,
    TGT: 41, TGC: 59, TGG: 100,
    CGT: 16, CGC: 22, CGA: 11, CGG: 13, AGA: 19, AGG: 19,
    GGT: 24, GGC: 31, GGA: 27, GGG: 18,
  }),
  defineTable('athaliana', 'A. thaliana', KAZUSA, {
    TTT: 51, TTC: 49, TTA: 14, TTG: 22, CTT: 26, CTC: 17, CTA: 11, CTG: 10,
    ATT: 41, ATC: 35, ATA: 24, ATG: 100, GTT: 41, GTC: 19, GTA: 15, GTG: 25,
    TCT: 28, TCC: 13, TCA: 20, TCG: 10, AGT: 16, AGC: 13,
    CCT: 38, CCC: 11, CCA: 33, CCG: 18, ACT: 34, ACC: 20, ACA: 30, ACG: 16,
    GCT: 44, GCC: 16, GCA: 27, GCG: 13, TAT: 52, TAC: 48,
    TAA: 36, TAG: 20, TGA: 44, CAT: 61, CAC: 39, CAA: 56, CAG: 44,
    AAT: 52, AAC: 48, AAA: 49, AAG: 51, GAT: 68, GAC: 32, GAA: 52, GAG: 48,
    TGT: 60, TGC: 40, TGG: 100,
    CGT: 17, CGC: 7, CGA: 12, CGG: 9, AGA: 35, AGG: 20,
    GGT: 34, GGC: 14, GGA: 37, GGG: 15,
  }),
]

export const DEFAULT_USAGE_TABLE_ID = 'ecoli-k12'

/**
 * Per-codon fraction within its family under the given code.
 *
 * For codes 1 and 11 this is the stored value. For a code that regroups
 * codons it renormalises the stored values within the new family, which keeps
 * the ordering sensible without pretending to be a measured table.
 *
 * A family with no usage at all stays at zero rather than being spread
 * evenly. Deciding what an absent family means is a judgement call, and it is
 * made once, by whoever wrote the table, and a zero here is information:
 * `unusableResidues` reports it and the UI warns before a run.
 */
export function familyFractions(
  table: CodonUsageTable, code: GeneticCode,
): Record<string, number> {
  const out: Record<string, number> = {}
  const residues = new Set(Object.values(code.table))
  for (const aa of residues) {
    const family = synonymsFor(code, aa)
    const total = family.reduce((sum, c) => sum + (table.fractions[c] ?? 0), 0)
    for (const c of family) {
      out[c] = total > 0 ? (table.fractions[c] ?? 0) / total : 0
    }
  }
  return out
}

/**
 * Relative adaptiveness: each codon over the most-used codon of its family.
 *
 * This is the w of the CAI definition, and it is also the natural preference
 * order for the optimizer.
 */
export function relativeAdaptiveness(
  table: CodonUsageTable, code: GeneticCode,
): Record<string, number> {
  const fractions = familyFractions(table, code)
  const out: Record<string, number> = {}
  const residues = new Set(Object.values(code.table))
  for (const aa of residues) {
    const family = synonymsFor(code, aa)
    const best = family.reduce((m, c) => Math.max(m, fractions[c] ?? 0), 0)
    // A family the table knows nothing about scores zero, not one. CAI skips
    // those codons rather than crediting them.
    for (const c of family) out[c] = best > 0 ? (fractions[c] ?? 0) / best : 0
  }
  return out
}

/**
 * Codons used less than `thresholdPercent` of the time within their family.
 *
 * Single-codon families (Met, Trp) are never rare: there is nothing to swap
 * them for, and reporting them would be noise.
 */
export function rareCodons(
  table: CodonUsageTable, code: GeneticCode, thresholdPercent: number,
): Set<string> {
  const fractions = familyFractions(table, code)
  const out = new Set<string>()
  const residues = new Set(Object.values(code.table))
  for (const aa of residues) {
    const family = synonymsFor(code, aa)
    if (family.length < 2) continue
    for (const c of family) {
      if ((fractions[c] ?? 0) * 100 < thresholdPercent) out.add(c)
    }
  }
  return out
}

/** The most-used codon of each amino acid's family. */
export function bestCodons(
  table: CodonUsageTable, code: GeneticCode,
): Record<string, string> {
  const fractions = familyFractions(table, code)
  const out: Record<string, string> = {}
  const residues = new Set(Object.values(code.table))
  for (const aa of residues) {
    const family = synonymsFor(code, aa)
    let best = family[0]
    for (const c of family) if ((fractions[c] ?? 0) > (fractions[best] ?? 0)) best = c
    out[aa] = best
  }
  return out
}

/**
 * Amino acids the table has no usable codon for.
 *
 * An imported table can easily have a family that is all zeros, either
 * because the source organism never used it or because the file was partial;
 * optimizing a protein containing that residue would have nothing to choose
 * from.
 */
export function unusableResidues(
  table: CodonUsageTable, code: GeneticCode, protein: string,
): string[] {
  const fractions = familyFractions(table, code)
  const bad = new Set<string>()
  for (const aa of new Set(protein)) {
    const family = synonymsFor(code, aa)
    if (family.length === 0) { bad.add(aa); continue }
    if (!family.some(c => (fractions[c] ?? 0) > 0)) bad.add(aa)
  }
  return [...bad].sort()
}
