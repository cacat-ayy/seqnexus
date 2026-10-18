import { describe, it, expect } from 'vitest'
import { codingTarget, codingIndex, genomicIndex, codingBases, codonAt, codonChange, shiftFeatures } from './coding'
import { planKnockout, DEFAULT_KNOCKOUT } from './knockout'
import { planDeletion, applyDeletion, junctionAround } from './deletion'
import { designDonor, findIntactSite, DEFAULT_KNOCKIN } from './knockin'
import { planBaseEdits, editorById, genomicOfProtospacerPosition, EDITORS } from './baseedit'
import { planTiling, tilingCsv, DEFAULT_TILE } from './tile'
import { findGuideSites } from '../finder'
import { scoreSites } from '../score/guide'
import { builtInNuclease } from '../nucleases'
import { reverseComplement } from '../../models/complement'
import type { GuideCandidate, Nuclease } from '../types'

const spCas9 = builtInNuclease('spcas9') as Nuclease

/** Scored candidates for a sequence, as the panel would have them. */
function scan(bases: string, nuclease: Nuclease = spCas9): GuideCandidate[] {
  const { sites } = findGuideSites(bases, nuclease, 'linear')
  return scoreSites(sites, nuclease, bases, 'linear')
}

// A gene with no stop codon inside it, long enough to have guides along it.
const CDS = 'ATG' + 'GCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGGTGAAGGTGATGCAACATACGGAAAACTTACCCTTAAATTTATTTGCACTACTGGAAAACTACCTGTT' + 'TAA'
const PAD = 'CATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCAT'
const GENOME = PAD + CDS + PAD

describe('coding coordinates', () => {
  const forward = codingTarget(
    { name: 'gfp', type: 'CDS', start: PAD.length, end: PAD.length + CDS.length, strand: 1 },
    GENOME.length,
  )!

  it('builds a target from a CDS feature', () => {
    expect(forward.length).toBe(CDS.length)
    expect(forward.strand).toBe(1)
    expect(codingBases(forward, GENOME)).toBe(CDS)
  })

  it('maps genomic to coding and back', () => {
    expect(codingIndex(forward, PAD.length)).toBe(0)
    expect(codingIndex(forward, PAD.length + 10)).toBe(10)
    expect(codingIndex(forward, 0)).toBeNull()
    expect(genomicIndex(forward, 0)).toBe(PAD.length)
    expect(genomicIndex(forward, 10)).toBe(PAD.length + 10)
    expect(genomicIndex(forward, CDS.length + 5)).toBeNull()
  })

  it('counts backwards along a reverse gene', () => {
    const rcGenome = reverseComplement(GENOME)
    const start = PAD.length
    const reverse = codingTarget(
      { name: 'rev', type: 'CDS', start, end: start + CDS.length, strand: -1 },
      rcGenome.length,
    )!
    expect(codingBases(reverse, rcGenome)).toBe(CDS)
    // The first coding base is the rightmost one of the span.
    expect(codingIndex(reverse, start + CDS.length - 1)).toBe(0)
    expect(genomicIndex(reverse, 0)).toBe(start + CDS.length - 1)
  })

  it('walks the exons of a spliced gene in order', () => {
    const spliced = codingTarget(
      {
        name: 'spliced', type: 'CDS', start: 10, end: 60, strand: 1,
        segments: [[10, 25], [40, 60]],
      },
      200,
    )!
    expect(spliced.length).toBe(35)
    expect(codingIndex(spliced, 24)).toBe(14)
    expect(codingIndex(spliced, 30)).toBeNull()
    expect(codingIndex(spliced, 40)).toBe(15)
  })

  it('says what changing a base does to its codon', () => {
    const cds = codingBases(forward, GENOME)
    expect(codonAt(0)).toEqual({ codon: 1, offset: 0 })
    expect(codonAt(5)).toEqual({ codon: 2, offset: 2 })
    // Third base of a codon is where silent changes live.
    const silent = codonChange(forward, cds, 5, cds[5] === 'T' ? 'C' : 'T')
    expect(silent?.kind === 'silent' || silent?.kind === 'missense').toBe(true)
    const stop = codonChange(forward, cds, 3, 'T')
    expect(stop).not.toBeNull()
  })

  it('moves features around an edit and drops the ones inside it', () => {
    const features = [
      { name: 'before', start: 0, end: 10 },
      { name: 'inside', start: 20, end: 30 },
      { name: 'across', start: 15, end: 40 },
      { name: 'after', start: 50, end: 60 },
    ]
    const { kept, removed } = shiftFeatures(features, 18, 35, 0)
    expect(removed.map(f => f.name)).toEqual(['inside'])
    expect(kept.find(f => f.name === 'after')).toMatchObject({ start: 33, end: 43 })
    expect(kept.find(f => f.name === 'across')).toMatchObject({ truncated: true })
    expect(kept.find(f => f.name === 'before')).toMatchObject({ start: 0, end: 10 })
  })
})

