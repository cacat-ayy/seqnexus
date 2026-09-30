import { describe, it, expect } from 'vitest'
import { primerItems, templatePosOf, summarizeOligo, isPrimerItemId, flankingPrimers, oligoStructure } from './display'
import type { BindingSite } from './binding'
import type { PrimerData } from './oligo'

const primer = (over: Partial<PrimerData> = {}): PrimerData =>
  ({ id: 'p1', name: 'P1', sequence: 'GAATTCACGTACGTACGTACGTAC', role: 'primer', ...over })

const site = (over: Partial<BindingSite>): BindingSite => ({
  primerId: 'p1', start: 100, end: 118, strand: 1,
  annealFrom: 6, annealTo: 24, tail5: 'GAATTC', tail3: '', mismatches: [],
  ...over,
})

const itemsFor = (s: BindingSite, seqLen = 1000) =>
  primerItems([primer()], new Map([['p1', [s]]]), seqLen)

describe('primerItems', () => {
  it('extends a forward primer\'s footprint left by its 5\' tail', () => {
    const [item] = itemsFor(site({}))
    expect(item.annotation).toMatchObject({ start: 94, end: 118, strand: 1 })
    expect(isPrimerItemId(item.annotation.id)).toBe(true)
  })

  it('extends a reverse primer\'s footprint right, where its 5\' end points', () => {
    const [item] = itemsFor(site({ strand: -1 }))
    expect(item.annotation).toMatchObject({ start: 100, end: 124, strand: -1 })
  })

  it('clamps a tail at the start of the sequence rather than wrapping it', () => {
    const [item] = itemsFor(site({ start: 2, end: 20 }))
    expect(item.annotation.start).toBe(0)
  })

  it('draws an origin-spanning site without its tails', () => {
    const [item] = itemsFor(site({ start: 990, end: 8 }))
    expect(item.annotation).toMatchObject({ start: 990, end: 8 })
  })

  it('gives each site of a primer its own item', () => {
    const items = primerItems([primer()], new Map([['p1', [site({}), site({ start: 500, end: 518 })]]]), 1000)
    expect(new Set(items.map(i => i.annotation.id)).size).toBe(2)
  })
})

describe('templatePosOf', () => {
  it('walks right along the top strand for a forward site', () => {
    expect(templatePosOf(site({}), 6, 1000)).toBe(100)
    expect(templatePosOf(site({}), 10, 1000)).toBe(104)
  })

  it('walks left for a reverse site, starting from its last base', () => {
    const rev = site({ strand: -1 })
    expect(templatePosOf(rev, 6, 1000)).toBe(117)
    expect(templatePosOf(rev, 23, 1000)).toBe(100)
  })
})

describe('summarizeOligo', () => {
  it('gives a tailed primer a lower annealed Tm than its full Tm', () => {
    const s = summarizeOligo(primer(), site({}))
    expect(s.tmAnneal).not.toBeNull()
    expect(s.tmAnneal!).toBeLessThan(s.tmFull)
  })

  it('has no annealed Tm when the primer binds nowhere', () => {
    expect(summarizeOligo(primer(), null).tmAnneal).toBeNull()
  })
})

describe('flankingPrimers', () => {
  const oligo = (id: string, role: PrimerData['role'] = 'primer') => primer({ id, name: id, role })
  const at = (id: string, start: number, end: number, strand: 1 | -1): BindingSite =>
    site({ primerId: id, start, end, strand, annealFrom: 0, annealTo: end - start, tail5: '' })
  const build = (seqLen: number, entries: [PrimerData, BindingSite][]) =>
    primerItems(entries.map(([p]) => p), new Map(entries.map(([p, s]) => [p.id, [s]])), seqLen)

  it('finds the nearest forward primer before a probe and reverse primer after it', () => {
    const items = build(1000, [
      [oligo('farF'), at('farF', 10, 30, 1)],
      [oligo('F'), at('F', 100, 120, 1)],
      [oligo('probe', 'probe'), at('probe', 140, 165, 1)],
      [oligo('R'), at('R', 200, 220, -1)],
      [oligo('farR'), at('farR', 400, 420, -1)],
    ])
    const probe = items.find(i => i.primer.id === 'probe')!
    const pair = flankingPrimers(probe, items, 1000, false)!
    expect(pair.fwd.primer.id).toBe('F')
    expect(pair.rev.primer.id).toBe('R')
  })

  it('wraps the origin only on a circle, and gives up past the span limit', () => {
    const items = build(1000, [
      [oligo('F'), at('F', 950, 970, 1)],
      [oligo('probe', 'probe'), at('probe', 10, 35, 1)],
      [oligo('R'), at('R', 60, 80, -1)],
    ])
    const probe = items.find(i => i.primer.id === 'probe')!
    expect(flankingPrimers(probe, items, 1000, true)?.fwd.primer.id).toBe('F')
    expect(flankingPrimers(probe, items, 1000, false)).toBeNull()
    expect(flankingPrimers(probe, items, 1000, true, 50)).toBeNull()
  })
})

describe('oligoStructure', () => {
  it('returns the same analysis for the same oligo, whatever its case', () => {
    expect(oligoStructure('ggatccGCGGCCGCGGATCC')).toBe(oligoStructure('GGATCCGCGGCCGCGGATCC'))
    expect(oligoStructure('GGATCCGCGGCCGCGGATCC').hairpin?.stem).toBe(8)
  })
})
