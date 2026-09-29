/**
 * Importing a codon usage table.
 *
 * The three shapes below are transcribed from what the real sources emit, so
 * the parser is tested against the punctuation people will actually paste.
 */
import { describe, it, expect } from 'vitest'
import { parseUsageTable, describeUsageImport, UsageImportError } from './usage-import'
import { geneticCode, synonymsFor } from './genetic-codes'
import { familyFractions } from './usage-tables'

const standard = geneticCode(1)

/** A complete table where every codon of a family is equally used. */
function evenTable(separator = ' '): string {
  const bases = 'TCAG'
  const lines: string[] = []
  for (const a of bases) for (const b of bases) for (const c of bases) {
    lines.push(`${a}${b}${c}${separator}10`)
  }
  return lines.join('\n')
}

describe('plain two-column lists', () => {
  it('reads codon and value pairs', () => {
    const parsed = parseUsageTable('table.txt', evenTable())
    expect(parsed.codonsRead).toBe(64)
    expect(parsed.missing).toEqual([])
    expect(parsed.table.fractions.CTG).toBeCloseTo(1 / 6, 6)
    expect(parsed.table.fractions.ATG).toBe(1)
  })

  it('accepts tabs, commas and colons between the two', () => {
    for (const sep of ['\t', ',', ': ']) {
      expect(parseUsageTable('t.txt', evenTable(sep)).codonsRead).toBe(64)
    }
  })
})

describe('Kazusa blocks', () => {
  // Four codons per line, RNA alphabet, count in parentheses.
  const block = `
UUU 22.4( 17583)  UCU 10.9(  8546)  UAU 16.3( 12864)  UGU  5.2(  4092)
UUC 16.6( 13065)  UCC  8.6(  6781)  UAC 12.2(  9593)  UGC  6.4(  5011)
UUA 13.9( 10920)  UCA  7.2(  5652)  UAA  2.0(  1568)  UGA  0.9(   724)
UUG 13.7( 10763)  UCG  8.9(  6994)  UAG  0.2(   157)  UGG 15.2( 11938)
`

  it('reads U as T and takes the frequency column', () => {
    const parsed = parseUsageTable('ecoli.txt', block + evenTable())
    expect(parsed.table.fractions.TTT).toBeGreaterThan(0)
    expect(parsed.table.fractions.TTT).toBeGreaterThan(parsed.table.fractions.TTC)
  })

  it('does not double count the parenthesised total', () => {
    const parsed = parseUsageTable('ecoli.txt', block + evenTable())
    // TTT and TTC come only from the block, so their ratio is the frequency
    // ratio, not something contaminated by the counts.
    const ratio = parsed.table.fractions.TTT / parsed.table.fractions.TTC
    expect(ratio).toBeCloseTo(22.4 / 16.6, 3)
  })
})

describe('CSV exports', () => {
  it('reads a header row and named columns', () => {
    const csv = ['Codon,AminoAcid,Fraction,Number', 'TTT,F,0.58,17583', 'TTC,F,0.42,13065']
      .join('\n') + '\n' + evenTable()
    const parsed = parseUsageTable('usage.csv', csv)
    // The first table entry wins, so the header rows set TTT and TTC.
    expect(parsed.table.fractions.TTT).toBeCloseTo(0.58, 2)
    expect(parsed.skipped.some(s => s.text === 'TTT')).toBe(true)
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

  it('refuses a table with too few codons to be one', () => {
    expect(() => parseUsageTable('t.txt', 'TTT 10\nTTC 12\nATG 40')).toThrow(/does not look like/)
  })

  it('refuses a file too large to be one', () => {
    expect(() => parseUsageTable('big.txt', 'A'.repeat(2 * 1024 * 1024))).toThrow(/too large/)
  })
})

describe('describeUsageImport', () => {
  it('reports a clean import in one line', () => {
    const parsed = parseUsageTable('t.txt', evenTable())
    expect(describeUsageImport('t.txt', parsed)).toBe('Read 64 codons from "t.txt"')
  })

  it('mentions what was missing or skipped', () => {
    const partial = evenTable().split('\n').filter(l => !l.startsWith('TGG')).join('\n')
    expect(describeUsageImport('t.txt', parseUsageTable('t.txt', partial)))
      .toContain('1 not listed')
  })
})
