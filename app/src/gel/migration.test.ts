import { describe, it, expect } from 'vitest'
import {
  migrationMm, relativeMobility, sizeAtMm, dyeFronts, resolutionRange, runLengthMm, ranOff, apparentSize,
} from './migration'
import { DEFAULT_CONDITIONS, type GelConditions } from './model'

const at = (patch: Partial<GelConditions>): GelConditions => ({ ...DEFAULT_CONDITIONS, ...patch })

describe('migration model', () => {
  it('runs smaller fragments further', () => {
    const sizes = [20000, 10000, 5000, 3000, 1000, 500, 250, 100]
    const mm = sizes.map(bp => migrationMm(bp, 'linear', DEFAULT_CONDITIONS))
    for (let i = 1; i < mm.length; i++) expect(mm[i]).toBeGreaterThan(mm[i - 1])
  })

  it('compresses large fragments near the wells', () => {
    const c = DEFAULT_CONDITIONS
    const gapLarge = migrationMm(20000, 'linear', c) - migrationMm(48000, 'linear', c)
    const gapMid = migrationMm(1000, 'linear', c) - migrationMm(2400, 'linear', c)
    // Both pairs differ ~2.4-fold in size; only the mid pair separates well.
    expect(gapMid).toBeGreaterThan(gapLarge * 3)
  })

  it('places the tracking dyes where loading-dye charts put them', () => {
    const [xc, bpb] = dyeFronts(at({ agarosePct: 1 }))
    expect(bpb.equivalentBp).toBeGreaterThan(250)
    expect(bpb.equivalentBp).toBeLessThan(500)
    expect(xc.equivalentBp).toBeGreaterThan(3000)
    expect(xc.equivalentBp).toBeLessThan(5500)
    const bpb2 = dyeFronts(at({ agarosePct: 2 }))[1]
    expect(bpb2.equivalentBp).toBeLessThan(150)
  })

  it('puts the bromophenol blue front at the chosen fraction of the run', () => {
    const c = at({ dyeFront: 0.6 })
    expect(dyeFronts(c)[1].mm).toBeCloseTo(0.6 * runLengthMm(c), 5)
  })

  it('denser gels shift the window to smaller sizes', () => {
    const [lo1, hi1] = resolutionRange(at({ agarosePct: 0.7 }))
    const [lo2, hi2] = resolutionRange(at({ agarosePct: 2 }))
    expect(lo2).toBeLessThan(lo1)
    expect(hi2).toBeLessThan(hi1)
  })

  it('TBE resolves small fragments better than TAE', () => {
    const spread = (c: GelConditions) => migrationMm(100, 'linear', c) - migrationMm(200, 'linear', c)
    // Same dye position, so compare how far apart 100 and 200 bp end up.
    expect(Math.abs(spread(at({ agarosePct: 2, buffer: 'TBE' }))))
      .toBeGreaterThan(Math.abs(spread(at({ agarosePct: 2, buffer: 'TAE' }))))
  })

  it('runs small fragments off a long run', () => {
    const c = at({ dyeFront: 1, agarosePct: 0.7 })
    expect(ranOff(migrationMm(100, 'linear', c), c)).toBe(true)
    expect(ranOff(migrationMm(5000, 'linear', c), c)).toBe(false)
  })

  it('supercoiled runs ahead of linear, nicked lags behind', () => {
    const c = DEFAULT_CONDITIONS
    const lin = migrationMm(3000, 'linear', c)
    expect(migrationMm(3000, 'supercoiled', c)).toBeGreaterThan(lin)
    expect(migrationMm(3000, 'nicked', c)).toBeLessThan(lin)
    expect(apparentSize(3000, 'linear', c)).toBe(3000)
  })

  it('sizeAtMm inverts migrationMm', () => {
    for (const bp of [150, 800, 3000, 9000]) {
      const mm = migrationMm(bp, 'linear', DEFAULT_CONDITIONS)
      expect(sizeAtMm(mm, DEFAULT_CONDITIONS)).toBeCloseTo(bp, 0)
    }
    expect(sizeAtMm(0, DEFAULT_CONDITIONS)).toBeNull()
  })

  it('clamps out-of-range agarose instead of failing', () => {
    expect(relativeMobility(1000, at({ agarosePct: 10 })))
      .toBeCloseTo(relativeMobility(1000, at({ agarosePct: 3 })), 10)
    expect(Number.isFinite(migrationMm(1000, 'linear', at({ agarosePct: NaN })))).toBe(true)
  })
})