describe('knockout', () => {
  const target = codingTarget(
    { name: 'gfp', type: 'CDS', start: PAD.length, end: PAD.length + CDS.length, strand: 1 },
    GENOME.length,
  )!
  const candidates = scan(GENOME)

  it('keeps only guides that cut inside the gene', () => {
    const plan = planKnockout(candidates, target, GENOME.length, false, spCas9)
    expect(plan.picks.length).toBeGreaterThan(0)
    expect(plan.outside).toBeGreaterThan(0)
    for (const pick of plan.picks) {
      expect(pick.codingFraction).toBeGreaterThanOrEqual(0)
      expect(pick.codingFraction).toBeLessThanOrEqual(1)
      expect(pick.codon).toBeGreaterThanOrEqual(1)
    }
  })

  it('puts guides inside the preferred stretch first', () => {
    const plan = planKnockout(candidates, target, GENOME.length, false, spCas9)
    const firstOutside = plan.picks.findIndex(p => !p.inWindow)
    if (firstOutside > 0) {
      expect(plan.picks.slice(0, firstOutside).every(p => p.inWindow)).toBe(true)
      expect(plan.picks.slice(firstOutside).every(p => !p.inWindow)).toBe(true)
    }
  })

  it('warns about a cut too near the start or too late in the gene', () => {
    const plan = planKnockout(candidates, target, GENOME.length, false, spCas9, {
      ...DEFAULT_KNOCKOUT, windowStart: 0.4, windowEnd: 0.5,
    })
    const early = plan.picks.find(p => p.codingFraction < 0.4)
    const late = plan.picks.find(p => p.codingFraction > 0.5)
    expect(early?.warnings.some(w => /start codon/.test(w))).toBe(true)
    expect(late?.warnings.some(w => /Late in the gene/.test(w))).toBe(true)
  })

  it('says where each guide cuts, in codons', () => {
    const plan = planKnockout(candidates, target, GENOME.length, false, spCas9)
    expect(plan.picks[0].reasons[0]).toMatch(/codon \d+ of \d+/)
  })
})

describe('deletion', () => {
  const bases = PAD + 'ACGTACGTACGTACGTACGT' + 'AGG' + PAD + 'TTTTGCGCGCGCGCGCGCGC' + 'TGG' + PAD
  const candidates = scan(bases)
  const region = { start: PAD.length + 40, end: PAD.length + 80 }

  it('pairs a cut each side of the region', () => {
    const pairs = planDeletion(candidates, region, bases, false, spCas9)
    expect(pairs.length).toBeGreaterThan(0)
    for (const pair of pairs) {
      expect(pair.start).toBeLessThanOrEqual(region.start)
      expect(pair.end).toBeGreaterThanOrEqual(region.end)
      expect(pair.length).toBe(pair.end - pair.start)
    }
  })

  it('prefers the pair that loses least beyond the region', () => {
    const pairs = planDeletion(candidates, region, bases, false, spCas9)
    const overshoot = (p: typeof pairs[0]) => p.overshoot.left + p.overshoot.right
    const clean = pairs.filter(p => p.warnings.length === 0)
    for (let i = 1; i < clean.length; i++) {
      expect(overshoot(clean[i])).toBeGreaterThanOrEqual(overshoot(clean[i - 1]))
    }
  })

  it('stays inside the flank it is given', () => {
    const near = planDeletion(candidates, region, bases, false, spCas9, { flank: 10, maxPairs: 40 })
    for (const pair of near) {
      expect(region.start - pair.start).toBeLessThanOrEqual(10)
      expect(pair.end - region.end).toBeLessThanOrEqual(10)
    }
  })

  it('shows the join it would make', () => {
    expect(junctionAround('AAAACCCCGGGGTTTT', 4, 12, 4)).toBe('AAAA|TTTT')
    const pairs = planDeletion(candidates, region, bases, false, spCas9)
    expect(pairs[0].junction).toContain('|')
  })

  it('builds the sequence the pair leaves behind', () => {
    const pairs = planDeletion(candidates, region, bases, false, spCas9)
    const features = [
      { name: 'gone', type: 'misc_feature', start: pairs[0].start + 1, end: pairs[0].end - 1, strand: 1 as const },
      { name: 'after', type: 'misc_feature', start: pairs[0].end + 5, end: pairs[0].end + 15, strand: 1 as const },
    ]
    const result = applyDeletion(bases, features, pairs[0])
    expect(result.bases.length).toBe(bases.length - pairs[0].length)
    expect(result.removed.map(f => f.name)).toEqual(['gone'])
    expect(result.features[0].start).toBe(pairs[0].start + 5)
  })
})

