import { describe, it, expect } from 'vitest'
import {
  findOffTargets,
  hitScore,
  mismatchFactor,
  mismatchDiagram,
  specificity,
  DEFAULT_OFFTARGET,
  type SearchTarget,
} from './offtarget'
import { loadTargetFile, resolveTargets, searchedLine, MAX_TARGET_BASES } from './targets'
import { builtInNuclease } from './nucleases'
import { reverseComplement } from '../models/complement'
import type { Nuclease } from './types'

const spCas9 = builtInNuclease('spcas9') as Nuclease
const cas12a = builtInNuclease('ascas12a') as Nuclease

const SPACER = 'ACGTACGTACGTACGTACGT'
const FILLER = 'CATCATCATCATCATCATCATCATCATCATCATCAT'

/** A target holding one site: the given protospacer followed by a PAM. */
function targetWith(protospacer: string, pam = 'AGG', pad = FILLER): SearchTarget {
  return {
    id: 't1',
    name: 'test target',
    bases: pad + protospacer + pam + pad,
    topology: 'linear',
    source: 'document',
  }
}

/** Change the base at `i` of a spacer to something else. */
function mutate(seq: string, i: number): string {
  const next = seq[i] === 'A' ? 'C' : 'A'
  return seq.slice(0, i) + next + seq.slice(i + 1)
}

