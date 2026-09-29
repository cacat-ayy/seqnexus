/**
 * Importing a codon usage table.
 *
 * The two samples below are transcribed from what EMBOSS cusp and GCG
 * CodonFrequency actually write, down to the header wording and the column
 * order, which is the part that matters: the two formats order Fraction and
 * Number differently, so a parser that guessed by position would read counts
 * as fractions for one of them.
 */
import { describe, it, expect } from 'vitest'
import { parseUsageTable, describeUsageImport, UsageImportError } from './usage-import'
import { geneticCode, synonymsFor } from './genetic-codes'
import { familyFractions } from './usage-tables'

const standard = geneticCode(1)

/** Every codon of a family used equally, in a plain two-column list. */
function evenTable(separator = ' '): string {
  const bases = 'TCAG'
  const lines: string[] = []
  for (const a of bases) for (const b of bases) for (const c of bases) {
    lines.push(`${a}${b}${c}${separator}10`)
  }
  return lines.join('\n')
}

const ALL_CODONS: string[] = []
for (const a of 'TCAG') for (const b of 'TCAG') for (const c of 'TCAG') ALL_CODONS.push(a + b + c)

/** Three-letter amino acid names, as both formats print them. */
const AA3: Record<string, string> = {
  A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly',
  H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser',
  T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', '*': 'End',
}

/**
 * A complete table, every codon of a family used equally except the ones
 * overridden. `fraction` is the source of truth; the other two columns are
 * derived from it, the way a real file's would be.
 */
function fullTable(overrides: Record<string, number> = {}) {
  return ALL_CODONS.map(codon => {
    const aa = standard.table[codon]
    const family = synonymsFor(standard, aa)
    const fraction = overrides[codon] ?? 1 / family.length
    return { codon, aa, fraction, per1000: fraction * 40, count: Math.round(fraction * 3000) }
  })
}

/** cusp: comment header, then Codon AA Fraction Frequency Number. */
function cusp(overrides: Record<string, number> = {}): string {
  const body = fullTable(overrides)
    .map(r => `${r.codon}    ${r.aa}     ${r.fraction.toFixed(3)}     ${r.per1000.toFixed(3)}    ${r.count}`)
    .join('\n')
  return `#CdsCount: 100
#
#Coding GC 52.34%
#1st letter GC 58.10%
#2nd letter GC 42.00%
#3rd letter GC 56.92%
#
#Codon AA Fraction Frequency Number
${body}
`
}

/** GCG: preamble, then AmAcid Codon Number /1000 Fraction .. */
function gcg(overrides: Record<string, number> = {}): string {
  const body = fullTable(overrides)
    .map(r => `${AA3[r.aa]}     ${r.codon}     ${r.count.toFixed(2)}     ${r.per1000.toFixed(2)}     ${r.fraction.toFixed(2)}`)
    .join('\n')
  return `!!CODON_FREQUENCY 1.0
Escherichia coli K-12 codon usage

AmAcid  Codon     Number    /1000     Fraction   ..

${body}

End
`
}

describe('EMBOSS cusp', () => {
  // Alanine split unevenly, so reading the wrong column shows up immediately.
  const ALA = { GCA: 0.2, GCC: 0.3, GCG: 0.4, GCT: 0.1 }

  it('reads the Fraction column, not the first number it sees', () => {
    const parsed = parseUsageTable('ecoli.cusp', cusp(ALA))
    expect(parsed.format).toBe('cusp')
    expect(parsed.column).toBe('fraction')
    expect(parsed.table.fractions.GCA).toBeCloseTo(0.2, 3)
    expect(parsed.table.fractions.GCG).toBeCloseTo(0.4, 3)
  })

  it('ignores the comment block above the table', () => {
    const parsed = parseUsageTable('ecoli.cusp', cusp())
    expect(parsed.codonsRead).toBe(64)
    expect(parsed.skipped).toEqual([])
  })

  it('is recognised by its header even when the file is named something else', () => {
    expect(parseUsageTable('table.txt', cusp()).format).toBe('cusp')
  })

  it('names the source in the table it produces', () => {
    const parsed = parseUsageTable('ecoli.cusp', cusp())
    expect(parsed.table.name).toBe('ecoli')
    expect(parsed.table.source).toContain('EMBOSS cusp')
    expect(parsed.table.approximate).toBe(false)
  })
})