describe('knock-in donors', () => {
  const bases = PAD + 'ACGTACGTACGTACGTACGT' + 'AGG' + PAD
  const candidate = scan(bases).find(c => c.site.spacer === 'ACGTACGTACGTACGTACGT')!
  const cutAt = PAD.length + 17

  it('finds an intact site, and sees when one is gone', () => {
    expect(findIntactSite(bases, candidate.site.spacer, spCas9)).toMatchObject({ start: PAD.length, strand: 1 })
    const broken = bases.slice(0, PAD.length + 10) + 'TTTTTTTTTT' + bases.slice(PAD.length + 20)
    expect(findIntactSite(broken, candidate.site.spacer, spCas9)).toBeNull()
  })

  it('finds a site on the other strand too', () => {
    const rc = reverseComplement(bases)
    expect(findIntactSite(rc, candidate.site.spacer, spCas9)).toMatchObject({ strand: -1 })
  })

  it('builds arms of the asked-for length around the insertion point', () => {
    const donor = designDonor(candidate, bases, 'GGATCC', cutAt, spCas9, null)
    expect(donor.leftArm).toHaveLength(DEFAULT_KNOCKIN.armLength)
    expect(donor.rightArm).toHaveLength(DEFAULT_KNOCKIN.armLength)
    expect(donor.donor).toBe(donor.leftArm + 'GGATCC' + donor.rightArm)
    expect(donor.payload).toBe('GGATCC')
  })

  it('makes the far arm longer when asked', () => {
    const donor = designDonor(candidate, bases, 'GGATCC', cutAt, spCas9, null, {
      ...DEFAULT_KNOCKIN, asymmetric: true,
    })
    expect(donor.leftArm.length).not.toBe(donor.rightArm.length)
    expect(Math.max(donor.leftArm.length, donor.rightArm.length)).toBe(DEFAULT_KNOCKIN.armLength * 2)
  })

  it('leaves a donor alone when the payload already broke the site', () => {
    const donor = designDonor(candidate, bases, 'GGATCCGGATCCGGATCC', cutAt, spCas9, null)
    expect(donor.wouldRecut).toBe(false)
    expect(donor.block).toBeNull()
  })

  it('changes one base when the site survives the edit', () => {
    // A donor built away from the cut keeps the whole site intact.
    const donor = designDonor(candidate, bases, 'GGATCC', PAD.length + 40, spCas9, null)
    expect(donor.wouldRecut).toBe(true)
    expect(donor.block).not.toBeNull()
    expect(findIntactSite(donor.donor, candidate.site.spacer, spCas9)).toBeNull()
    expect(donor.donor).toHaveLength(donor.leftArm.length + 6 + donor.rightArm.length)
  })

  it('leaves the site alone when told not to block it, and says so', () => {
    const donor = designDonor(candidate, bases, 'GGATCC', PAD.length + 40, spCas9, null, {
      ...DEFAULT_KNOCKIN, blockRecut: 'none',
    })
    expect(donor.block).toBeNull()
    expect(donor.warnings.some(w => /cut again/.test(w))).toBe(true)
  })

  it('prefers a change that leaves the protein as it was', () => {
    // Put the site inside a coding sequence so synonymy is possible.
    const coding = 'ATG' + 'ACGTACGTACGTACGTACGT' + 'AGG' + 'GCTGCTGCTGCTGCTGCTTAA'
    const genome = PAD + coding + PAD
    const inGene = scan(genome).find(c => c.site.spacer === 'ACGTACGTACGTACGTACGT')!
    const target = codingTarget(
      { name: 'g', type: 'CDS', start: PAD.length, end: PAD.length + coding.length, strand: 1 },
      genome.length,
    )!
    const donor = designDonor(inGene, genome, 'GGATCC', PAD.length + coding.length - 5, spCas9, target)
    expect(donor.block).not.toBeNull()
    if (donor.block?.codon) expect(donor.block.silent).toBe(donor.block.codon.aa === donor.block.codon.toAa)
  })

  it('drops payload characters that are not bases, and says so', () => {
    const donor = designDonor(candidate, bases, 'GGA TCC-XYZ', cutAt, spCas9, null)
    expect(donor.payload).toBe('GGATCC')
    expect(donor.warnings.some(w => /not A, C, G or T/.test(w))).toBe(true)
  })
})

