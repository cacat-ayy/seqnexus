/**
 * Turning the dialog's settings into what the optimizer consumes.
 *
 * The enzyme picker is a category minus exclusions rather than a list of
 * chosen names, so the translation into motifs is where that shape either
 * survives or quietly loses enzymes.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CODON_SETTINGS, motifsFor, selectedEnzymeNames, constraintOptionsFor,
  constraintSetFor, targetOptionsFor, type CodonSettings,
} from './settings'
import { ALL_ENZYMES_GROUP, enzymeNamesInGroup } from './constraints'

const settings = (over: Partial<CodonSettings> = {}): CodonSettings =>
  ({ ...DEFAULT_CODON_SETTINGS, ...over })

describe('defaults', () => {
  it('avoids nothing until asked', () => {
    expect(motifsFor(DEFAULT_CODON_SETTINGS)).toEqual([])
    expect(selectedEnzymeNames(DEFAULT_CODON_SETTINGS)).toEqual([])
    expect(DEFAULT_CODON_SETTINGS.enzymeGroup).toBe('')
  })

  it('starts with the homopolymer limits on and everything else off', () => {
    const o = constraintOptionsFor(DEFAULT_CODON_SETTINGS)
    expect(o.maxHomopolymerAT).toBeGreaterThan(0)
    expect(o.maxHomopolymerGC).toBeGreaterThan(0)
    expect(o.minGC).toBe(0)
    expect(o.maxGC).toBe(100)
    expect(o.maxRepeat).toBe(0)
    expect(o.avoidCpG).toBe(false)
  })
})

describe('enzyme categories', () => {
  it('takes every enzyme of the chosen category', () => {
    const s = settings({ enzymeGroup: 'Common (6-cutters)' })
    expect(selectedEnzymeNames(s)).toEqual(enzymeNamesInGroup('Common (6-cutters)'))
    expect(motifsFor(s).some(m => m.name === 'EcoRI')).toBe(true)
  })

  it('drops the ones the user unticked', () => {
    const s = settings({
      enzymeGroup: 'Common (6-cutters)',
      enzymeExcluded: ['EcoRI', 'BamHI'],
    })
    const chosen = selectedEnzymeNames(s)
    expect(chosen).not.toContain('EcoRI')
    expect(chosen).not.toContain('BamHI')
    expect(chosen).toContain('HindIII')
    expect(motifsFor(s).some(m => m.name === 'EcoRI')).toBe(false)
  })

  it('handles the catch-all category', () => {
    const s = settings({ enzymeGroup: ALL_ENZYMES_GROUP })
    expect(selectedEnzymeNames(s).length).toBeGreaterThan(100)
  })

  it('ignores exclusions once the category is cleared', () => {
    expect(selectedEnzymeNames(settings({ enzymeGroup: '', enzymeExcluded: ['EcoRI'] })))
      .toEqual([])
  })
})

describe('motifsFor', () => {
  it('merges enzymes, presets and custom motifs', () => {
    const s = settings({
      enzymeGroup: 'Common (6-cutters)',
      presetIds: ['shine-dalgarno'],
      customMotifs: 'myMotif=GGWWCC',
    })
    const names = motifsFor(s).map(m => m.name)
    expect(names).toContain('EcoRI')
    expect(names).toContain('Shine-Dalgarno')
    expect(names).toContain('myMotif')
  })

  it('keeps one entry per sequence when two sources agree', () => {
    // BsaI is in the Type IIS preset and in its enzyme category.
    const s = settings({
      enzymeGroup: 'Golden Gate (Type IIS)',
      presetIds: ['type-iis'],
    })
    const sequences = motifsFor(s).map(m => m.sequence.toUpperCase())
    expect(new Set(sequences).size).toBe(sequences.length)
  })

  it('feeds the compiled constraint set', () => {
    const set = constraintSetFor(settings({ enzymeGroup: 'Common (6-cutters)' }))
    expect(set.isEmpty).toBe(false)
    expect(set.findViolations('AAAGAATTCAAA').some(v => v.detail.includes('EcoRI'))).toBe(true)
  })
})

describe('targetOptionsFor', () => {
  it('passes the locking choices through', () => {
    const o = targetOptionsFor(settings({ keepStartCodon: false, keepFirstCodons: 5 }))
    expect(o.keepStartCodon).toBe(false)
    expect(o.keepFirstCodons).toBe(5)
    expect(o.protectFeatures).toBe(DEFAULT_CODON_SETTINGS.protectFeatures)
  })
})
