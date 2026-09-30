import { describe, it, expect } from 'vitest'
import { bandSigmaMm, groupBands, layoutGel, placeSpecies, bandLabelBp, DEFAULT_BAND_OPTIONS } from './bands'
import { DEFAULT_CONDITIONS, type GelSetup } from './model'
import type { SequenceSource } from './simulate'

const opts = DEFAULT_BAND_OPTIONS
const c = DEFAULT_CONDITIONS
const place = (bp: number, ng: number) => placeSpecies({ bp, form: 'linear', ng }, c, opts)

describe('band geometry', () => {
  it('thickens heavily loaded bands when mass thickness is on', () => {
    const light = bandSigmaMm(3000, 20, 20, opts)
    const heavy = bandSigmaMm(3000, 20, 800, opts)
    expect(heavy).toBeGreaterThan(light * 1.5)
  })

  it('draws every band alike when mass thickness is off', () => {
    const off = { ...opts, massThickness: false }
    expect(bandSigmaMm(3000, 20, 20, off)).toBeCloseTo(bandSigmaMm(3000, 20, 800, off), 10)
  })

  it('lets small fragments diffuse more', () => {
    expect(bandSigmaMm(100, 40, 50, opts)).toBeGreaterThan(bandSigmaMm(5000, 40, 50, opts))
  })
})

describe('groupBands', () => {
  it('merges fragments the gel cannot separate', () => {
    const bands = groupBands([place(3000, 50), place(2970, 50), place(1000, 50)], opts)
    expect(bands).toHaveLength(2)
    expect(bands[0].members.map(m => m.bp)).toEqual([3000, 2970])
    expect(bands[0].ng).toBeCloseTo(100, 6)
  })

  it('keeps well-separated fragments apart, top first', () => {
    const bands = groupBands([place(500, 50), place(5000, 50)], opts)
    expect(bands.map(b => bandLabelBp(b))).toEqual([5000, 500])
  })

  it('stacks identical fragments into one brighter band', () => {
    const bands = groupBands([place(1500, 40), place(1500, 40)], opts)
    expect(bands).toHaveLength(1)
    expect(bands[0].ng).toBeCloseTo(80, 6)
    expect(bandLabelBp(bands[0])).toBe(1500)
  })

  it('marks bands below the detection limit invisible', () => {
    const bands = groupBands([place(100, 0.5), place(5000, 100)], opts)
    expect(bands.find(b => b.members[0].bp === 100)!.visible).toBe(false)
    expect(bands.find(b => b.members[0].bp === 5000)!.visible).toBe(true)
  })
})

describe('layoutGel', () => {
  const fill = (n: number) => 'ACGT'.repeat(Math.ceil(n / 4)).slice(0, n)
  const sources: Record<string, SequenceSource> = {
    p: { name: 'p', bases: fill(1000) + 'GAATTC' + fill(1994), topology: 'circular' },
    tiny: { name: 'tiny', bases: fill(40), topology: 'linear' },
  }
  const resolve = (id: string) => sources[id] ?? null

  it('lays out every lane in order, with uncut plasmid showing its forms', () => {
    const setup: GelSetup = {
      conditions: c,
      lanes: [
        { id: 'a', sample: { kind: 'ladder', ladderId: '1kb' } },
        { id: 'b', sample: { kind: 'sequence', sourceId: 'p', enzymes: [], ng: 500 } },
        { id: 'c', sample: { kind: 'sequence', sourceId: 'p', enzymes: ['EcoRI'], ng: 500 } },
        { id: 'd', sample: { kind: 'empty' } },
      ],
    }
    const layout = layoutGel(setup, resolve)
    expect(layout.lanes.map(l => l.laneId)).toEqual(['a', 'b', 'c', 'd'])
    expect(layout.lanes[1].bands).toHaveLength(3)
    expect(layout.lanes[2].bands).toHaveLength(1)
    expect(layout.lanes[3].bands).toHaveLength(0)
    expect(layout.dyeFronts).toHaveLength(2)
  })

  it('reports fragments that ran off the gel', () => {
    const setup: GelSetup = {
      conditions: { ...c, dyeFront: 1, agarosePct: 0.7 },
      lanes: [{ id: 'a', sample: { kind: 'sequence', sourceId: 'tiny', enzymes: [], ng: 100 } }],
    }
    const lane = layoutGel(setup, resolve).lanes[0]
    expect(lane.bands).toHaveLength(0)
    expect(lane.ranOff.map(s => s.bp)).toEqual([40])
  })
})
