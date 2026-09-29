/**
 * The optimizer.
 *
 * The first describe block is the one that matters: whatever the settings, the
 * protein must survive. The rest check that each option actually does what the
 * dialog says it does, since a constraint that is quietly ignored looks exactly
 * like a constraint that was satisfied.
 */
import { describe, it, expect } from 'vitest'
import { optimizeRegion, DEFAULT_OPTIMIZE_OPTIONS, type OptimizeOptions } from './optimize'
import { ConstraintSet, DEFAULT_CONSTRAINTS, type ConstraintOptions } from './constraints'
import { geneticCode, translateWith, GENETIC_CODES } from './genetic-codes'
import { BUILTIN_USAGE_TABLES, bestCodons, rareCodons } from './usage-tables'

const ecoli = BUILTIN_USAGE_TABLES.find(t => t.id === 'ecoli-k12')!
const human = BUILTIN_USAGE_TABLES.find(t => t.id === 'human')!
const standard = geneticCode(1)

const opts = (over: Partial<OptimizeOptions> = {}): OptimizeOptions => ({
  ...DEFAULT_OPTIMIZE_OPTIONS,
  code: standard,
  table: ecoli,
  constraints: new ConstraintSet(DEFAULT_CONSTRAINTS),
  ...over,
})

const constraints = (over: Partial<ConstraintOptions>) =>
  new ConstraintSet({ ...DEFAULT_CONSTRAINTS, ...over })

const NO_LOCKS = new Map<number, string>()

/** A deterministic pseudo-random coding sequence, always ATG..TAA. */
function randomOrf(codons: number, seed: number): string {
  const sense = Object.keys(standard.table).filter(c => standard.table[c] !== '*')
  let a = seed * 2654435761 % 2147483647
  const next = () => (a = (a * 48271) % 2147483647) / 2147483647
  const out = ['ATG']
  for (let i = 1; i < codons - 1; i++) out.push(sense[Math.floor(next() * sense.length)])
  out.push('TAA')
  return out.join('')
}

describe('the protein is preserved', () => {
  it('survives every mode, strategy and genetic code', () => {
    for (const code of GENETIC_CODES) {
      for (const mode of ['all', 'rare-only'] as const) {
        for (const strategy of ['most-frequent', 'usage-weighted'] as const) {
          const dna = randomOrf(60, code.id + (mode === 'all' ? 7 : 13))
          const result = optimizeRegion(dna, NO_LOCKS, opts({ code, mode, strategy }))
          expect(translateWith(code, result.bases)).toBe(translateWith(code, dna))
          expect(result.bases).toHaveLength(dna.length)
        }
      }
    }
  })

  it('survives two hundred random sequences under heavy constraints', () => {
    const set = constraints({
      motifs: [{ name: 'EcoRI', sequence: 'GAATTC' }, { name: 'BsaI', sequence: 'GGTCTC' }],
      maxHomopolymerAT: 4,
      maxHomopolymerGC: 4,
      avoidCpG: true,
    })
    for (let seed = 1; seed <= 200; seed++) {
      const dna = randomOrf(40, seed)
      const result = optimizeRegion(dna, NO_LOCKS, opts({ constraints: set }))
      expect(translateWith(standard, result.bases)).toBe(translateWith(standard, dna))
    }
  })

  it('leaves a trailing partial codon untouched', () => {
    const dna = 'ATGAAATT'
    const result = optimizeRegion(dna, NO_LOCKS, opts())
    expect(result.bases.slice(6)).toBe('TT')
    expect(result.bases).toHaveLength(8)
  })

  it('passes ambiguous codons through rather than guessing', () => {
    const dna = 'ATGNNNAAA'
    const result = optimizeRegion(dna, NO_LOCKS, opts())
    expect(result.bases.slice(3, 6)).toBe('NNN')
  })
})

