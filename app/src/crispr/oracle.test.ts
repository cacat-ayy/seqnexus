/**
 * The CRISPR engine measured against independent oracles.
 *
 * The fixtures these tests read are built by scripts/crispr-oracle/oracle.py,
 * which implements each model from its paper or from the reference tool named
 * there, and never imports this app. Two kinds of test live here:
 *
 * - Agreement tests, where the app and the oracle must give the same answer.
 *   The exhaustive off-target sweep is one: any site the sweep finds and the
 *   app does not is a bug, and the case name says which input triggered it.
 * - Characterisation tests, where the app's model is not the published one.
 *   These record today's distance from the published model as a number so a
 *   change in either direction shows up as a failing test rather than a
 *   silent drift. Each says what the number means and what would improve it.
 *
 * Regenerate the fixtures with:
 *   python scripts/crispr-oracle/oracle.py --out testdata/crispr
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { findGuideSites, cutPosition } from './finder'
import { builtInNuclease } from './nucleases'
import {
  ALTERNATIVE_PAM_FACTOR,
  DEFAULT_OFFTARGET,
  findOffTargets,
  hitScore,
  specificity,
  type OffTargetHit,
  type SearchTarget,
} from './offtarget'
import { cfdMismatchFactor, cfdPamActivity } from './score/cfd'
import {
  DEFAULT_MIN_LENGTH,
  DEFAULT_WINDOW,
  microhomologyOutcome,
} from './score/microhomology'
import type { Nuclease } from './types'

const DATA = join(__dirname, '../../testdata/crispr')

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATA, name), 'utf8')) as T
}

interface BruteCase {
  name: string
  nuclease: string
  topology: 'linear' | 'circular'
  sequence: string
  spacer: string
  maxMismatches: number
  hits: {
    start: number
    strand: 1 | -1
    protospacer: string
    pam: string
    mismatches: number
    mismatchPositions: number[]
  }[]
  bestAlignments: { start: number; strand: 1 | -1; kind: 'plain' | 'dna' | 'rna'; mismatches: number }[]
}

const brute = fixture<{ cases: BruteCase[] }>('offtarget-bruteforce.json')

function target(c: BruteCase): SearchTarget {
  return {
    id: 't',
    name: c.name,
    bases: c.sequence,
    topology: c.topology,
    source: 'document',
  }
}

function nucleaseOf(c: BruteCase): Nuclease {
  const n = builtInNuclease(c.nuclease)
  if (!n) throw new Error(`fixture names an unknown nuclease: ${c.nuclease}`)
  return n
}

/** A hit as a string, so two lists can be compared as sets. */
function key(h: { start: number; strand: number; mismatchPositions: number[] }): string {
  return `${h.start}/${h.strand}/${h.mismatchPositions.join('.')}`
}

