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
  aminoAcidColor, aminoAcidLabel, AA_THREE_LETTER,
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

  it('asks for one row per frame, and two for the annotation modes', () => {
    expect(translationRowCount('all')).toBe(6)
    expect(translationRowCount('f12')).toBe(2)
    expect(translationRowCount('f1')).toBe(1)
    expect(translationRowCount('annotation')).toBe(2)
    expect(translationRowCount('selection-or-annotation')).toBe(2)
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

  it('colours only the stop under the stop-codon style', () => {
    expect(aminoAcidColor('stop', 'A', '#123456')).toBe('#123456')
    expect(aminoAcidColor('stop', 'W', '#123456')).toBe('#123456')
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