describe('codon choice', () => {
  it('takes the most used codon of each family', () => {
    const best = bestCodons(ecoli, standard)
    // Three leucines and three arginines, all in rare codons to start with.
    const dna = 'CTACTACTAAGGAGGAGG'
    const result = optimizeRegion(dna, NO_LOCKS, opts())
    expect(result.bases).toBe(best.L.repeat(3) + best.R.repeat(3))
    expect(result.changes).toHaveLength(6)
  })

  it('follows the table it is given', () => {
    const dna = 'AGAAGAAGA'
    const forEcoli = optimizeRegion(dna, NO_LOCKS, opts({ table: ecoli })).bases
    const forYeast = optimizeRegion(dna, NO_LOCKS, opts({
      table: BUILTIN_USAGE_TABLES.find(t => t.id === 'scerevisiae')!,
    })).bases
    expect(forEcoli).not.toBe(forYeast)
    expect(forYeast).toBe('AGAAGAAGA')   // AGA is the yeast favourite already
  })

  it('reports what it changed', () => {
    const result = optimizeRegion('CTAATG', NO_LOCKS, opts())
    expect(result.changes).toEqual([
      { index: 0, aa: 'L', from: 'CTA', to: bestCodons(ecoli, standard).L },
    ])
  })

  it('respects the genetic code when choosing synonyms', () => {
    // Under table 2, TGA codes for tryptophan, so a TGG may become TGA.
    const result = optimizeRegion('TGGTGGTGG', NO_LOCKS, opts({ code: geneticCode(2) }))
    expect(translateWith(geneticCode(2), result.bases)).toBe('WWW')
  })
})

describe('rare-only mode', () => {
  it('replaces the rare codons and leaves the rest alone', () => {
    const rare = rareCodons(ecoli, standard, 10)
    expect(rare.has('AGG')).toBe(true)
    // CTG and GAA are the E. coli favourites; AGG is rare.
    const dna = 'CTGGAAAGG'
    const result = optimizeRegion(dna, NO_LOCKS, opts({ mode: 'rare-only' }))
    expect(result.bases.slice(0, 6)).toBe('CTGGAA')
    expect(result.bases.slice(6)).not.toBe('AGG')
    expect(result.changes).toHaveLength(1)
  })

  it('changes nothing when no codon is rare', () => {
    const result = optimizeRegion('CTGGAA', NO_LOCKS, opts({ mode: 'rare-only' }))
    expect(result.changes).toEqual([])
  })

  it('widens with the threshold', () => {
    const dna = randomOrf(50, 3)
    const few = optimizeRegion(dna, NO_LOCKS, opts({ mode: 'rare-only', rareThreshold: 5 }))
    const many = optimizeRegion(dna, NO_LOCKS, opts({ mode: 'rare-only', rareThreshold: 25 }))
    expect(many.changes.length).toBeGreaterThan(few.changes.length)
  })
})

describe('locked codons', () => {
  it('leaves a locked codon exactly as it was', () => {
    const dna = 'CTACTACTA'
    const locked = new Map([[1, 'protected feature']])
    const result = optimizeRegion(dna, locked, opts())
    expect(result.bases.slice(3, 6)).toBe('CTA')
    expect(result.bases.slice(0, 3)).not.toBe('CTA')
  })
})