describe('GCG CodonFrequency', () => {
  // Glycine split unevenly: in this format Number comes before Fraction, so
  // a parser reading by position would report counts here.
  const GLY = { GGG: 0.15, GGA: 0.08, GGT: 0.34, GGC: 0.43 }

  it('reads the Fraction column even though Number comes first', () => {
    const parsed = parseUsageTable('ecoli.cod', gcg(GLY))
    expect(parsed.format).toBe('gcg')
    expect(parsed.column).toBe('fraction')
    expect(parsed.table.fractions.GGC).toBeCloseTo(0.43, 2)
    expect(parsed.table.fractions.GGA).toBeCloseTo(0.08, 2)
  })

  it('skips the preamble and the trailing End line', () => {
    const parsed = parseUsageTable('ecoli.cod', gcg())
    expect(parsed.skipped).toEqual([])
    expect(parsed.codonsRead).toBe(64)
  })

  it('falls back to the frequency column when the fractions are missing', () => {
    const noFraction = 'AmAcid  Codon     Number    /1000\n' + ALL_CODONS
      .map(codon => {
        const per1000 = codon === 'GGC' ? 25.35 : 10
        return `${AA3[standard.table[codon]]}     ${codon}     1000.00     ${per1000.toFixed(2)}`
      })
      .join('\n')
    const parsed = parseUsageTable('ecoli.cod', noFraction)

    expect(parsed.column).toBe('frequency')
    expect(parsed.table.fractions.GGC).toBeCloseTo(25.35 / (25.35 + 10 * 3), 4)
  })

  it('is recognised by its header when the file is named something else', () => {
    expect(parseUsageTable('table.txt', gcg()).format).toBe('gcg')
  })
})

describe('plain codon lists', () => {
  it('still reads a two-column list', () => {
    const parsed = parseUsageTable('table.txt', evenTable())
    expect(parsed.format).toBe('plain')
    expect(parsed.codonsRead).toBe(64)
    expect(parsed.table.fractions.CTG).toBeCloseTo(1 / 6, 6)
    expect(parsed.table.fractions.ATG).toBe(1)
  })

  it('accepts tabs, commas and colons between the two', () => {
    for (const sep of ['\t', ',', ': ']) {
      expect(parseUsageTable('t.txt', evenTable(sep)).codonsRead).toBe(64)
    }
  })

  it('reads a Kazusa block, U and all', () => {
    const block = `
UUU 22.4( 17583)  UCU 10.9(  8546)  UAU 16.3( 12864)  UGU  5.2(  4092)
UUC 16.6( 13065)  UCC  8.6(  6781)  UAC 12.2(  9593)  UGC  6.4(  5011)
`
    const parsed = parseUsageTable('kazusa.txt', block + evenTable())
    expect(parsed.table.fractions.TTT / parsed.table.fractions.TTC).toBeCloseTo(22.4 / 16.6, 3)
  })
})

describe('normalisation', () => {
  it('gives the same table for counts, frequencies and fractions', () => {
    const counts = 'TTT 5800\nTTC 4200\n' + evenTable()
    const perThousand = 'TTT 22.4\nTTC 16.2\n' + evenTable()
    const fractions = 'TTT 0.58\nTTC 0.42\n' + evenTable()

    const f = (text: string) => parseUsageTable('t.txt', text).table.fractions.TTT
    expect(f(counts)).toBeCloseTo(0.58, 2)
    expect(f(perThousand)).toBeCloseTo(0.58, 2)
    expect(f(fractions)).toBeCloseTo(0.58, 2)
  })

  it('normalises every family to one', () => {
    const parsed = parseUsageTable('t.txt', evenTable())
    for (const aa of new Set(Object.values(standard.table))) {
      const sum = synonymsFor(standard, aa).reduce((n, c) => n + parsed.table.fractions[c], 0)
      expect(sum).toBeCloseTo(1, 6)
    }
  })

  it('leaves a family the file never mentions at zero, and lists it', () => {
    const partial = evenTable().split('\n').filter(l => !l.startsWith('TGG')).join('\n')
    const parsed = parseUsageTable('t.txt', partial)
    expect(parsed.missing).toEqual(['TGG'])
    expect(parsed.table.fractions.TGG).toBe(0)
    expect(familyFractions(parsed.table, standard).TGG).toBe(0)
  })
})

describe('rejections', () => {
  it('refuses something that is not a usage table', () => {
    expect(() => parseUsageTable('notes.txt', 'Dear lab, the plates are in the fridge.'))
      .toThrow(UsageImportError)
  })

  it('names the formats it wants when it refuses', () => {
    expect(() => parseUsageTable('t.txt', 'TTT 10\nTTC 12\nATG 40'))
      .toThrow(/EMBOSS cusp/)
  })

  it('refuses a file too large to be one', () => {
    expect(() => parseUsageTable('big.cusp', 'A'.repeat(2 * 1024 * 1024))).toThrow(/too large/)
  })

  it('falls back to a plain scan when a .cusp file has no usable table', () => {
    // Named .cusp but actually a two-column list: the column reader finds
    // nothing and the generic scan takes over rather than the import failing.
    const parsed = parseUsageTable('mislabelled.cusp', evenTable())
    expect(parsed.codonsRead).toBe(64)
  })
})

describe('describeUsageImport', () => {
  it('says what was read and where from', () => {
    const parsed = parseUsageTable('ecoli.cusp', cusp())
    expect(describeUsageImport('ecoli.cusp', parsed))
      .toBe('Read 64 codons from "ecoli.cusp" (EMBOSS cusp, fraction)')
  })

  it('mentions what was missing', () => {
    const partial = evenTable().split('\n').filter(l => !l.startsWith('TGG')).join('\n')
    expect(describeUsageImport('t.txt', parseUsageTable('t.txt', partial)))
      .toContain('1 not listed')
  })
})
