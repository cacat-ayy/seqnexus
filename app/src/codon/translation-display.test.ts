/**
 * Translation display options.
 *
 * The frame table is the part worth pinning: a wrong strand or offset draws a
 * plausible-looking protein that is not the one encoded there.
 */
import { describe, it, expect } from 'vitest'
import {
  TRANSLATION_FRAMES, DEFAULT_TRANSLATION_FRAME, framesFor, followsAnnotations,
  frameLabel, translationRowCount, AMINO_ACID_STYLES, DEFAULT_AMINO_ACID_STYLE,
  aminoAcidColor, aminoAcidFill, aminoAcidLabel, AA_THREE_LETTER,
  translatesSelection, selectionCodonsInRow, trimReadingStart,
} from './translation-display'

describe('frame options', () => {
  it('defaults to following the selection or an annotation', () => {
    expect(DEFAULT_TRANSLATION_FRAME).toBe('selection-or-annotation')
    expect(followsAnnotations(DEFAULT_TRANSLATION_FRAME)).toBe(true)
    expect(framesFor(DEFAULT_TRANSLATION_FRAME)).toEqual([])
  })

  it('offers the full menu, with unique ids and labels', () => {
    expect(TRANSLATION_FRAMES).toHaveLength(17)
    expect(new Set(TRANSLATION_FRAMES.map(f => f.id)).size).toBe(17)
    expect(new Set(TRANSLATION_FRAMES.map(f => f.label)).size).toBe(17)
  })

  it('reads all six frames for "All frames"', () => {
    const frames = framesFor('all')
    expect(frames).toHaveLength(6)
    expect(frames.filter(f => f.strand === 1).map(f => f.offset)).toEqual([0, 1, 2])
    expect(frames.filter(f => f.strand === -1).map(f => f.offset)).toEqual([0, 1, 2])
  })

  it('splits the three-frame options by strand', () => {
    expect(framesFor('forward').every(f => f.strand === 1)).toBe(true)
    expect(framesFor('reverse').every(f => f.strand === -1)).toBe(true)
  })

  it('maps each single frame to one strand and offset', () => {
    expect(framesFor('f1')).toEqual([{ strand: 1, offset: 0 }])
    expect(framesFor('f3')).toEqual([{ strand: 1, offset: 2 }])
    expect(framesFor('r1')).toEqual([{ strand: -1, offset: 0 }])
    expect(framesFor('r2')).toEqual([{ strand: -1, offset: 1 }])
  })

  it('maps each pair to its two frames', () => {
    expect(framesFor('f13')).toEqual([{ strand: 1, offset: 0 }, { strand: 1, offset: 2 }])
    expect(framesFor('r23')).toEqual([{ strand: -1, offset: 1 }, { strand: -1, offset: 2 }])
  })

  it('asks for one row per frame, two for the annotation mode and one more for the selection', () => {
    expect(translationRowCount('all')).toBe(6)
    expect(translationRowCount('f12')).toBe(2)
    expect(translationRowCount('f1')).toBe(1)
    expect(translationRowCount('annotation')).toBe(2)
    expect(translationRowCount('selection-or-annotation')).toBe(3)
    expect(translatesSelection('selection-or-annotation')).toBe(true)
    expect(translatesSelection('annotation')).toBe(false)
  })

  it('labels an unknown option as itself rather than blank', () => {
    expect(frameLabel('f1')).toBe('Frame 1')
    expect(frameLabel('nonsense' as never)).toBe('nonsense')
  })
})

describe('amino acid colours', () => {
  it('defaults to plain', () => {
    expect(DEFAULT_AMINO_ACID_STYLE).toBe('none')
    expect(aminoAcidColor('none', 'A', '#123456')).toBe('#123456')
  })

  it('always marks a stop, whatever the style', () => {
    for (const style of AMINO_ACID_STYLES) {
      expect(aminoAcidColor(style.id, '*', '#123456')).not.toBe('#123456')
    }
  })

  it('reports a plain residue as having no fill of its own', () => {
    expect(aminoAcidFill('none', 'A')).toBeNull()
    expect(aminoAcidFill('none', '*')).toBe(aminoAcidColor('none', '*', '#123456'))
    expect(aminoAcidFill('clustal', 'k')).toBe(aminoAcidColor('clustal', 'K', '#123456'))
  })

  it('colours only the stop under Plain', () => {
    expect(aminoAcidColor('none', 'A', '#123456')).toBe('#123456')
    expect(aminoAcidColor('none', 'W', '#123456')).toBe('#123456')
    expect(AMINO_ACID_STYLES.map(s => s.id)).not.toContain('stop')
  })

  it('gives every standard residue a colour in the palette styles', () => {
    const residues = 'ARNDCQEGHILKMFPSTWYV'.split('')
    for (const style of ['hydrophobicity', 'polarity', 'rasmol', 'clustal', 'macclade'] as const) {
      for (const aa of residues) {
        expect(aminoAcidColor(style, aa, '#fallback')).not.toBe('#fallback')
      }
    }
  })

  it('separates charge classes under polarity', () => {
    const acidic = aminoAcidColor('polarity', 'D', '#000')
    const basic = aminoAcidColor('polarity', 'K', '#000')
    expect(acidic).toBe(aminoAcidColor('polarity', 'E', '#000'))
    expect(basic).toBe(aminoAcidColor('polarity', 'R', '#000'))
    expect(acidic).not.toBe(basic)
  })

  it('falls back for anything it cannot translate', () => {
    expect(aminoAcidColor('rasmol', '?', '#123456')).toBe('#123456')
  })

  it('hands "by annotation" straight back to the caller', () => {
    // The feature colour is passed in as the fallback, since a palette cannot
    // know it.
    expect(aminoAcidColor('annotation', 'A', '#ff0000')).toBe('#ff0000')
  })
})