describe('constraints', () => {
  it('avoids a restriction site the input contains', () => {
    // GAA TTC is a perfectly good Glu-Phe pair that spells EcoRI.
    const dna = 'ATGGAATTCAAA'
    const set = constraints({ motifs: [{ name: 'EcoRI', sequence: 'GAATTC' }] })
    const result = optimizeRegion(dna, NO_LOCKS, opts({ constraints: set }))

    expect(result.bases).not.toContain('GAATTC')
    expect(translateWith(standard, result.bases)).toBe('MEFK')
    expect(result.violations).toHaveLength(0)
  })

  it('avoids a site that only appears on the reverse strand', () => {
    const set = constraints({ motifs: [{ name: 'BsaI', sequence: 'GGTCTC' }] })
    const dna = 'ATGGAGACCAAA'            // GAGACC is BsaI reversed
    const result = optimizeRegion(dna, NO_LOCKS, opts({ constraints: set }))
    expect(result.bases).not.toContain('GAGACC')
    expect(translateWith(standard, result.bases)).toBe(translateWith(standard, dna))
  })

  it('avoids a site that would straddle the region boundary', () => {
    const set = constraints({ motifs: [{ name: 'EcoRI', sequence: 'GAATTC' }] })
    // The region ends in GAA and the untouched flank starts with TTC.
    const result = optimizeRegion('ATGGAA', NO_LOCKS, opts({ constraints: set }), {
      before: '', after: 'TTCGGG',
    })
    expect((result.bases + 'TTCGGG')).not.toContain('GAATTC')
  })

  it('keeps homopolymers under their separate limits', () => {
    const set = constraints({ maxHomopolymerAT: 3, maxHomopolymerGC: 3 })
    const dna = 'AAAAAAAAACCCCCCCCC'      // KKK PPP, all one base
    const result = optimizeRegion(dna, NO_LOCKS, opts({ constraints: set }))
    expect(result.bases).not.toMatch(/AAAA|TTTT|GGGG|CCCC/)
    expect(translateWith(standard, result.bases)).toBe('KKKPPP')
  })

  it('applies the A/T and G/C limits independently, and owns up to the rest', () => {
    // Some runs are unavoidable: tryptophan is only ever TGG, and every valine
    // and glycine codon starts with G, so W followed by either spells GGG
    // whatever is chosen. What must hold is that every run left in the output
    // is one the report admits to.
    const set = constraints({ maxHomopolymerAT: 6, maxHomopolymerGC: 2 })
    const result = optimizeRegion(randomOrf(60, 9), NO_LOCKS, opts({ constraints: set }))

    const reported = result.violations.filter(v => v.kind === 'homopolymer')
    const covered = (at: number) => reported.some(v => v.start <= at && v.end > at)
    for (const match of result.bases.matchAll(/(G{3,}|C{3,}|A{7,}|T{7,})/g)) {
      expect(covered(match.index)).toBe(true)
    }
    // The A/T limit is looser, so it should not be the one being broken.
    expect(result.bases).not.toMatch(/A{7,}|T{7,}/)
  })

  it('avoids CpG when asked', () => {
    const set = constraints({ avoidCpG: true })
    // Proline and alanine can both be spelled without CG.
    const result = optimizeRegion('CCGGCGCCGGCG', NO_LOCKS, opts({ table: human, constraints: set }))
    expect(result.bases).not.toContain('CG')
    expect(translateWith(standard, result.bases)).toBe('PAPA')
  })

  it('breaks up direct repeats', () => {
    const set = constraints({ maxRepeat: 8 })
    // The same six codons twice over.
    const unit = 'CTGGAAGCGAAACTGGAA'
    const result = optimizeRegion(unit + unit, NO_LOCKS, opts({ constraints: set }))
    expect(result.violations.filter(v => v.kind === 'repeat')).toHaveLength(0)
    expect(translateWith(standard, result.bases)).toBe(translateWith(standard, unit + unit))
  })

  it('reports what it could not fix instead of pretending', () => {
    // Every synonymous codon for tryptophan is TGG, so a TGGTGG run cannot
    // avoid a 4 bp G/C-free window: the limit is unsatisfiable here.
    const set = constraints({ motifs: [{ name: 'Trp pair', sequence: 'TGGTGG' }] })
    const result = optimizeRegion('TGGTGG', NO_LOCKS, opts({ constraints: set }))

    expect(result.bases).toBe('TGGTGG')
    expect(result.violations.some(v => v.kind === 'motif')).toBe(true)
    expect(result.unresolved).toBeGreaterThan(0)
  })
})

describe('reproducibility', () => {
  it('gives the same answer for the same seed, and a different one otherwise', () => {
    const dna = randomOrf(80, 11)
    const run = (seed: number) =>
      optimizeRegion(dna, NO_LOCKS, opts({ strategy: 'usage-weighted', seed })).bases

    expect(run(42)).toBe(run(42))
    expect(run(42)).not.toBe(run(43))
  })

  it('spreads codons more evenly than most-frequent does', () => {
    const dna = 'CTG'.repeat(40)
    const frequent = optimizeRegion(dna, NO_LOCKS, opts()).bases
    const weighted = optimizeRegion(dna, NO_LOCKS, opts({ strategy: 'usage-weighted', seed: 5 })).bases
    const distinct = (s: string) => new Set(s.match(/.{3}/g)).size

    expect(distinct(frequent)).toBe(1)
    expect(distinct(weighted)).toBeGreaterThan(1)
  })
})