describe('off-target search against an exhaustive sweep', () => {
  it('covers every nuclease geometry and both topologies', () => {
    const kinds = new Set(brute.cases.map(c => `${c.nuclease}/${c.topology}`))
    expect(kinds.size).toBeGreaterThanOrEqual(7)
    expect(brute.cases.reduce((n, c) => n + c.hits.length, 0)).toBeGreaterThan(500)
  })

  for (const c of brute.cases) {
    it(`finds the same sites: ${c.name}`, () => {
      const report = findOffTargets(c.spacer, nucleaseOf(c), [target(c)], {
        maxMismatches: c.maxMismatches,
        bulges: false,
        alternativePams: false,
        maxHits: 100000,
      })
      const mine = new Set(report.hits.map(key))
      const theirs = new Set(c.hits.map(key))
      const missed = [...theirs].filter(k => !mine.has(k))
      const extra = [...mine].filter(k => !theirs.has(k))
      expect({ missed, extra }).toEqual({ missed: [], extra: [] })
      expect(report.truncated).toBe(false)
    })
  }

  it('reads the protospacer and the PAM off the right strand', () => {
    for (const c of brute.cases) {
      const report = findOffTargets(c.spacer, nucleaseOf(c), [target(c)], {
        maxMismatches: c.maxMismatches,
        bulges: false,
        alternativePams: false,
        maxHits: 100000,
      })
      const byKey = new Map(report.hits.map(h => [key(h), h]))
      for (const want of c.hits) {
        const got = byKey.get(key(want))
        expect(got, `${c.name} at ${want.start}`).toBeDefined()
        expect(got!.protospacer).toBe(want.protospacer)
        expect(got!.pam).toBe(want.pam)
        expect(got!.mismatches).toBe(want.mismatches)
      }
    }
  })

  it('gives the same account of each site with one unpaired base allowed', () => {
    // With bulges on, one PAM still yields one site: the sweep works out
    // which of the three windows explains it with the fewest changes, and the
    // app must choose the same one. The gap position itself is a tie-break
    // the two need not share, so it is not compared.
    const failures: string[] = []
    for (const c of brute.cases) {
      const report = findOffTargets(c.spacer, nucleaseOf(c), [target(c)], {
        maxMismatches: c.maxMismatches,
        bulges: true,
        alternativePams: false,
        maxHits: 100000,
      })
      const mine = report.hits.map(h =>
        `${h.start}/${h.strand}/${h.bulge?.kind ?? 'plain'}/${h.mismatches}`).sort()
      const theirs = c.bestAlignments.map(a =>
        `${a.start}/${a.strand}/${a.kind}/${a.mismatches}`).sort()
      const missed = theirs.filter(k => !mine.includes(k))
      const extra = mine.filter(k => !theirs.includes(k))
      if (missed.length || extra.length) {
        failures.push(`${c.name}: missing ${missed.slice(0, 4).join(' ')} extra ${extra.slice(0, 4).join(' ')}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('does not report an ordinary site a second time as a bulged one', () => {
    // A gap at the edge of a window is the plain comparison one base along.
    // Counted as a bulge it would make every site three sites, and the two
    // phantoms would pull the guide's own specificity down.
    const spacer = 'ACGTTGCATGCAACGTTGCA'
    const bases = 'A'.repeat(200) + spacer + 'AGG' + 'A'.repeat(200)
    const own = { targetId: 't', start: 200, strand: 1 as const }
    const settings = { maxMismatches: 3, alternativePams: false, maxHits: 1000 }
    const plain = findOffTargets(spacer, builtInNuclease('spcas9')!, [
      { id: 't', name: 't', bases, topology: 'linear', source: 'document' },
    ], { ...settings, bulges: false }, own)
    const bulged = findOffTargets(spacer, builtInNuclease('spcas9')!, [
      { id: 't', name: 't', bases, topology: 'linear', source: 'document' },
    ], { ...settings, bulges: true }, own)
    expect(plain.hits).toHaveLength(0)
    expect(plain.specificity).toBe(100)
    expect(bulged.hits).toHaveLength(0)
    expect(bulged.specificity).toBe(100)
  })
})

describe('the hit cap', () => {
  // DEFAULT_MAX_SITES and maxHits both stop a runaway search. What matters is
  // that stopping does not quietly change the answer for the hits that were
  // kept, and that the report says it stopped.
  const crowded = brute.cases.find(c => c.name === 'spcas9-ng dinucleotide')!

  it('says so when it stops early', () => {
    const report = findOffTargets(crowded.spacer, nucleaseOf(crowded), [target(crowded)], {
      maxMismatches: crowded.maxMismatches,
      bulges: false,
      alternativePams: false,
      maxHits: 25,
    })
    expect(report.truncated).toBe(true)
    expect(report.hits.length).toBe(25)
  })

  it('keeps the worst hits, not the first ones, when it reports fewer', () => {
    // The site that matters is the one most likely to be cut, and it can be
    // anywhere. A cap that keeps whatever it met first drops it and reports a
    // better specificity than the truth.
    const spacer = 'ACGTACGTACGTACGTACGT'
    const tolerated = 'TTTTACGTACGTACGTACGT' // four changes at the far end
    let bases = 'A'.repeat(1200)
    for (let i = 0; i < 20; i++) {
      const at = 50 + i * 40
      bases = bases.slice(0, at) + tolerated + 'AGG' + bases.slice(at + 23)
    }
    bases = bases.slice(0, 1100) + spacer + 'AGG' + bases.slice(1123)
    const only = [{ id: 't', name: 't', bases, topology: 'linear' as const, source: 'document' as const }]
    const settings = { maxMismatches: 4, bulges: false, alternativePams: false }
    const all = findOffTargets(spacer, builtInNuclease('spcas9')!, only, { ...settings, maxHits: 10000 })
    const capped = findOffTargets(spacer, builtInNuclease('spcas9')!, only, { ...settings, maxHits: 10 })
    expect(all.hits[0].mismatches).toBe(0)
    expect(capped.truncated).toBe(true)
    expect(capped.hits).toHaveLength(10)
    expect(capped.hits[0].mismatches).toBe(0)
    // The score is taken from every hit found, so capping the list does not
    // move it.
    expect(capped.specificity).toBe(all.specificity)
  })

  it('names only the targets it actually searched', () => {
    // The second target holds the only perfect match. A search that stopped
    // at the cap would never reach it, and would still have named the target
    // as one it searched.
    const spacer = 'ACGTACGTACGTACGTACGT'
    const weaker = 'TTGTACGTACGTACGTACGT'
    let a = 'A'.repeat(600)
    for (let i = 0; i < 20; i++) {
      const at = 20 + i * 25
      a = a.slice(0, at) + weaker + 'AGG' + a.slice(at + 23)
    }
    const b = 'G'.repeat(400) + spacer + 'AGG' + 'G'.repeat(100)
    const report = findOffTargets(spacer, builtInNuclease('spcas9')!, [
      { id: 'a', name: 'A', bases: a, topology: 'linear', source: 'document' },
      { id: 'b', name: 'B', bases: b, topology: 'linear', source: 'document' },
    ], { maxMismatches: 3, bulges: false, alternativePams: false, maxHits: 5 })
    expect(report.searched.map(s => s.name)).toEqual(['A', 'B'])
    expect(report.truncated).toBe(true)
    expect(report.hits[0].targetId).toBe('b')
    expect(report.hits[0].mismatches).toBe(0)
  })

  it('searches both strands before the site cap stops it', () => {
    // A cap reached on the sense strand must not hide every antisense site:
    // that turns a truncated list into a biased one.
    const seq = brute.cases.find(c => c.name === 'spcas9 tandem')!.sequence
    for (const maxSites of [3, 5, 10, 30]) {
      const scan = findGuideSites(seq, builtInNuclease('spcas9')!, 'linear', { maxSites })
      expect(scan.truncated).toBe(true)
      expect(new Set(scan.sites.map(s => s.strand)), `cap ${maxSites}`).toEqual(new Set([1, -1]))
    }
  })
})

describe('cut geometry', () => {
  // Jinek 2012 and Cong 2013: SpCas9 cuts both strands between the 17th and
  // 18th base of a 20mer protospacer, three bases from the PAM. Zetsche 2015
  // figure 4: Cas12a leaves a 5 nt 5' overhang, cutting the PAM-bearing
  // strand after the 18th base and the other after the 23rd.
  it('puts the SpCas9 cut three bases from the PAM on both strands', () => {
    const spacer = 'ACGTACGTACGTACGTACGT'
    const bases = 'TTTTTTTTTT' + spacer + 'AGG' + 'TTTTTTTTTT'
    const scan = findGuideSites(bases, builtInNuclease('spcas9')!, 'linear')
    const site = scan.sites.find(s => s.spacer === spacer)!
    expect(site.start).toBe(10)
    expect(site.end).toBe(30)
    expect(site.pamStart).toBe(30)
    expect(site.pam).toBe('AGG')
    expect(site.strand).toBe(1)
    expect(site.cutTop).toBe(27)
    expect(site.cutBottom).toBe(27)
    expect(cutPosition(site, bases.length, false)).toBe(27)
  })

  it('mirrors the cut for a site on the antisense strand', () => {
    const spacer = 'ACGTACGTACGTACGTACGT'
    const bases = 'TTTTTTTTTT' + 'CCT' + reverse(spacer) + 'TTTTTTTTTT'
    const scan = findGuideSites(bases, builtInNuclease('spcas9')!, 'linear')
    const site = scan.sites.find(s => s.strand === -1 && s.pam === 'AGG')!
    expect(site.pamStart).toBe(10)
    expect(site.start).toBe(13)
    expect(site.cutTop).toBe(16)
    expect(site.cutBottom).toBe(16)
  })

  it('staggers the Cas12a cut by five bases, well away from the PAM', () => {
    const spacer = 'ACGTACGTACGTACGTACGTACG'
    const bases = 'AAAAAAAAAA' + 'TTTA' + spacer + 'AAAAAAAAAA'
    const scan = findGuideSites(bases, builtInNuclease('ascas12a')!, 'linear')
    const site = scan.sites.find(s => s.spacer === spacer)!
    expect(site.pamStart).toBe(10)
    expect(site.start).toBe(14)
    // Counted from the PAM edge of the protospacer: 18 on the strand the
    // protospacer reads on, 23 on the other.
    expect(site.cutTop).toBe(14 + 18)
    expect(site.cutBottom).toBe(14 + 23)
    expect(site.cutBottom - site.cutTop).toBe(5)
  })

  it('wraps a site and its cut across the origin of a circle', () => {
    const spacer = 'ACGTACGTACGTACGTACGT'
    // The protospacer starts five bases before the origin, so the PAM and the
    // cut both fall after it.
    const bases = spacer.slice(15) + 'AGG' + 'T'.repeat(200) + spacer.slice(0, 15)
    const scan = findGuideSites(bases, builtInNuclease('spcas9')!, 'circular')
    const site = scan.sites.find(s => s.spacer === spacer)!
    expect(site.start).toBe(bases.length - 15)
    expect(site.end).toBe(5)
    expect(site.pamStart).toBe(5)
    expect(site.cutTop).toBe(2)
    expect(site.offEnd).toBeUndefined()
  })
})

function reverse(s: string): string {
  const comp: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' }
  return [...s].reverse().map(c => comp[c]).join('')
}

// ---------------------------------------------------------------------------
// Published scoring models
// ---------------------------------------------------------------------------

interface GuideSeqGuide {
  onTarget: string
  mitGuideScore: number
  sites: {
    seq: string
    guideSeqShare: number
    mismatches: number
    pam: string
    cfd: number
    mitHitScore: number
  }[]
}

const guideseq = fixture<Record<string, GuideSeqGuide>>('guideseq-validated.json')

/** Spearman rank correlation, with average ranks for ties. */
function spearman(a: readonly number[], b: readonly number[]): number {
  const rank = (xs: readonly number[]): number[] => {
    const order = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0])
    const out = new Array<number>(xs.length)
    let i = 0
    while (i < order.length) {
      let j = i
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++
      const mean = (i + j) / 2 + 1
      for (let k = i; k <= j; k++) out[order[k][1]] = mean
      i = j + 1
    }
    return out
  }
  const ra = rank(a)
  const rb = rank(b)
  const n = a.length
  const mean = (n + 1) / 2
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    num += (ra[i] - mean) * (rb[i] - mean)
    da += (ra[i] - mean) ** 2
    db += (rb[i] - mean) ** 2
  }
  return num / Math.sqrt(da * db)
}

/** The app's own per-site score for a validated off-target of SpCas9. */
function appScore(
  onTarget: string,
  site: GuideSeqGuide['sites'][number],
  model: 'cfd' | 'position' = 'position',
): number {
  const spacer = onTarget.slice(0, 20)
  const mismatches = []
  for (let i = 0; i < 20; i++) {
    if (spacer[i] !== site.seq[i]) {
      mismatches.push({ position: i, spacerBase: spacer[i], targetBase: site.seq[i] })
    }
  }
  const pam = site.pam.toUpperCase()
  // Under the position model a weaker PAM carries the activity its nuclease
  // row lists; under CFD the model's own PAM table is used.
  const activity = /^[ACGT]GG$/.test(pam)
    ? 1
    : (builtInNuclease('spcas9')!.altPams ?? []).find(a => a.pam.slice(1) === pam.slice(1))?.activity
      ?? ALTERNATIVE_PAM_FACTOR
  return hitScore(mismatches, 20, 'threePrime', pam, activity, false, model)
}

describe('GUIDE-seq validated off-targets (Tsai et al. 2015)', () => {
  // The three guides the audit names. `guideSeqShare` is the share of
  // GUIDE-seq reads at that site, so it is the measurement a specificity
  // model is trying to rank.
  const names = ['EMX1', 'VEGFA site 3', 'HEK293 site 4']

  it('has the published tables', () => {
    for (const name of names) {
      expect(guideseq[name].onTarget).toHaveLength(23)
      expect(guideseq[name].sites.length).toBeGreaterThan(10)
    }
    expect(guideseq['EMX1'].sites).toHaveLength(15)
    expect(guideseq['VEGFA site 3'].sites).toHaveLength(59)
    expect(guideseq['HEK293 site 4'].sites).toHaveLength(133)
  })

  it('records how many validated sites the default search can reach', () => {
    // A site is out of reach when it needs more mismatches than the default
    // budget, or sits at a PAM the nuclease row does not list. Both are
    // settings rather than bugs, but the number is the honest answer to
    // "would this guide have looked clean".
    const reach = (name: string, maxMm: number, pams: RegExp) => {
      const g = guideseq[name]
      return g.sites.filter(s => s.mismatches <= maxMm && pams.test(s.pam)).length
    }
    const ngg = /^[ACGT]GG$/
    const weaker = /^[ACGT](GG|AG|CG|GA|TG|GC|GT)$/
    const summary = names.map(name => ({
      guide: name,
      validated: guideseq[name].sites.length,
      defaults: reach(name, DEFAULT_OFFTARGET.maxMismatches, ngg),
      defaultsWithWeakerPams: reach(name, DEFAULT_OFFTARGET.maxMismatches, weaker),
      sixMismatchesWeakerPams: reach(name, 6, weaker),
    }))
    // How much of what GUIDE-seq confirmed the search can see. The default
    // budget of four mismatches and the full list of weaker PAMs are what
    // move these numbers; at three mismatches and NGG alone the three guides
    // together reached 95 of 207.
    expect(summary).toEqual([
      { guide: 'EMX1', validated: 15, defaults: 10, defaultsWithWeakerPams: 15, sixMismatchesWeakerPams: 15 },
      { guide: 'VEGFA site 3', validated: 59, defaults: 45, defaultsWithWeakerPams: 58, sixMismatchesWeakerPams: 59 },
      { guide: 'HEK293 site 4', validated: 133, defaults: 98, defaultsWithWeakerPams: 118, sixMismatchesWeakerPams: 131 },
    ])
    const total = summary.reduce((n, s) => n + s.validated, 0)
    expect(summary.reduce((n, s) => n + s.defaults, 0) / total).toBeGreaterThan(0.7)
    expect(summary.reduce((n, s) => n + s.sixMismatchesWeakerPams, 0) / total).toBeGreaterThan(0.98)
  })

  it('ships the authors’ own tables, to the digit', () => {
    // The module's copy against the one the oracle read from the authors'
    // files. Six decimals is what the shipped literal carries.
    const tables = fixture<{
      mismatch: Record<string, number>
      pam: Record<string, number>
    }>('cfd-tables.json')
    let checked = 0
    for (const [key, value] of Object.entries(tables.mismatch)) {
      const [pairing, column] = key.split(',')
      const [guide, target] = pairing.split(':')
      // The table is keyed by the guide base as RNA against the complement
      // of the target base, so the lookup is given the base it would meet.
      const targetBase = { dA: 'T', dC: 'G', dG: 'C', dT: 'A' }[target]!
      const spacerBase = guide.slice(1) === 'U' ? 'T' : guide.slice(1)
      expect(cfdMismatchFactor(Number(column), spacerBase, targetBase), key)
        .toBeCloseTo(value, 6)
      checked++
    }
    expect(checked).toBe(240)
    for (const [pam, value] of Object.entries(tables.pam)) {
      expect(cfdPamActivity(`A${pam}`), pam).toBeCloseTo(value, 6)
    }
  })

  it('computes CFD exactly as the authors’ own calculator does', () => {
    // Every validated site, scored by the app's CFD path against the oracle's
    // run of cfd-score-calculator.py over the authors' two tables. This is an
    // agreement test, not a characterisation: a difference is a bug.
    const worst = { site: '', app: 0, oracle: 0, delta: 0 }
    let n = 0
    for (const name of names) {
      for (const site of guideseq[name].sites) {
        const mine = appScore(guideseq[name].onTarget, site, 'cfd')
        const delta = Math.abs(mine - site.cfd)
        if (delta > worst.delta) Object.assign(worst, { site: site.seq, app: mine, oracle: site.cfd, delta })
        n++
      }
    }
    expect(n).toBe(207)
    // The shipped table is rounded to six decimals, so the product of up to
    // six factors can differ in the seventh.
    expect(worst.delta).toBeLessThan(1e-6)
  })

  it('reaches every validated site once the weaker PAMs are searched', () => {
    // The nuclease row now lists the PAMs the model scores above zero, so the
    // only sites out of reach are the ones at a PAM never seen cut.
    const reachable = /^[ACGT](GG|AG|CG|GA|TG|GC|GT)$/
    const out = names.flatMap(name =>
      guideseq[name].sites.filter(s => !reachable.test(s.pam.toUpperCase())))
    expect(out.map(s => s.pam).sort()).toEqual(['CAA', 'GAA'])
    for (const site of out) expect(site.cfd).toBe(0)
  })

  it('ranks validated sites about as well as the published models', () => {
    // Spearman against the measured read share, over the validated sites of
    // each guide. CFD and MIT are the published models; `app` is the
    // position-only model in offtarget.ts.
    const rho = (name: string) => {
      const sites = guideseq[name].sites
      const measured = sites.map(s => s.guideSeqShare)
      return {
        cfd: spearman(measured, sites.map(s => s.cfd)),
        mit: spearman(measured, sites.map(s => s.mitHitScore)),
        app: spearman(measured, sites.map(s => appScore(guideseq[name].onTarget, s))),
      }
    }
    const emx1 = rho('EMX1')
    const vegfa = rho('VEGFA site 3')
    const hek = rho('HEK293 site 4')
    // Recorded, and not what a reviewer would guess: over the sites GUIDE-seq
    // confirmed, ranking by the app's position-only score is as good as CFD
    // on all three guides, and better on the two with enough sites to mean
    // anything. MIT wins EMX1, where there are only 15 sites.
    expect(emx1.app).toBeGreaterThan(0.2)
    expect(vegfa.app).toBeGreaterThan(0.55)
    expect(hek.app).toBeGreaterThan(0.4)
    expect(vegfa.app).toBeGreaterThan(vegfa.cfd)
    expect(hek.app).toBeGreaterThan(hek.cfd)
    expect(emx1.mit).toBeGreaterThan(emx1.app)
    // What this does not say: these are ranks among sites already known to be
    // cut, so it measures ordering and not whether a site is cut at all. The
    // reach test above is the other half of the picture, and it is the weak
    // one.
    expect(hek.cfd).toBeGreaterThan(0.3)
  })

  it('agrees with the MIT aggregate formula once per-site scores are given', () => {
    // specificity() is 100 / (1 + sum of site scores), which is exactly
    // calcMitGuideScore's 100 * 100 / (100 + sum) with site scores in
    // percent. The aggregation is the published one; only the per-site model
    // underneath it differs.
    for (const name of names) {
      const g = guideseq[name]
      const hits = g.sites.map(s => ({ score: s.mitHitScore / 100 })) as OffTargetHit[]
      expect(specificity(hits)).toBeCloseTo(g.mitGuideScore, 1)
    }
  })
})

describe('microhomology against Bae et al. 2014', () => {
  interface BaeCase {
    name: string
    sequence: string
    cut: number
    window: number
    microhomologyScore: number
    outOfFrame: number
  }
  const cases = fixture<BaeCase[]>('bae-microhomology.json')

  it('weights every pattern the way the paper writes it', () => {
    // 100 * exp(-deletion / 20) * (length + GC count), checked on each
    // pattern the module reports rather than on one chosen in advance, since
    // which patterns survive is the reference's containment rule, tested
    // above.
    const mh = 'ACGC'
    const seq = 'T'.repeat(20) + mh + 'A'.repeat(8) + mh + 'T'.repeat(20)
    const cut = 20 + mh.length + 4
    const result = microhomologyOutcome(seq, cut, 'linear', { window: 20, minLength: 4 })
    expect(result!.patterns.length).toBeGreaterThan(0)
    for (const p of result!.patterns) {
      const gc = [...p.microhomology].filter(b => b === 'G' || b === 'C').length
      expect(p.patternScore, p.microhomology).toBeCloseTo(
        100 * Math.exp(-p.deletionLength / 20) * (p.microhomology.length + gc), 6)
      expect(p.frameshift).toBe(p.deletionLength % 3 !== 0)
    }
  })

  it('gives the reference implementation’s own numbers', () => {
    // Both scores, over every window in the fixture, at the window the
    // reference was run with. This is agreement, not a characterisation: the
    // enumeration, the containment rule and the weighting all have to match
    // for these to land on the same number.
    let compared = 0
    for (const c of cases) {
      const got = microhomologyOutcome(c.sequence, c.cut, 'linear', {
        window: c.window,
        maxDeletion: 2 * c.window - 1,
      })
      if (c.microhomologyScore === 0) {
        expect(got === null || got.totalScore === 0, c.name).toBe(true)
        continue
      }
      expect(got, c.name).not.toBeNull()
      expect(got!.totalScore, `${c.name} microhomology score`).toBeCloseTo(c.microhomologyScore, 6)
      expect(got!.outOfFrame, `${c.name} out of frame`).toBeCloseTo(c.outOfFrame, 6)
      compared++
    }
    expect(compared).toBeGreaterThan(20)
  })

  it('uses the reference’s own window and minimum length by default', () => {
    expect(DEFAULT_WINDOW).toBe(30)
    expect(DEFAULT_MIN_LENGTH).toBe(2)
    const c = cases.find(x => x.window === 30 && x.microhomologyScore > 0)!
    const byDefault = microhomologyOutcome(c.sequence, c.cut, 'linear')
    expect(byDefault!.outOfFrame).toBeCloseTo(c.outOfFrame, 6)
  })
})
