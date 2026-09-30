import { describe, it, expect } from 'vitest'
import { getEnzyme } from '../enzymes/db'
import { simulateLane, simulateLadder, simulateSequence, type SequenceSource } from './simulate'
import { LADDERS, getLadder } from './ladders'

const EcoRI = getEnzyme('EcoRI')!
const XbaI = getEnzyme('XbaI')!

/** Filler with no EcoRI, XbaI or GATC sites. */
const fill = (n: number) => 'ACGT'.repeat(Math.ceil(n / 4)).slice(0, n)

function source(bases: string, topology: 'linear' | 'circular', extra: Partial<SequenceSource> = {}): SequenceSource {
  return { name: 'test', bases, topology, ...extra }
}

describe('simulateSequence', () => {
  it('runs uncut linear DNA as one species carrying the full load', () => {
    const sim = simulateSequence(source(fill(3000), 'linear'), [], { ng: 400 })
    expect(sim.species).toEqual([{ bp: 3000, form: 'linear', ng: 400 }])
  })

  it('splits uncut circular DNA into supercoiled, nicked and linear forms', () => {
    const sim = simulateSequence(source(fill(3000), 'circular'), [], { ng: 100 })
    expect(sim.species.map(s => s.form)).toEqual(['supercoiled', 'nicked', 'linear'])
    expect(sim.species.every(s => s.bp === 3000)).toBe(true)
    expect(sim.species.reduce((a, s) => a + s.ng, 0)).toBeCloseTo(100, 6)
    expect(sim.species[0].ng).toBeGreaterThan(sim.species[1].ng)
  })

  it('honours a custom form mix', () => {
    const sim = simulateSequence(source(fill(3000), 'circular'), [], {
      ng: 100, forms: { supercoiled: 1, nicked: 0, linear: 0 },
    })
    expect(sim.species).toEqual([{ bp: 3000, form: 'supercoiled', ng: 100 }])
  })

  it('linearises a circle cut once', () => {
    const bases = fill(1000) + 'GAATTC' + fill(1994)
    const sim = simulateSequence(source(bases, 'circular'), [EcoRI], { ng: 300 })
    expect(sim.species).toHaveLength(1)
    expect(sim.species[0]).toMatchObject({ bp: 3000, form: 'linear', ng: 300 })
    expect(sim.species[0].fragment).toMatchObject({ leftEnzyme: 'EcoRI', rightEnzyme: 'EcoRI' })
  })

  it('cuts a circle into as many fragments as cuts, splitting mass by length', () => {
    const bases = fill(500) + 'GAATTC' + fill(994) + 'GAATTC' + fill(1494)
    const sim = simulateSequence(source(bases, 'circular'), [EcoRI], { ng: 300 })
    const sizes = sim.species.map(s => s.bp).sort((a, b) => b - a)
    expect(sizes).toEqual([2000, 1000])
    const big = sim.species.find(s => s.bp === 2000)!
    expect(big.ng).toBeCloseTo(200, 6)
    // The larger fragment wraps the origin.
    expect(big.fragment!.end).toBeLessThan(big.fragment!.start)
  })

  it('cuts a linear molecule into cuts + 1 fragments with sequence ends marked', () => {
    const bases = fill(400) + 'GAATTC' + fill(594)
    const sim = simulateSequence(source(bases, 'linear'), [EcoRI], { ng: 100 })
    expect(sim.species.map(s => s.bp)).toEqual([401, 599])
    expect(sim.species[0].fragment).toMatchObject({ start: 0, end: 401, leftEnzyme: null, rightEnzyme: 'EcoRI' })
    expect(sim.species[1].fragment).toMatchObject({ leftEnzyme: 'EcoRI', rightEnzyme: null })
  })

  it('warns about enzymes that do not cut and runs the sample uncut', () => {
    const sim = simulateSequence(source(fill(3000), 'circular'), [EcoRI], { ng: 100 })
    expect(sim.warnings).toContain('EcoRI does not cut test')
    expect(sim.species[0].form).toBe('supercoiled')
  })

  it('skips sites blocked by dam methylation', () => {
    // TCTAGATC: an XbaI site overlapping a dam GATC motif.
    const bases = fill(1000) + 'TCTAGATC' + fill(1992)
    const unmethylated = simulateSequence(source(bases, 'circular'), [XbaI], { ng: 100 })
    expect(unmethylated.species).toHaveLength(1)
    expect(unmethylated.species[0].form).toBe('linear')

    const methylated = simulateSequence(source(bases, 'circular', { damMethylated: true }), [XbaI], { ng: 100 })
    expect(methylated.species[0].form).toBe('supercoiled')
    expect(methylated.warnings.some(w => w.includes('blocked by methylation'))).toBe(true)
  })
})

describe('simulateLane', () => {
  const resolve = (id: string) => (id === 'seq1' ? source(fill(2000), 'linear') : null)

  it('returns nothing for an empty well', () => {
    expect(simulateLane({ kind: 'empty' }, resolve).species).toEqual([])
  })

  it('reports a missing source', () => {
    const sim = simulateLane({ kind: 'sequence', sourceId: 'gone', enzymes: [], ng: 100 }, resolve)
    expect(sim.species).toEqual([])
    expect(sim.warnings[0]).toMatch(/no longer available/)
  })

  it('reports unknown enzymes but still runs the known ones', () => {
    const sim = simulateLane({ kind: 'sequence', sourceId: 'seq1', enzymes: ['NotAnEnzyme'], ng: 100 }, resolve)
    expect(sim.warnings[0]).toBe('Unknown enzyme "NotAnEnzyme"')
    expect(sim.species).toHaveLength(1)
  })

  it('scales a ladder to the loaded mass', () => {
    const sim = simulateLane({ kind: 'ladder', ladderId: '1kb', ng: 250 }, resolve)
    expect(sim.totalNg).toBeCloseTo(250, 6)
    expect(sim.species.reduce((a, s) => a + s.ng, 0)).toBeCloseTo(250, 6)
  })
})

describe('ladders', () => {
  it('every ladder sums to its nominal load and lists sizes descending', () => {
    for (const l of LADDERS) {
      expect(l.bands.reduce((a, b) => a + b.ng, 0)).toBeCloseTo(l.totalNg, 6)
      for (let i = 1; i < l.bands.length; i++) expect(l.bands[i].bp).toBeLessThan(l.bands[i - 1].bp)
    }
  })

  it('makes reference bands brighter', () => {
    const sim = simulateLadder(getLadder('1kb')!)
    const ref = sim.species.find(s => s.bp === 3000)!
    const other = sim.species.find(s => s.bp === 4000)!
    expect(ref.reference).toBe(true)
    expect(ref.ng).toBeGreaterThan(other.ng * 2)
  })

  it('gives lambda/HindIII equimolar bands, mass proportional to size', () => {
    const l = getLadder('lambda-hindiii')!
    const [a, b] = [l.bands[0], l.bands[l.bands.length - 1]]
    expect(a.ng / b.ng).toBeCloseTo(a.bp / b.bp, 6)
  })

  it('finds ladders by their old display names', () => {
    expect(getLadder('1 kb DNA Ladder')?.id).toBe('1kb')
  })
})