describe('base editing', () => {
  const cbe = editorById('cbe')!
  const abe = editorById('abe')!

  it('offers both kinds of editor with their windows', () => {
    expect(EDITORS.length).toBeGreaterThanOrEqual(4)
    expect(cbe.from).toBe('C')
    expect(cbe.to).toBe('T')
    expect(abe.from).toBe('A')
    expect(abe.window[0]).toBeLessThan(abe.window[1])
  })

  it('counts protospacer positions from the PAM-distal end', () => {
    const bases = PAD + 'ACGTACGTACGTACGTACGT' + 'AGG' + PAD
    const candidate = scan(bases).find(c => c.site.spacer === 'ACGTACGTACGTACGTACGT')!
    // Position 1 is the first base of the spacer for a 3' PAM on the sense strand.
    expect(genomicOfProtospacerPosition(candidate.site, spCas9, 1, bases.length)).toBe(PAD.length)
    expect(genomicOfProtospacerPosition(candidate.site, spCas9, 20, bases.length)).toBe(PAD.length + 19)
  })

  it('finds the bases an editor would change, in its window only', () => {
    // C at protospacer positions 2, 6, 10, 14, 18.
    const bases = PAD + 'ACGTACGTACGTACGTACGT' + 'AGG' + PAD
    const candidate = scan(bases).find(c => c.site.spacer === 'ACGTACGTACGTACGTACGT')!
    const picks = planBaseEdits([candidate], cbe, bases, spCas9)
    expect(picks).toHaveLength(1)
    expect(picks[0].edits.map(e => e.position)).toEqual([6])
    const wide = planBaseEdits([candidate], editorById('cbe-wide')!, bases, spCas9)
    expect(wide[0].edits.map(e => e.position)).toEqual([2, 6, 10])
  })

  it('takes a window override', () => {
    const bases = PAD + 'ACGTACGTACGTACGTACGT' + 'AGG' + PAD
    const candidate = scan(bases).find(c => c.site.spacer === 'ACGTACGTACGTACGTACGT')!
    const picks = planBaseEdits([candidate], cbe, bases, spCas9, { window: [1, 20] })
    expect(picks[0].edits.map(e => e.position)).toEqual([2, 6, 10, 14, 18])
  })

  it('marks the asked-for base and calls the rest bystanders', () => {
    const bases = PAD + 'ACGTACGTACGTACGTACGT' + 'AGG' + PAD
    const candidate = scan(bases).find(c => c.site.spacer === 'ACGTACGTACGTACGTACGT')!
    const wanted = PAD.length + 5 // the C at position 6
    const picks = planBaseEdits([candidate], editorById('cbe-wide')!, bases, spCas9, { target: wanted })
    expect(picks[0].target?.genomic).toBe(wanted)
    expect(picks[0].bystanders.map(b => b.position)).toEqual([2, 10])
    expect(picks[0].warnings.some(w => /bystander/.test(w))).toBe(true)
  })

  it('leaves out guides whose window misses the asked-for base', () => {
    const bases = PAD + 'ACGTACGTACGTACGTACGT' + 'AGG' + PAD
    const candidates = scan(bases)
    const picks = planBaseEdits(candidates, cbe, bases, spCas9, { target: PAD.length + 1 })
    expect(picks.every(p => p.target !== null)).toBe(true)
  })

  it('says what each edit does to the protein', () => {
    const coding = 'ATG' + 'CAACAACAACAACAACAACAA' + 'AGG' + 'GCTGCTTAA'
    const genome = PAD + coding + PAD
    const target = codingTarget(
      { name: 'g', type: 'CDS', start: PAD.length, end: PAD.length + coding.length, strand: 1 },
      genome.length,
    )!
    const candidates = scan(genome)
    const picks = planBaseEdits(candidates, editorById('cbe-wide')!, genome, spCas9, { coding: target })
    const withConsequence = picks.flatMap(p => p.edits).filter(e => e.consequence)
    expect(withConsequence.length).toBeGreaterThan(0)
    for (const edit of withConsequence) {
      expect(['silent', 'missense', 'nonsense', 'start-lost']).toContain(edit.consequence!.kind)
    }
  })

  it('puts the guide with fewest bystanders first', () => {
    const bases = PAD + 'ACGTACGTACGTACGTACGT' + 'AGG' + PAD + 'CCCCACGTACGTACGTACGT' + 'CGG' + PAD
    const picks = planBaseEdits(scan(bases), editorById('cbe-wide')!, bases, spCas9)
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i].bystanders.length).toBeGreaterThanOrEqual(picks[i - 1].bystanders.length)
    }
  })
})

