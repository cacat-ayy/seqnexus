import { describe, it, expect } from 'vitest'
import {
  KYTE_DOOLITTLE, HOPP_WOODS, EISENBERG, VIHINEN_FLEXIBILITY, PROTEIN_SCALES,
  proteinScale, residueValues, windowedProfile, scaleProfile, transmembraneSegments,
} from './scales'

const TWENTY = 'ACDEFGHIKLMNPQRSTVWY'

describe('residue scales', () => {
  it('every scale knows the twenty standard residues and nothing else', () => {
    for (const table of [KYTE_DOOLITTLE, HOPP_WOODS, EISENBERG, VIHINEN_FLEXIBILITY]) {
      expect(Object.keys(table).sort().join('')).toBe(TWENTY)
    }
  })

  it('lists every scale with an odd default window inside its range', () => {
    for (const s of PROTEIN_SCALES) {
      expect(s.window % 2).toBe(1)
      expect(s.mid).toBeGreaterThanOrEqual(s.min)
      expect(s.mid).toBeLessThanOrEqual(s.max)
      if (s.id !== 'charge') expect(s.table, s.id).toBeDefined()
      expect(() => residueValues('MKV', s)).not.toThrow()
    }
  })

  it('reads a residue value and marks unknown residues NaN', () => {
    const v = residueValues('IXR', proteinScale('kd'))
    expect(v[0]).toBe(4.5)
    expect(Number.isNaN(v[1])).toBe(true)
    expect(v[2]).toBe(-4.5)
  })

  it('charges side chains at pH 7: Lys about +1, Asp about -1, His a fraction, Gly zero', () => {
    const v = residueValues('KDHG', proteinScale('charge'))
    expect(v[0]).toBeCloseTo(1, 2)
    expect(v[1]).toBeCloseTo(-1, 2)
    expect(v[2]).toBeGreaterThan(0.1)
    expect(v[2]).toBeLessThan(0.5)
    expect(v[3]).toBe(0)
  })
})

describe('windowedProfile', () => {
  it('averages over a centred window, cut short at the ends', () => {
    const p = windowedProfile(new Float32Array([1, 2, 3, 4, 5]), 3)
    expect(Array.from(p)).toEqual([1.5, 2, 3, 4, 4.5])
  })

  it('leaves unknown residues out of the mean rather than counting them as zero', () => {
    const p = windowedProfile(new Float32Array([2, NaN, 4]), 3)
    expect(p[1]).toBe(3)
    expect(p[0]).toBe(2)
  })

  it('a window of one is the raw values', () => {
    const residues = 'MKV'
    const p = scaleProfile(residues, proteinScale('kd'), 1)
    expect(p[0]).toBeCloseTo(1.9, 5)
    expect(p[1]).toBeCloseTo(-3.9, 5)
    expect(p[2]).toBeCloseTo(4.2, 5)
  })
})

describe('transmembraneSegments', () => {
  it('finds a hydrophobic stretch of leucines flanked by charged residues', () => {
    const residues = 'MKKDEDRKSE' + 'LLIVAALVIGLLFVLAIVLL' + 'RKEDRKDEKR'
    const segs = transmembraneSegments(residues)
    expect(segs).toHaveLength(1)
    const [s, e] = segs[0]
    expect(s).toBeLessThanOrEqual(10)
    expect(e).toBeGreaterThanOrEqual(30)
    expect(e - s).toBeGreaterThanOrEqual(19)
  })

  it('finds nothing in a soluble, charged sequence', () => {
    expect(transmembraneSegments('MKDEKRSTNQDEKRGSTEDKRNQSDEKRTSQ')).toEqual([])
  })

  it('needs a whole window', () => {
    expect(transmembraneSegments('LLLLLLLLLL')).toEqual([])
  })
})
