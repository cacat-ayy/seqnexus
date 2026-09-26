/**
 * Importing a user's own feature database.
 *
 * The three formats are the ones people already have: a FASTA of parts, a
 * spreadsheet, or an annotated GenBank library. What matters most here is that
 * rejections are reported — an import that silently drops entries leaves the
 * user wondering why their part never matches anything.
 */
import { describe, it, expect } from 'vitest'
import {
  parseFeatureSource, describeImport, FeatureSourceError,
  MIN_FEATURE_LENGTH,
} from './feature-source-import'

const SEQ = 'ATGCGTACGTAGCTAGCTAGCATCG'          // 25 bp
const SEQ2 = 'TTTGGGCCCAAATTTGGGCCCAAA'          // 24 bp

describe('FASTA', () => {
  it('takes one feature per record', () => {
    const r = parseFeatureSource('parts.fasta', `>partA\n${SEQ}\n>partB\n${SEQ2}\n`)
    expect(r.format).toBe('fasta')
    expect(r.features.map(f => f.name)).toEqual(['partA', 'partB'])
    expect(r.features[0].sequence).toBe(SEQ)
  })

  it('reads type and colour from header tags and defaults the rest', () => {
    const r = parseFeatureSource('parts.fasta', `>pTet [type=promoter] [color=#ff0000]\n${SEQ}\n`)
    expect(r.features[0]).toMatchObject({ type: 'promoter', color: '#ff0000' })

    const plain = parseFeatureSource('parts.fasta', `>pTet\n${SEQ}\n`)
    expect(plain.features[0].type).toBe('misc_feature')
    expect(plain.features[0].color).toBe('')
  })

  it('joins wrapped lines and ignores description text after the id', () => {
    const r = parseFeatureSource('p.fa', `>partA some description here\nATGCGTACG\nTAGCTAGCTAGCATCG\n`)
    expect(r.features[0].name).toBe('partA')
    expect(r.features[0].sequence).toBe(SEQ)
  })

  it('defaults the category to the file name, so hits can be filtered by source', () => {
    const r = parseFeatureSource('lab-parts.fasta', `>partA\n${SEQ}\n`)
    expect(r.features[0].category).toBe('lab-parts')
  })
})

describe('validation', () => {
  it('reports short, empty, non-nucleotide and duplicate entries with reasons', () => {
    const r = parseFeatureSource('parts.fasta', [
      `>ok\n${SEQ}`,
      '>tooShort\nATGCGT',
      '>empty\n',
      '>protein\nMKVLAAGIVGLNLGGK',
      `>ok\n${SEQ}`,
    ].join('\n') + '\n')

    expect(r.features.map(f => f.name)).toEqual(['ok'])
    expect(r.skipped).toEqual([
      { name: 'tooShort', reason: `shorter than ${MIN_FEATURE_LENGTH} bp` },
      { name: 'empty', reason: 'no sequence' },
      { name: 'protein', reason: 'not a nucleotide sequence' },
      { name: 'ok', reason: 'duplicate' },
    ])
  })

  it('accepts IUPAC ambiguity codes and normalises case and gaps', () => {
    const r = parseFeatureSource('p.fa', `>amb\nacgt-rysw kmbd hvn acgt\n`)
    expect(r.skipped).toEqual([])
    expect(r.features[0].sequence).toBe('ACGTRYSWKMBDHVNACGT')
  })

  it('rejects a file that is neither sequence nor a usable table', () => {
    expect(() => parseFeatureSource('notes.txt', 'just some prose\nand more prose\n'))
      .toThrow(FeatureSourceError)
  })

  it('rejects an empty file', () => {
    expect(() => parseFeatureSource('empty.fasta', '   ')).toThrow(FeatureSourceError)
  })
})

describe('CSV / TSV', () => {
  const csv = [
    'Name,Type,Color,Sequence',
    `AmpR,CDS,#ff0000,${SEQ}`,
    `"Part, comma",promoter,,${SEQ2}`,
  ].join('\n')

  it('reads the columns it needs, case-insensitively, and honours quoting', () => {
    const r = parseFeatureSource('db.csv', csv)
    expect(r.format).toBe('csv')
    expect(r.features).toHaveLength(2)
    expect(r.features[0]).toMatchObject({ name: 'AmpR', type: 'CDS', color: '#ff0000', sequence: SEQ })
    expect(r.features[1].name).toBe('Part, comma')
  })

  it('reads tab-separated files the same way', () => {
    const tsv = `name\tsequence\npartA\t${SEQ}\n`
    expect(parseFeatureSource('db.tsv', tsv).features[0].name).toBe('partA')
  })

  it('explains what a table is missing rather than importing nothing', () => {
    // The app's own feature CSV export has coordinates, not bases.
    const exported = 'Name,Type,Start,End,Length (bp),Strand,Color,Notes\nAmpR,CDS,1,300,300,Forward,#ff0000,\n'
    expect(() => parseFeatureSource('features.csv', exported))
      .toThrow(/needs a header row with at least "name" and "sequence"/)
  })
})

describe('GenBank', () => {
  const gb = `LOCUS       pTest                  60 bp    DNA     circular SYN 01-JAN-2024
FEATURES             Location/Qualifiers
     source          1..60
                     /organism="synthetic"
     CDS             1..25
                     /label="fwdPart"
     promoter        complement(30..54)
                     /label="revPart"
ORIGIN
        1 atgcgtacgt agctagctag catcgttttt gggcccaaat ttgggcccaa acccgggttt
//
`

  it('turns every annotated feature into an entry', () => {
    const r = parseFeatureSource('library.gb', gb)
    expect(r.format).toBe('genbank')
    expect(r.features.map(f => f.name)).toEqual(['fwdPart', 'revPart'])
    expect(r.features[0].sequence).toBe(SEQ)
  })

  it('skips the source feature, which spans the whole record', () => {
    const r = parseFeatureSource('library.gb', gb)
    expect(r.features.some(f => f.type === 'source')).toBe(false)
  })

  it('stores reverse-strand features in genomic orientation', () => {
    // The scan searches both strands, so what matters is that the bases are
    // the ones actually at those coordinates.
    const r = parseFeatureSource('library.gb', gb)
    const rev = r.features.find(f => f.name === 'revPart')!
    expect(rev.sequence).toBe('TGGGCCCAAATTTGGGCCCAAACCC')
  })

  it('says so when there is nothing to import', () => {
    const empty = `LOCUS       pEmpty                  60 bp    DNA     circular SYN 01-JAN-2024
FEATURES             Location/Qualifiers
     source          1..60
ORIGIN
        1 atgcgtacgt agctagctag catcgttttt gggcccaaat ttgggcccaa acccgggttt
//
`
    expect(() => parseFeatureSource('empty.gb', empty)).toThrow(FeatureSourceError)
  })
})

describe('describeImport', () => {
  it('reports a clean import plainly', () => {
    const parsed = parseFeatureSource('p.fa', `>a\n${SEQ}\n`)
    expect(describeImport('p.fa', parsed)).toBe('Imported 1 feature from "p.fa"')
  })

  it('groups skip reasons with counts', () => {
    const parsed = parseFeatureSource('p.fa', `>a\n${SEQ}\n>b\nATG\n>c\nATG\n`)
    expect(describeImport('p.fa', parsed))
      .toBe(`Imported 1 feature from "p.fa" — skipped 2 shorter than ${MIN_FEATURE_LENGTH} bp`)
  })
})
