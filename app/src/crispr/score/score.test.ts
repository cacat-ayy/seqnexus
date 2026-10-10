import { describe, it, expect } from 'vitest'
import { gcFraction, spacerFlags, worstSeverity, startBaseNote } from './rules'
import { onTargetScore } from './ontarget'
import { microhomologyOutcome } from './microhomology'
import { scoreSites, guideDetail } from './guide'
import { findGuideSites } from '../finder'
import { builtInNuclease } from '../nucleases'
import type { Nuclease } from '../types'

const spCas9 = builtInNuclease('spcas9') as Nuclease
const saCas9 = builtInNuclease('sacas9') as Nuclease

const flagIds = (spacer: string, n: Nuclease = spCas9) => spacerFlags(spacer, n).map(f => f.id)

describe('spacer rules', () => {
  it('measures GC', () => {
    expect(gcFraction('GCGC')).toBe(1)
    expect(gcFraction('ATAT')).toBe(0)
    expect(gcFraction('GCAT')).toBe(0.5)
    expect(gcFraction('')).toBe(0)
  })

  it('flags a terminator run', () => {
    expect(flagIds('GACTTTTACGACGACGACG')).toContain('polyt')
  })

  it('flags a long homopolymer, worse when longer', () => {
    const five = spacerFlags('GAAAAACGTACGTACGTACG', spCas9).find(f => f.id === 'homopolymer')
    const seven = spacerFlags('GAAAAAAACGTACGTACGTA', spCas9).find(f => f.id === 'homopolymer')
    expect(five?.severity).toBe('warn')
    expect(seven?.severity).toBe('bad')
  })

  it('flags GC outside the band at two levels', () => {
    const low = spacerFlags('GATATATATATATATATATA', spCas9).find(f => f.id === 'gc-low')
    expect(low?.severity).toBe('bad')
    const mild = spacerFlags('GATATATATATATATGCGCA', spCas9).find(f => f.id === 'gc-low')
    expect(mild?.severity).toBe('warn')
    const high = spacerFlags('GCGCGCGCGCGCGCGCGCGC', spCas9).find(f => f.id === 'gc-high')
    expect(high?.severity).toBe('bad')
  })

  it('says nothing about GC in the middle of the band', () => {
    expect(flagIds('GCATGCATGCATGACTGCAT')).not.toContain('gc-low')
    expect(flagIds('GCATGCATGCATGACTGCAT')).not.toContain('gc-high')
  })

  it('notes the promoter start base, and stays quiet when it is right', () => {
    expect(startBaseNote('GCATGCAT', 'u6')).toBeNull()
    expect(startBaseNote('ACATGCAT', 'u6')).toContain('U6')
    expect(startBaseNote('GGCATGCA', 't7')).toBeNull()
    expect(startBaseNote('GCATGCAT', 't7')).toContain('T7')
    expect(startBaseNote('ACATGCAT', 'none')).toBeNull()
  })

  it('flags a spacer that cannot be ordered', () => {
    expect(flagIds('GCATGCATGCATGCATGCNT')).toContain('ambiguous')
  })

  it('flags a cut that falls off a linear end', () => {
    const flags = spacerFlags('GCATGCATGCATGACTGCAT', spCas9, { offEnd: true })
    expect(flags.map(f => f.id)).toContain('off-end')
  })

  it('reports the worst severity present', () => {
    expect(worstSeverity([])).toBe('none')
    expect(worstSeverity(spacerFlags('GCATGCATGCATGACTGCAT', spCas9))).toBe('none')
    expect(worstSeverity(spacerFlags('GACTTTTACGACGACGACGA', spCas9))).toBe('bad')
  })
})

describe('the on-target heuristic', () => {
  it('stays inside its range and explains itself', () => {
    const good = onTargetScore('GCATGCATGCATGACTGCAG', spCas9, 'AGG')
    expect(good.score).toBeGreaterThanOrEqual(0)
    expect(good.score).toBeLessThanOrEqual(100)
    expect(good.terms.length).toBeGreaterThan(0)
    expect(good.caveat).toMatch(/heuristic/i)
  })

  it('marks a terminator run down hard', () => {
    const plain = onTargetScore('GCATGCATGCATGACTGCAG', spCas9, 'AGG').score as number
    const poly = onTargetScore('GCATGCATTTTTGACTGCAG', spCas9, 'AGG').score as number
    expect(poly).toBeLessThan(plain)
    expect(onTargetScore('GCATGCATTTTTGACTGCAG', spCas9, 'AGG').terms.some(t => t.delta === -25)).toBe(true)
  })

  it('prefers a G against the PAM over a T', () => {
    const withG = onTargetScore('GCATGCATGCATGACTGCAG', spCas9, 'AGG').score as number
    const withT = onTargetScore('GCATGCATGCATGACTGCAT', spCas9, 'AGG').score as number
    expect(withG).toBeGreaterThan(withT)
  })

  it('reports no score for a nuclease with no model', () => {
    const none = onTargetScore('GCATGCATGCATGACTGCATG', saCas9, 'AAGAAT')
    expect(none.score).toBeNull()
    expect(none.model).toBe('none')
    expect(none.caveat).toMatch(/no activity model/i)
  })

  it('adds its terms up to the score it reports', () => {
    const r = onTargetScore('GCATGCATGCATGACTGCAG', spCas9, 'AGG')
    const sum = r.terms.reduce((a, t) => a + t.delta, 50)
    expect(r.score).toBe(Math.max(0, Math.min(100, Math.round(sum))))
  })
})

