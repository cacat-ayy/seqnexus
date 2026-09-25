import { describe, it, expect } from 'vitest'
import {
  COLOR_SCHEMES, DEFAULT_COLOR_SCHEME, baseColorFor, buildBasePalette,
  type ColorSchemeId,
} from './base-colors'

const TEXT = '#123456'
const ALL: ColorSchemeId[] = COLOR_SCHEMES.map(s => s.id)

describe('colour schemes', () => {
  it('exposes the six schemes with unique ids and labels', () => {
    expect(ALL).toHaveLength(6)
    expect(new Set(ALL).size).toBe(6)
    expect(new Set(COLOR_SCHEMES.map(s => s.label)).size).toBe(6)
  })

  it('defaults to the scheme the app already used', () => {
    expect(DEFAULT_COLOR_SCHEME).toBe('nucleotide')
  })

  it('keeps the previous hardcoded palette byte-identical, so the default look is unchanged', () => {
    expect(baseColorFor('nucleotide', 'A', TEXT)).toBe('#2d8a4e')
    expect(baseColorFor('nucleotide', 'T', TEXT)).toBe('#c0392b')
    expect(baseColorFor('nucleotide', 'G', TEXT)).toBe('#2874a6')
    expect(baseColorFor('nucleotide', 'C', TEXT)).toBe('#d4a017')
  })

  it('"None" paints every base in the theme foreground', () => {
    for (const b of 'ACGTUN') expect(baseColorFor('none', b, TEXT)).toBe(TEXT)
  })

  it('falls back to the theme foreground for ambiguity codes and gaps', () => {
    // These are common in real records; colouring them as errors would be noise.
    for (const scheme of ALL) {
      for (const ch of ['N', 'R', '-', '.', '?']) {
        expect(baseColorFor(scheme, ch, TEXT)).toBe(TEXT)
      }
    }
  })

  it('is case-insensitive — lowercase bases mark soft-masked regions, not other bases', () => {
    for (const scheme of ALL) {
      for (const b of 'ACGT') {
        expect(baseColorFor(scheme, b.toLowerCase(), TEXT))
          .toBe(baseColorFor(scheme, b, TEXT))
      }
    }
  })

  it('treats U as T everywhere, so RNA reads like DNA', () => {
    for (const scheme of ALL) {
      expect(baseColorFor(scheme, 'U', TEXT)).toBe(baseColorFor(scheme, 'T', TEXT))
    }
  })

  it('never returns black for MacClade G — that would vanish on dark themes', () => {
    // MacClade's convention is "black", which here means the theme foreground.
    expect(baseColorFor('macclade', 'G', TEXT)).toBe(TEXT)
    expect(baseColorFor('macclade', 'G', '#ffffff')).toBe('#ffffff')
  })

  it('GC vs AT groups by base-pair strength, not by letter', () => {
    const g = baseColorFor('gc-at', 'G', TEXT)
    expect(baseColorFor('gc-at', 'C', TEXT)).toBe(g)
    const a = baseColorFor('gc-at', 'A', TEXT)
    expect(baseColorFor('gc-at', 'T', TEXT)).toBe(a)
    expect(a).not.toBe(g)
  })

  it('purine vs pyrimidine puts A/G against C/T', () => {
    const purine = baseColorFor('purine-pyrimidine', 'A', TEXT)
    expect(baseColorFor('purine-pyrimidine', 'G', TEXT)).toBe(purine)
    const pyrimidine = baseColorFor('purine-pyrimidine', 'C', TEXT)
    expect(baseColorFor('purine-pyrimidine', 'T', TEXT)).toBe(pyrimidine)
    expect(purine).not.toBe(pyrimidine)
  })

  it('gives the four bases distinct colours in the per-base schemes', () => {
    for (const scheme of ['nucleotide', 'clustal', 'macclade'] as ColorSchemeId[]) {
      const colors = ['A', 'C', 'G', 'T'].map(b => baseColorFor(scheme, b, TEXT))
      expect(new Set(colors).size).toBe(4)
    }
  })
})

describe('buildBasePalette', () => {
  it('agrees with baseColorFor for every scheme and base', () => {
    for (const scheme of ALL) {
      const palette = buildBasePalette(scheme, TEXT)
      for (const ch of 'ACGTUNRY-') {
        expect(palette[ch]).toBe(baseColorFor(scheme, ch, TEXT))
        expect(palette[ch.toLowerCase()]).toBe(baseColorFor(scheme, ch, TEXT))
      }
    }
  })

  it('has no prototype, so a base named "constructor" cannot return a function', () => {
    const palette = buildBasePalette('nucleotide', TEXT)
    expect(Object.getPrototypeOf(palette)).toBeNull()
    expect(palette['constructor']).toBeUndefined()
  })
})
