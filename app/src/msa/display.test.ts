import { describe, it, expect } from 'vitest'
import { makeDoc } from './model'
import { docProfile } from './stats'
import { cellColorer, blend, parseColor, luminance, ZAPPO } from './colors'
import { translateRow } from './translate'
import { findMotif, columnOfPosition } from './search'
import { sanitizeView, DEFAULT_VIEW, ZOOM_LEVELS } from './view'

const origin = { method: 'manual' as const, at: 0 }

describe('colour schemes', () => {
  it('colours Clustal X residues only where the column qualifies', () => {
    // Column 0: all hydrophobic (blue). Column 1: K in a column without KR majority (no colour).
    const d = makeDoc([
      { name: 'a', seq: 'LK' }, { name: 'b', seq: 'IE' }, { name: 'c', seq: 'VS' }, { name: 'd', seq: 'LT' },
    ], origin, 'protein')
    const p = docProfile(d)
    const c = cellColorer('clustalx', 'protein', p, () => '-')
    expect(c('L', 0)).toBe('#80a0f0')
    expect(c('K', 1)).toBeNull()
    // Glycine and proline are always coloured.
    expect(c('G', 1)).toBe('#f09048')
    expect(c('P', 1)).toBe('#c0c000')
  })

  it('colours K/R red where KR is the majority', () => {
    const d = makeDoc([{ name: 'a', seq: 'K' }, { name: 'b', seq: 'R' }, { name: 'c', seq: 'K' }], origin, 'protein')
    expect(cellColorer('clustalx', 'protein', docProfile(d), () => '-')('R', 0)).toBe('#f01505')
  })

  it('shades percent identity by how many rows share the residue', () => {
    const d = makeDoc([{ name: 'a', seq: 'A' }, { name: 'b', seq: 'A' }, { name: 'c', seq: 'A' }, { name: 'd', seq: 'A' }, { name: 'e', seq: 'C' }], origin)
    const c = cellColorer('identity', 'dna', docProfile(d), () => '-')
    expect(c('A', 0)).not.toBeNull()
    expect(c('C', 0)).toBeNull()
    expect(c('-', 0)).toBeNull()
  })

  it('uses nucleotide palettes for DNA and leaves translation to the view', () => {
    const d = makeDoc([{ name: 'a', seq: 'ACGT' }], origin)
    const p = docProfile(d)
    expect(cellColorer('nucleotide', 'dna', p, () => '-')('A', 0)).toBe('#2d8a4e')
    expect(cellColorer('nucleotide', 'dna', p, () => '-')('N', 0)).toBeNull()
    expect(cellColorer('translation', 'dna', p, () => '-')('A', 0)).toBeNull()
  })

  it('scores BLOSUM62 against the consensus', () => {
    const d = makeDoc([{ name: 'a', seq: 'I' }, { name: 'b', seq: 'V' }, { name: 'c', seq: 'W' }], origin, 'protein')
    const c = cellColorer('blosum62', 'protein', docProfile(d), () => 'I')
    expect(c('I', 0)).not.toBeNull()
    expect(c('V', 0)).not.toBeNull()
    expect(c('W', 0)).toBeNull()
  })

  it('parses and blends colours', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255])
    expect(parseColor('#102030')).toEqual([16, 32, 48])
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3])
    expect(parseColor('nonsense')).toBeNull()
    expect(blend('#ffffff', '#000000', 0.5)).toBe('#808080')
    expect(blend('red', '#000', 0.5)).toBe('red')
    expect(luminance('#ffffff')).toBeCloseTo(1)
    expect(luminance('#000000')).toBe(0)
    expect(ZAPPO['*']).toBeDefined()
  })
})

describe('translation', () => {
  it('reads codons across gaps from the row start', () => {
    const d = makeDoc([{ name: 'a', seq: 'AT-GAAATAG' }], origin)
    const t = translateRow(d.rows[0], 0, 1)
    expect(t.codons.map(c => c.aa).join('')).toBe('MK*')
    expect(t.codons[0].cols).toEqual([0, 1, 3])
    expect(String.fromCharCode(t.aa[3])).toBe('M')
    expect(t.pos[2]).toBe(255)
    expect(t.stops).toEqual([]) // the final stop is not internal
    expect(t.frameshifts).toEqual([[2, 3]])
  })

  it('flags internal stops and honours the frame and code', () => {
    const d = makeDoc([{ name: 'a', seq: 'ATGTGAAAATTT' }], origin)
    expect(translateRow(d.rows[0], 0, 1).stops).toEqual([3])
    // TGA is tryptophan in the vertebrate mitochondrial code.
    expect(translateRow(d.rows[0], 0, 2).codons[1].aa).toBe('W')
    expect(translateRow(d.rows[0], 1, 1).codons[0].aa).toBe('C') // TGT
  })

  it('caches per row, frame and code', () => {
    const d = makeDoc([{ name: 'a', seq: 'ATGAAA' }], origin)
    expect(translateRow(d.rows[0], 0, 1)).toBe(translateRow(d.rows[0], 0, 1))
    expect(translateRow(d.rows[0], 1, 1)).not.toBe(translateRow(d.rows[0], 0, 1))
  })

  it('a gap run that is a multiple of three is not a frameshift', () => {
    const d = makeDoc([{ name: 'a', seq: 'ATG---AAA--' }], origin)
    expect(translateRow(d.rows[0], 0, 1).frameshifts).toEqual([])
  })
})

describe('motif search', () => {
  it('finds motifs across gaps, with IUPAC codes', () => {
    const d = makeDoc([{ name: 'a', seq: 'AC-GTAC' }, { name: 'b', seq: 'TTTTTTT' }], origin)
    expect(findMotif(d, 'cgt')).toEqual([{ rowId: d.rows[0].id, c0: 1, c1: 5 }])
    expect(findMotif(d, 'RC').map(h => h.c0)).toEqual([0, 5])
    expect(findMotif(d, 'TT')).toHaveLength(6) // overlapping hits
    expect(findMotif(d, '')).toEqual([])
    expect(findMotif(d, 'TT', 2)).toHaveLength(2)
  })

  it('treats X as any amino acid', () => {
    const d = makeDoc([{ name: 'a', seq: 'MKLV' }], origin, 'protein')
    expect(findMotif(d, 'KXV')).toHaveLength(1)
  })

  it('maps a residue number to its column', () => {
    const d = makeDoc([{ name: 'a', seq: '--ACG', start: 10 }], origin)
    expect(columnOfPosition(d, d.rows[0].id, 10)).toBe(2)
    expect(columnOfPosition(d, d.rows[0].id, 12)).toBe(4)
    expect(columnOfPosition(d, d.rows[0].id, 13)).toBe(-1)
  })
})

describe('view settings', () => {
  it('fills in defaults and clamps', () => {
    expect(sanitizeView(undefined)).toEqual(DEFAULT_VIEW)
    const v = sanitizeView({ zoom: 99, dnaScheme: 'bogus', proteinScheme: 'taylor', tracks: { logo: true }, nameWidth: 5, frame: 2 })
    expect(v.zoom).toBe(ZOOM_LEVELS.length - 1)
    expect(v.dnaScheme).toBe(DEFAULT_VIEW.dnaScheme)
    expect(v.proteinScheme).toBe('taylor')
    expect(v.tracks).toEqual({ consensus: true, identity: true, logo: true })
    expect(v.nameWidth).toBeGreaterThanOrEqual(80)
    expect(v.frame).toBe(2)
  })

  it('takes a pre-rebuild zoom level', () => {
    expect(sanitizeView(undefined, 3).zoom).toBe(3)
  })
})