describe('microhomology prediction', () => {
  const cut = 60
  // A period-3 repeat can only delete in multiples of three.
  const period3 = 'ACG'.repeat(40)
  // A period-4 repeat deletes in multiples of four, two thirds of which shift the frame.
  const period4 = 'ACGT'.repeat(30)

  it('finds no frameshifting deletion in a period-three repeat', () => {
    const r = microhomologyOutcome(period3, cut, 'linear')
    expect(r).not.toBeNull()
    expect(r?.outOfFrame).toBe(0)
    expect((r?.patterns.length ?? 0)).toBeGreaterThan(0)
  })

  it('finds mostly frameshifting deletions in a period-four repeat', () => {
    const r = microhomologyOutcome(period4, cut, 'linear')
    expect(r?.outOfFrame).toBeGreaterThan(50)
  })

  it('returns the patterns heaviest first, within range', () => {
    const r = microhomologyOutcome(period4, cut, 'linear')
    const scores = r?.patterns.map(p => p.patternScore) ?? []
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    expect(r?.outOfFrame).toBeLessThanOrEqual(100)
  })

  it('names a deletion whose two microhomology copies really are there', () => {
    const r = microhomologyOutcome(period4, cut, 'linear')
    for (const p of r?.patterns.slice(0, 5) ?? []) {
      const k = p.microhomology.length
      expect(period4.slice(p.deletionStart - k, p.deletionStart)).toBe(p.microhomology)
      expect(period4.slice(p.deletionStart + p.deletionLength - k, p.deletionStart + p.deletionLength))
        .toBe(p.microhomology)
    }
  })

  it('declines a cut too close to a linear end', () => {
    expect(microhomologyOutcome(period4, 5, 'linear')).toBeNull()
    expect(microhomologyOutcome(period4, period4.length - 2, 'linear')).toBeNull()
  })

  it('works across the origin of a circular molecule', () => {
    const r = microhomologyOutcome(period4, 2, 'circular')
    expect(r).not.toBeNull()
    expect(r?.patterns.every(p => p.deletionStart >= 0 && p.deletionStart < period4.length)).toBe(true)
  })

  it('declines a sequence with an ambiguous base in the window', () => {
    const withN = period4.slice(0, 55) + 'N' + period4.slice(56)
    expect(microhomologyOutcome(withN, cut, 'linear')).toBeNull()
  })

  it('has no pattern score when nothing in the window repeats', () => {
    // This stretch has no identical pair longer than 8 bases at any offset.
    const noRepeats =
      'AACCAAGTACAGAGGACGCCTGACGTGGACAAAAGCGCCTACGTACTTAACAGCCCCTGCAGTGCACTGTTACAATTGGCCAATTTCGTATCTCCTCCGGCCTGGGCGGGGGACAGCCCC'
    const r = microhomologyOutcome(noRepeats, 60, 'linear', { minLength: 9 })
    expect(r?.outOfFrame).toBe(0)
    expect(r?.patterns).toEqual([])
  })
})

describe('scoring a scan', () => {
  const bases = 'CATCATCATC' + 'ACGTACGTACGTACGTACGT' + 'AGG' + 'CATCATCATC'

  it('scores every site and keeps the parts separate', () => {
    const { sites } = findGuideSites(bases, spCas9, 'linear')
    const scored = scoreSites(sites, spCas9, bases, 'linear')
    expect(scored).toHaveLength(1)
    expect(scored[0].scores.onTargetModel).toBe('heuristic-cas9')
    expect(scored[0].scores.gc).toBeCloseTo(0.5, 5)
    expect(Array.isArray(scored[0].scores.flags)).toBe(true)
  })

  it('leaves the repair prediction out when asked to', () => {
    const { sites } = findGuideSites(bases, spCas9, 'linear')
    expect(scoreSites(sites, spCas9, bases, 'linear', { repair: false })[0].scores.outOfFrame).toBeNull()
  })

  it('gives one site everything, with the cut position', () => {
    const long = 'GATC'.repeat(30) + 'ACGTACGTACGTACGTACGT' + 'AGG' + 'GATC'.repeat(30)
    const { sites } = findGuideSites(long, spCas9, 'linear')
    const target = sites.find(s => s.spacer === 'ACGTACGTACGTACGTACGT')
    expect(target).toBeDefined()
    const detail = guideDetail(target as never, spCas9, long, 'linear')
    expect(detail.cut).toBe(137)
    expect(detail.onTarget.terms.length).toBeGreaterThan(0)
    expect(detail.repair).not.toBeNull()
    expect(detail.scores.outOfFrame).toBeGreaterThanOrEqual(0)
  })

  it('makes no repair prediction for a nuclease that does not cut', () => {
    const dead = builtInNuclease('dspcas9') as Nuclease
    const long = 'GATC'.repeat(30) + 'ACGTACGTACGTACGTACGT' + 'AGG' + 'GATC'.repeat(30)
    const { sites } = findGuideSites(long, dead, 'linear')
    const detail = guideDetail(sites[0], dead, long, 'linear')
    expect(detail.repair).toBeNull()
    expect(detail.scores.onTarget).toBeNull()
  })
})