describe('amino acid labels', () => {
  it('spells one letter or three, as asked', () => {
    expect(aminoAcidLabel('A', false)).toBe('A')
    expect(aminoAcidLabel('A', true)).toBe('Ala')
    expect(aminoAcidLabel('*', true)).toBe('Stop')
  })

  it('covers every residue a translation can produce', () => {
    for (const aa of 'ARNDCQEGHILKMFPSTWYV*') expect(AA_THREE_LETTER[aa]).toBeTruthy()
  })

  it('passes an unknown residue through unchanged', () => {
    expect(aminoAcidLabel('Z', true)).toBe('Z')
  })
})

describe('translating a selection', () => {
  const bases = (codons: { bases: number[] }[]) => codons.map(c => c.bases)

  it('reads a left-to-right selection from its first base', () => {
    // 7 bases from position 2: two codons, then base 8 as the codon still
    // being selected at the far end.
    const codons = selectionCodonsInRow([[2, 9]], false, 0, 20)
    expect(codons.map(c => c.index)).toEqual([0, 1, 2])
    expect(bases(codons)).toEqual([[2, 3, 4], [5, 6, 7], [8]])
    expect(codons.map(c => c.partial)).toEqual([false, false, true])
  })

  it('reads a right-to-left selection from its last base', () => {
    // The same bases dragged the other way: the protein starts at base 8 and
    // base 2 is the partial codon. Returned in row order, left to right, so
    // the first codon read is last.
    const codons = selectionCodonsInRow([[2, 9]], true, 0, 20)
    expect(codons.map(c => c.index)).toEqual([2, 1, 0])
    expect(bases(codons)).toEqual([[2], [5, 4, 3], [8, 7, 6]])
    expect(codons.map(c => c.partial)).toEqual([true, false, false])
  })

  it('returns only the codons with a base in the row', () => {
    expect(bases(selectionCodonsInRow([[2, 9]], false, 0, 5))).toEqual([[2, 3, 4]])
    expect(bases(selectionCodonsInRow([[2, 9]], false, 5, 10))).toEqual([[5, 6, 7], [8]])
    // A codon split across rows shows up in both.
    expect(bases(selectionCodonsInRow([[2, 9]], false, 0, 4))).toEqual([[2, 3, 4]])
    expect(bases(selectionCodonsInRow([[2, 9]], false, 4, 8))).toEqual([[2, 3, 4], [5, 6, 7]])
  })

  it('wraps across the origin of a circular sequence', () => {
    // 10 bp circle, 6 bases from position 8: 8 9 0 | 1 2 3.
    const codons = selectionCodonsInRow([[8, 10], [0, 4]], false, 0, 10)
    expect(codons.map(c => c.index).sort()).toEqual([0, 1])
    expect(codons.find(c => c.index === 0)!.bases).toEqual([8, 9, 0])
    expect(codons.find(c => c.index === 1)!.bases).toEqual([1, 2, 3])
  })

  it('shows one or two bases as a partial codon, and nothing for none', () => {
    expect(selectionCodonsInRow([[2, 3]], false, 0, 20)).toEqual([{ index: 0, bases: [2], partial: true }])
    expect(selectionCodonsInRow([[2, 4]], true, 0, 20)).toEqual([{ index: 0, bases: [3, 2], partial: true }])
    expect(selectionCodonsInRow([], false, 0, 20)).toEqual([])
  })

  it('joins several ranges, so a codon can span the gap between two', () => {
    // 2 3 | 6 7 8 9 | 12: the first codon takes two bases from the first
    // range and one from the second, as a codon across an intron does.
    const segs: [number, number][] = [[2, 4], [6, 10], [12, 13]]
    expect(bases(selectionCodonsInRow(segs, false, 0, 20))).toEqual([[2, 3, 6], [7, 8, 9], [12]])
    // Read leftwards, the joined sequence is read from its last base.
    expect(bases(selectionCodonsInRow(segs, true, 0, 20))).toEqual([[2], [7, 6, 3], [12, 9, 8]])
    // A row holding only the second range still finds the codon it shares.
    expect(bases(selectionCodonsInRow(segs, false, 5, 10))).toEqual([[2, 3, 6], [7, 8, 9]])
  })
})

describe('trimReadingStart', () => {
  it('skips bases at the end reading starts from, across parts if need be', () => {
    expect(trimReadingStart([[0, 10], [20, 30]], 2, false)).toEqual([[2, 10], [20, 30]])
    expect(trimReadingStart([[0, 10], [20, 30]], 2, true)).toEqual([[0, 10], [20, 28]])
    expect(trimReadingStart([[0, 1], [20, 30]], 2, false)).toEqual([[21, 30]])
    expect(trimReadingStart([[0, 10]], 0, false)).toEqual([[0, 10]])
  })
})