describe('tiling', () => {
  const bases = GENOME
  const candidates = scan(bases)
  const region = { start: 0, end: bases.length }

  it('spaces its picks out', () => {
    const plan = planTiling(candidates, region, bases.length, false, spCas9, { ...DEFAULT_TILE, spacing: 60, count: 5 })
    expect(plan.picks.length).toBeGreaterThan(1)
    for (let i = 1; i < plan.picks.length; i++) {
      expect(plan.picks[i].cut - plan.picks[i - 1].cut).toBeGreaterThanOrEqual(60)
    }
  })

  it('returns them in order along the sequence', () => {
    const plan = planTiling(candidates, region, bases.length, false, spCas9)
    const cuts = plan.picks.map(p => p.cut)
    expect(cuts).toEqual([...cuts].sort((a, b) => a - b))
  })

  it('stops at the number asked for', () => {
    const plan = planTiling(candidates, region, bases.length, false, spCas9, { ...DEFAULT_TILE, spacing: 1, count: 3 })
    expect(plan.picks).toHaveLength(3)
  })

  it('reports the stretches it could not cover', () => {
    const plan = planTiling(candidates, region, bases.length, false, spCas9, { ...DEFAULT_TILE, spacing: 20, count: 2 })
    expect(plan.gaps.length).toBeGreaterThan(0)
    for (const [from, to] of plan.gaps) expect(to - from).toBeGreaterThan(20)
  })

  it('leaves flagged guides out when asked, and counts them', () => {
    const plan = planTiling(candidates, region, bases.length, false, spCas9, { ...DEFAULT_TILE, skipFlagged: true })
    const loose = planTiling(candidates, region, bases.length, false, spCas9, { ...DEFAULT_TILE, skipFlagged: false })
    expect(plan.skipped).toBeGreaterThanOrEqual(0)
    expect(loose.skipped).toBe(0)
  })

  it('writes the set out as a table', () => {
    const plan = planTiling(candidates, region, bases.length, false, spCas9, { ...DEFAULT_TILE, count: 3 })
    const csv = tilingCsv(plan, 'SpCas9')
    const lines = csv.trimEnd().split('\n')
    expect(lines[0]).toBe('name,spacer,pam,cut,strand,score,nuclease')
    expect(lines).toHaveLength(plan.picks.length + 1)
    expect(lines[1].split(',')[1]).toBe(plan.picks[0].candidate.site.spacer)
  })
})