describe('finding off-target sites', () => {
  it('finds a perfect match on the sense strand', () => {
    const report = findOffTargets(SPACER, spCas9, [targetWith(SPACER)])
    expect(report.hits).toHaveLength(1)
    expect(report.hits[0].mismatches).toBe(0)
    expect(report.hits[0].strand).toBe(1)
    expect(report.hits[0].start).toBe(FILLER.length)
    expect(report.hits[0].protospacer).toBe(SPACER)
    expect(report.hits[0].pam).toBe('AGG')
  })

  it('finds the same site on the other strand', () => {
    const rc = reverseComplement(SPACER + 'AGG')
    const report = findOffTargets(SPACER, spCas9, [
      { id: 't1', name: 'rc', bases: FILLER + rc + FILLER, topology: 'linear', source: 'document' },
    ])
    expect(report.hits).toHaveLength(1)
    expect(report.hits[0].strand).toBe(-1)
    expect(report.hits[0].protospacer).toBe(SPACER)
  })

  it('finds a site inside the mismatch budget and not one outside it', () => {
    const two = mutate(mutate(SPACER, 0), 5)
    expect(findOffTargets(SPACER, spCas9, [targetWith(two)], { ...DEFAULT_OFFTARGET, maxMismatches: 2 }).hits)
      .toHaveLength(1)
    expect(findOffTargets(SPACER, spCas9, [targetWith(two)], { ...DEFAULT_OFFTARGET, maxMismatches: 1 }).hits)
      .toHaveLength(0)
  })

  it('reports which positions differ', () => {
    const changed = mutate(mutate(SPACER, 3), 11)
    const report = findOffTargets(SPACER, spCas9, [targetWith(changed)])
    expect(report.hits[0].mismatchPositions).toEqual([3, 11])
    const diagram = mismatchDiagram(SPACER, report.hits[0])
    expect(diagram.query).toBe(SPACER)
    expect(diagram.site).toMatch(/^\.{3}[ACGT]\.{7}[ACGT]\.{8}$/)
  })

  it('needs a PAM, however well the spacer matches', () => {
    expect(findOffTargets(SPACER, spCas9, [targetWith(SPACER, 'AAA')]).hits).toHaveLength(0)
  })

  it('searches an alternative PAM only when asked', () => {
    const target = targetWith(SPACER, 'AAG')
    expect(findOffTargets(SPACER, spCas9, [target]).hits).toHaveLength(0)
    const withAlt = findOffTargets(SPACER, spCas9, [target], { ...DEFAULT_OFFTARGET, alternativePams: true })
    const planted = withAlt.hits.find(h => h.start === FILLER.length && h.strand === 1)
    expect(planted).toBeDefined()
    expect(planted!.mismatches).toBe(0)
    expect(planted!.pam).toBe('AAG')
    expect(planted!.pamKind).toBe('alternative')
  })

  it('looks at every PAM the nuclease is known to bind, not just NAG', () => {
    // Each of these was measured as cut, so a guide that binds one of them is
    // an off-target the search has to be able to reach.
    const pams = ['AAG', 'ACG', 'AGA', 'ATG', 'AGC', 'AGT']
    for (const pam of pams) {
      const report = findOffTargets(SPACER, spCas9, [targetWith(SPACER, pam)],
        { ...DEFAULT_OFFTARGET, alternativePams: true })
      const planted = report.hits.find(h => h.start === FILLER.length && h.strand === 1)
      expect(planted, pam).toBeDefined()
      expect(planted!.pam).toBe(pam)
    }
    // AGG is the canonical one, and AAA was never seen cut, so it is not
    // searched at all.
    const none = findOffTargets(SPACER, spCas9, [targetWith(SPACER, 'AAA')],
      { ...DEFAULT_OFFTARGET, alternativePams: true })
    expect(none.hits.find(h => h.start === FILLER.length && h.strand === 1)).toBeUndefined()
  })

  it('scores each weaker PAM by what was measured for it', () => {
    // NAG is bound far more often than NGT, and a flat factor for every
    // alternative hid that.
    const score = (pam: string) => {
      const report = findOffTargets(SPACER, spCas9, [targetWith(SPACER, pam)],
        { ...DEFAULT_OFFTARGET, alternativePams: true })
      return report.hits.find(h => h.start === FILLER.length && h.strand === 1)!.score
    }
    expect(score('AGG')).toBe(1)
    expect(score('AAG')).toBeCloseTo(0.259259, 5)
    expect(score('AGT')).toBeCloseTo(0.016129, 5)
    expect(score('AAG')).toBeGreaterThan(score('AGA'))
    expect(score('AGA')).toBeGreaterThan(score('AGT'))
  })

  it('leaves the guide its own site out, and counts it', () => {
    const target = targetWith(SPACER)
    const report = findOffTargets(SPACER, spCas9, [target], DEFAULT_OFFTARGET, {
      targetId: 't1', start: FILLER.length, strand: 1,
    })
    expect(report.hits).toHaveLength(0)
    expect(report.onTargetSites).toBe(1)
  })

  it('still reports a second perfect match elsewhere', () => {
    const bases = FILLER + SPACER + 'AGG' + FILLER + SPACER + 'AGG' + FILLER
    const report = findOffTargets(
      SPACER, spCas9,
      [{ id: 't1', name: 'twice', bases, topology: 'linear', source: 'document' }],
      DEFAULT_OFFTARGET,
      { targetId: 't1', start: FILLER.length, strand: 1 },
    )
    expect(report.onTargetSites).toBe(1)
    expect(report.hits).toHaveLength(1)
    expect(report.hits[0].mismatches).toBe(0)
  })

  it('wraps around a circular target', () => {
    const bases = 'GG' + FILLER + SPACER + 'A'
    const report = findOffTargets(SPACER, spCas9, [
      { id: 'p', name: 'plasmid', bases, topology: 'circular', source: 'document' },
    ])
    expect(report.hits).toHaveLength(1)
    expect(report.hits[0].protospacer).toBe(SPACER)
  })

  it('searches several targets and names each of them', () => {
    const report = findOffTargets(SPACER, spCas9, [
      targetWith(SPACER),
      { id: 't2', name: 'second', bases: FILLER + mutate(SPACER, 2) + 'TGG' + FILLER, topology: 'linear', source: 'file' },
    ])
    expect(report.searched.map(s => s.name)).toEqual(['test target', 'second'])
    expect(report.hits.map(h => h.targetName).sort()).toEqual(['second', 'test target'])
  })

  it('says which feature a hit lands in', () => {
    const target: SearchTarget = {
      ...targetWith(SPACER),
      features: [
        { name: 'wide', type: 'misc_feature', start: 0, end: 200 },
        { name: 'theGene', type: 'CDS', start: 30, end: 80 },
      ],
    }
    const report = findOffTargets(SPACER, spCas9, [target])
    expect(report.hits[0].feature).toEqual({ name: 'theGene', type: 'CDS' })
  })

  it('stops at the hit cap and says so', () => {
    const unit = SPACER + 'AGG'
    const report = findOffTargets(SPACER, spCas9, [
      { id: 'many', name: 'many', bases: unit.repeat(40), topology: 'linear', source: 'document' },
    ], { ...DEFAULT_OFFTARGET, maxHits: 5 })
    expect(report.hits).toHaveLength(5)
    expect(report.truncated).toBe(true)
  })

  it('reports progress as it goes', () => {
    const seen: string[] = []
    findOffTargets(SPACER, spCas9, [targetWith(SPACER), targetWith(SPACER)], DEFAULT_OFFTARGET, undefined, p => {
      seen.push(`${p.done}/${p.total}`)
    })
    expect(seen[0]).toBe('0/2')
    expect(seen[seen.length - 1]).toBe('2/2')
  })

  it('works for a nuclease whose PAM comes first', () => {
    const spacer23 = 'ACGTACGTACGTACGTACGTACG'
    const bases = 'CGCGCGCGCG' + 'TTTA' + spacer23 + 'CGCGCGCGCG'
    const report = findOffTargets(spacer23, cas12a, [
      { id: 'c', name: 'cas12a target', bases, topology: 'linear', source: 'document' },
    ])
    expect(report.hits).toHaveLength(1)
    expect(report.hits[0].pam).toBe('TTTA')
    expect(report.hits[0].protospacer).toBe(spacer23)
  })
})

