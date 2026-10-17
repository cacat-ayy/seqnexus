/**
 * What the sequence view draws for a guide's cut.
 *
 * The geometry is a canvas, so what can be tested is the decision behind it:
 * how many ticks there are, where they fall, and whether each goes through
 * the bar or stops at the middle. A nickase cutting one strand has to look
 * different from a nuclease cutting both, or the view shows a break where
 * the molecule only has a nick.
 */

import { describe, expect, it } from 'vitest'

import { cutsOf } from './guide-draw'
import { findGuideSites } from '../crispr/finder'
import { builtInNuclease } from '../crispr/nucleases'
import type { GuideSite, Nuclease } from '../crispr/types'

const SPACER = 'ACGTACGTACGTACGTACGT'
const BASES = 'TTTTTTTTTT' + SPACER + 'AGG' + 'TTTTTTTTTT'

function site(nuclease: Nuclease, bases = BASES, strand: 1 | -1 = 1): GuideSite {
  const { sites } = findGuideSites(bases, nuclease, 'linear')
  const found = sites.find(s => s.strand === strand)
  if (!found) throw new Error('no site to draw')
  return found
}

describe('drawing a cut', () => {
  it('puts one tick through the bar for a blunt cutter', () => {
    const nuclease = builtInNuclease('spcas9')!
    const cuts = cutsOf({ nuclease }, site(nuclease))
    expect(cuts).toEqual([{ at: 27, half: null }])
  })

  it('puts two ticks through the bar for a staggered cutter', () => {
    const nuclease = builtInNuclease('ascas12a')!
    const bases = 'AAAAAAAAAA' + 'TTTA' + 'ACGTACGTACGTACGTACGTACG' + 'AAAAAAAAAA'
    const cuts = cutsOf({ nuclease }, site(nuclease, bases))
    expect(cuts).toHaveLength(2)
    expect(cuts.every(c => c.half === null)).toBe(true)
    expect(cuts[1].at - cuts[0].at).toBe(5)
  })

  it('gives a nickase half a tick, on the strand it nicks', () => {
    // H840A leaves the HNH domain dead, so RuvC nicks the strand carrying
    // the PAM, which is the protospacer's own.
    const h840a = builtInNuclease('spcas9-h840a')!
    expect(h840a.cleaves).toBe('site')
    expect(cutsOf({ nuclease: h840a }, site(h840a))).toEqual([{ at: 27, half: 'top' }])

    // D10A is the other way round: it nicks the strand the guide pairs with.
    const d10a = builtInNuclease('spcas9-d10a')!
    expect(d10a.cleaves).toBe('opposite')
    expect(cutsOf({ nuclease: d10a }, site(d10a))).toEqual([{ at: 27, half: 'bottom' }])
  })

  it('mirrors the halves for a site on the antisense strand', () => {
    const h840a = builtInNuclease('spcas9-h840a')!
    const d10a = builtInNuclease('spcas9-d10a')!
    const bases = 'TTTTTTTTTT' + 'CCT' + 'ACGTACGTACGTACGTACGT' + 'TTTTTTTTTT'
    expect(cutsOf({ nuclease: h840a }, site(h840a, bases, -1))[0].half).toBe('bottom')
    expect(cutsOf({ nuclease: d10a }, site(d10a, bases, -1))[0].half).toBe('top')
  })

  it('draws nothing for a nuclease that only binds, or a cut off the end', () => {
    const dead = builtInNuclease('dspcas9')!
    expect(cutsOf({ nuclease: dead }, site(dead))).toEqual([])
    const nuclease = builtInNuclease('spcas9')!
    const offEnd = { ...site(nuclease), offEnd: true as const }
    expect(cutsOf({ nuclease }, offEnd)).toEqual([])
  })
})
