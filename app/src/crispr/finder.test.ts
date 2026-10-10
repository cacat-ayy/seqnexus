import { describe, it, expect } from 'vitest'
import { findGuideSites, cutPosition, siteSequence, cuttingGuides } from './finder'
import { builtInNuclease, customNuclease, checkCustomNuclease, validPam, NUCLEASES } from './nucleases'
import type { Nuclease } from './types'

const spCas9 = builtInNuclease('spcas9') as Nuclease
const cas12a = builtInNuclease('ascas12a') as Nuclease

// Fillers chosen so they cannot carry a PAM themselves: no GG for NGG, no
// CC for its reverse complement, no TTT or AAA runs for TTTV.
const FILLER = 'CATCATCATC'
const CG_FILLER = 'CGCGCGCGCG'
const SPACER20 = 'ACGTACGTACGTACGTACGT'
const SPACER23 = 'ACGTACGTACGTACGTACGTACG'

describe('nuclease records', () => {
  it('every shipped row has an IUPAC PAM and a usable spacer length', () => {
    for (const n of NUCLEASES) {
      expect(n.pam).toMatch(/^[ACGTRYSWKMBDHVN]+$/)
      expect(n.spacerLengths.length).toBeGreaterThan(0)
      for (const l of n.spacerLengths) expect(l).toBeGreaterThanOrEqual(14)
    }
  })

  it('has no duplicate ids', () => {
    const ids = NUCLEASES.map(n => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('states an overhang that matches its cut offsets', () => {
    for (const n of NUCLEASES) {
      if (n.cut.site === n.cut.opposite) expect(n.overhang).toBe('blunt')
      else expect(n.overhang).not.toBe('blunt')
    }
  })
})

describe('finding sites with a 3-prime PAM', () => {
  const bases = FILLER + SPACER20 + 'AGG' + FILLER

  it('finds the one site on the sense strand', () => {
    const { sites } = findGuideSites(bases, spCas9, 'linear')
    expect(sites).toHaveLength(1)
    const s = sites[0]
    expect(s.strand).toBe(1)
    expect(s.start).toBe(10)
    expect(s.end).toBe(30)
    expect(s.pamStart).toBe(30)
    expect(s.pamEnd).toBe(33)
    expect(s.spacer).toBe(SPACER20)
    expect(s.pam).toBe('AGG')
  })

  it('cuts bluntly three bases from the PAM', () => {
    const { sites } = findGuideSites(bases, spCas9, 'linear')
    expect(sites[0].cutTop).toBe(27)
    expect(sites[0].cutBottom).toBe(27)
    expect(cutPosition(sites[0], bases.length, false)).toBe(27)
  })

  it('reads the site as spacer then PAM', () => {
    const { sites } = findGuideSites(bases, spCas9, 'linear')
    expect(siteSequence(sites[0], spCas9)).toBe(SPACER20 + 'AGG')
  })

  it('finds the same site on the antisense strand of the reverse complement', () => {
    const rc = 'GATGATGATG' + 'CCT' + 'ACGTACGTACGTACGTACGT' + 'GATGATGATG'
    const { sites } = findGuideSites(rc, spCas9, 'linear')
    expect(sites).toHaveLength(1)
    const s = sites[0]
    expect(s.strand).toBe(-1)
    expect(s.spacer).toBe(SPACER20)
    expect(s.pam).toBe('AGG')
    // The cut sits at the mirror of position 27 in a 43-mer.
    expect(s.cutTop).toBe(16)
    expect(s.cutBottom).toBe(16)
  })

  it('leaves a PAM with no room for a spacer alone', () => {
    const { sites } = findGuideSites('AGG' + FILLER + FILLER, spCas9, 'linear')
    expect(sites).toHaveLength(0)
  })
})

describe('finding sites with a 5-prime PAM', () => {
  const bases = CG_FILLER + 'TTTA' + SPACER23 + CG_FILLER

  it('takes the spacer downstream of the PAM', () => {
    const { sites } = findGuideSites(bases, cas12a, 'linear')
    expect(sites).toHaveLength(1)
    const s = sites[0]
    expect(s.strand).toBe(1)
    expect(s.pamStart).toBe(10)
    expect(s.pamEnd).toBe(14)
    expect(s.start).toBe(14)
    expect(s.end).toBe(37)
    expect(s.spacer).toBe(SPACER23)
    expect(s.pam).toBe('TTTA')
    expect(siteSequence(s, cas12a)).toBe('TTTA' + SPACER23)
  })

  it('cuts in a stagger away from the PAM', () => {
    const { sites } = findGuideSites(bases, cas12a, 'linear')
    expect(sites[0].cutTop).toBe(32)
    expect(sites[0].cutBottom).toBe(37)
  })

  it('flags a cut that runs off a linear end', () => {
    const short = CG_FILLER + 'TTTA' + SPACER20
    const { sites } = findGuideSites(short, cas12a, 'linear', { spacerLength: 20 })
    expect(sites).toHaveLength(1)
    expect(sites[0].offEnd).toBe(true)
    expect(cuttingGuides(sites, cas12a)).toHaveLength(0)
  })
})

describe('circular molecules', () => {
  // The spacer sits at the end of the sequence and its PAM at the start.
  const bases = 'AGG' + 'CATCATCATCATCATCAT' + SPACER20

  it('finds a site that spans the origin, once', () => {
    const { sites } = findGuideSites(bases, spCas9, 'circular')
    expect(sites).toHaveLength(1)
    const s = sites[0]
    expect(s.start).toBe(21)
    expect(s.end).toBe(0)
    expect(s.pamStart).toBe(0)
    expect(s.spacer).toBe(SPACER20)
    expect(s.cutTop).toBe(38)
  })

  it('does not find it when the same sequence is linear', () => {
    expect(findGuideSites(bases, spCas9, 'linear').sites).toHaveLength(0)
  })

  it('wraps a staggered cut back into the sequence', () => {
    const circ = SPACER23 + CG_FILLER + 'TTTA'
    const { sites } = findGuideSites(circ, cas12a, 'circular')
    expect(sites).toHaveLength(1)
    // PAM ends at the origin, so both cuts land inside the sequence.
    expect(sites[0].start).toBe(0)
    expect(sites[0].cutTop).toBe(18)
    expect(sites[0].cutBottom).toBe(23)
  })
})

describe('what the scan refuses', () => {
  it('passes over a spacer holding an ambiguous base and counts it', () => {
    const bases = FILLER + 'ACGTACGTNCGTACGTACGT' + 'AGG' + FILLER
    const scan = findGuideSites(bases, spCas9, 'linear')
    expect(scan.sites).toHaveLength(0)
    expect(scan.skippedAmbiguous).toBe(1)
  })

  it('stops at maxSites and says so', () => {
    const scan = findGuideSites('G'.repeat(300), spCas9, 'linear', { maxSites: 5 })
    expect(scan.sites).toHaveLength(5)
    expect(scan.truncated).toBe(true)
  })

  it('keeps only sites overlapping a region', () => {
    const bases = FILLER + SPACER20 + 'AGG' + FILLER
    expect(findGuideSites(bases, spCas9, 'linear', { region: { start: 0, end: 5 } }).sites).toHaveLength(0)
    expect(findGuideSites(bases, spCas9, 'linear', { region: { start: 25, end: 31 } }).sites).toHaveLength(1)
  })

  it('returns nothing for a sequence shorter than one site', () => {
    expect(findGuideSites('ACGTAGG', spCas9, 'linear').sites).toHaveLength(0)
    expect(findGuideSites('', spCas9, 'linear').sites).toHaveLength(0)
  })
})

describe('a nuclease the user describes', () => {
  it('rejects a PAM that is not IUPAC, and an impossible spacer', () => {
    expect(validPam('NGG')).toBe(true)
    expect(validPam('NXG')).toBe(false)
    expect(validPam('')).toBe(false)
    const errors = checkCustomNuclease({ name: '', pam: 'NXG', pamSide: 'threePrime', spacerLength: 2 })
    expect(errors.map(e => e.field).sort()).toEqual(['name', 'pam', 'spacerLength'])
  })

  it('wants both cut positions or neither', () => {
    const input = { name: 'Test', pam: 'NGG', pamSide: 'threePrime' as const, spacerLength: 20, cutSite: 3 }
    expect(checkCustomNuclease(input).map(e => e.field)).toEqual(['cut'])
  })

  it('scans with a PAM nobody shipped', () => {
    const n = customNuclease(
      { name: 'My nuclease', pam: 'ACGT', pamSide: 'threePrime', spacerLength: 18, cutSite: 2, cutOpposite: 6 },
      'custom-1',
    )
    expect(n.overhang).toBe('5prime')
    expect(n.custom).toBe(true)
    const bases = FILLER + 'CGCGCGCGCGCGCGCGCG' + 'ACGT' + FILLER
    const { sites } = findGuideSites(bases, n, 'linear')
    expect(sites).toHaveLength(1)
    expect(sites[0].spacer).toBe('CGCGCGCGCGCGCGCGCG')
    expect(sites[0].pam).toBe('ACGT')
    expect(sites[0].cutTop).toBe(26)
    expect(sites[0].cutBottom).toBe(22)
  })

  it('reports no cut for a row with no cut positions', () => {
    const n = customNuclease(
      { name: 'Binder', pam: 'NGG', pamSide: 'threePrime', spacerLength: 20 },
      'custom-2',
    )
    expect(n.cleaves).toBe('none')
    const bases = FILLER + SPACER20 + 'AGG' + FILLER
    const { sites } = findGuideSites(bases, n, 'linear')
    expect(sites).toHaveLength(1)
    expect(cuttingGuides(sites, n)).toHaveLength(0)
  })
})