describe('bulges', () => {
  it('finds a site with one extra base in the target, only when asked', () => {
    // An extra T inside the protospacer makes the window one base longer.
    const withExtra = SPACER.slice(0, 10) + 'T' + SPACER.slice(10)
    const target = targetWith(withExtra)
    expect(findOffTargets(SPACER, spCas9, [target]).hits).toHaveLength(0)
    const report = findOffTargets(SPACER, spCas9, [target], { ...DEFAULT_OFFTARGET, bulges: true })
    const bulged = report.hits.find(h => h.bulge?.kind === 'dna')
    expect(bulged).toBeDefined()
    expect(bulged?.mismatches).toBe(0)
  })

  it('finds a site missing a base, as an unpaired base in the guide', () => {
    const missing = SPACER.slice(0, 10) + SPACER.slice(11)
    const report = findOffTargets(SPACER, spCas9, [targetWith(missing)], { ...DEFAULT_OFFTARGET, bulges: true })
    expect(report.hits.some(h => h.bulge?.kind === 'rna')).toBe(true)
  })

  it('scores a bulged site below a clean one', () => {
    const clean = hitScore([], 20, 'threePrime', 'AGG', 1, false)
    const bulged = hitScore([], 20, 'threePrime', 'AGG', 1, true)
    expect(bulged).toBeLessThan(clean)
  })
})

/** One mismatch at a position, with bases the position model ignores. */
function mm(position: number) {
  return { position, spacerBase: 'A', targetBase: 'C' }
}

describe('scoring', () => {
  it('costs a mismatch most next to the PAM', () => {
    expect(mismatchFactor(0, 20)).toBeLessThan(mismatchFactor(19, 20))
    expect(mismatchFactor(0, 20)).toBeGreaterThan(0)
    expect(mismatchFactor(19, 20)).toBeLessThan(1)
  })

  it('falls as mismatches accumulate', () => {
    const one = hitScore([mm(19)], 20, 'threePrime', 'AGG', 1, false)
    const two = hitScore([mm(19), mm(18)], 20, 'threePrime', 'AGG', 1, false)
    expect(two).toBeLessThan(one)
    expect(one).toBeLessThan(1)
  })

  it('counts the PAM-proximal end correctly for either PAM side', () => {
    // Position 19 is next to a 3' PAM, and furthest from a 5' one.
    const nearThree = hitScore([mm(19)], 20, 'threePrime', 'AGG', 1, false)
    const farFive = hitScore([mm(19)], 20, 'fivePrime', 'AGG', 1, false)
    expect(nearThree).toBeLessThan(farFive)
  })

  it('discounts an alternative PAM', () => {
    expect(hitScore([], 20, 'threePrime', 'AAG', 0.26, false))
      .toBeLessThan(hitScore([], 20, 'threePrime', 'AGG', 1, false))
  })

  it('gives a guide with nothing else to bind full marks', () => {
    expect(specificity([])).toBe(100)
  })

  it('falls as credible hits accumulate', () => {
    const hit = (score: number) => ({ score } as never)
    expect(specificity([hit(1)])).toBe(50)
    expect(specificity([hit(0.01)])).toBeGreaterThan(98)
    expect(specificity([hit(1), hit(1), hit(1)])).toBe(25)
  })
})

describe('what gets searched', () => {
  const docs = [
    { id: 'a', name: 'plasmid A', bases: 'ACGT'.repeat(10), topology: 'circular' as const, isProtein: false },
    { id: 'b', name: 'plasmid B', bases: 'ACGT'.repeat(10), topology: 'linear' as const, isProtein: false },
    { id: 'p', name: 'a protein', bases: 'MKV', topology: 'linear' as const, isProtein: true },
  ]

  it('resolves the open document, or all of them', () => {
    expect(resolveTargets('document', 'a', docs, null).map(t => t.id)).toEqual(['a'])
    expect(resolveTargets('open', 'a', docs, null).map(t => t.id)).toEqual(['a', 'b'])
  })

  it('leaves proteins out of the open set', () => {
    expect(resolveTargets('open', 'a', docs, null).some(t => t.id === 'p')).toBe(false)
  })

  it('resolves a loaded file, and nothing when none is loaded', () => {
    const loaded = loadTargetFile('>one\nACGTACGT\n>two\nTTTTGGGG\n', 'genome.fa')
    expect('records' in loaded).toBe(true)
    if (!('records' in loaded)) return
    expect(loaded.records).toHaveLength(2)
    expect(loaded.totalBases).toBe(16)
    expect(resolveTargets('file', 'a', docs, loaded).map(t => t.name)).toEqual(['one', 'two'])
    expect(resolveTargets('file', 'a', docs, null)).toEqual([])
  })

  it('refuses a protein file and an empty one', () => {
    expect(loadTargetFile('>p\nMKVLAAGIVGLNLGGKEEEE\n', 'p.fa')).toHaveProperty('message')
    expect(loadTargetFile('', 'empty.fa')).toHaveProperty('message')
  })

  it('has a size it will not go past', () => {
    expect(MAX_TARGET_BASES).toBeGreaterThan(4_000_000)
  })

  it('names what was searched', () => {
    expect(searchedLine([])).toMatch(/Nothing/)
    expect(searchedLine([{ name: 'pUC19', length: 2686 }])).toBe('Searched pUC19 (3 kb).')
    expect(searchedLine([{ name: 'a', length: 1000 }, { name: 'b', length: 1000 }]))
      .toBe('Searched a, b (2 kb in all).')
    expect(searchedLine([
      { name: 'a', length: 1 }, { name: 'b', length: 1 }, { name: 'c', length: 1 }, { name: 'd', length: 1 },
    ])).toBe('Searched 4 sequences, 4 bp in all.')
  })
})

describe('the mismatch diagram', () => {
  it('lines up the columns when a base is unpaired', () => {
    const spacer = 'ACGTTGCATGCAACGTTGCA'
    // An extra base in the target, inside the pairing.
    const extra = spacer.slice(0, 9) + 'A' + spacer.slice(9)
    const bases = 'TTTTTTTTTT' + extra + 'AGG' + 'TTTTTTTTTT'
    const report = findOffTargets(spacer, spCas9, [{
      id: 't', name: 't', bases, topology: 'linear', source: 'document',
    }], { ...DEFAULT_OFFTARGET, bulges: true })
    const hit = report.hits.find(h => h.bulge)
    expect(hit).toBeDefined()
    expect(hit!.bulge!.kind).toBe('dna')
    const diagram = mismatchDiagram(spacer, hit!)
    expect(diagram.query).toHaveLength(diagram.site.length)
    expect(diagram.query).toContain('-')
    // Every paired column matches, so only the unpaired base shows a letter.
    expect(diagram.site.replace(/\./g, '')).toBe('A')
  })

  it('marks a plain hit against the spacer base for base', () => {
    const site = mutate(SPACER, 4)
    const report = findOffTargets(SPACER, spCas9, [targetWith(site)])
    const diagram = mismatchDiagram(SPACER, report.hits[0])
    expect(diagram.query).toBe(SPACER)
    expect(diagram.site).toHaveLength(SPACER.length)
    expect([...diagram.site].filter(c => c !== '.')).toHaveLength(1)
    expect(diagram.site[4]).toBe(site[4])
  })
})
