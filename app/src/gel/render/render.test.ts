import { describe, it, expect } from 'vitest'
import { layoutGel } from '../bands'
import { DEFAULT_CONDITIONS, type GelSetup, type LaneSample } from '../model'
import type { SequenceSource } from '../simulate'
import { buildScene, type GelScene } from './scene'
import { renderRaster, toneMap, NO_EFFECTS, type Raster } from './raster'
import { GEL_LOOKS, GEL_LOOK_ORDER, getLook, rampTable, rampColour } from './looks'
import { sceneToSvg } from './svg'

const fill = (n: number) => 'ACGT'.repeat(Math.ceil(n / 4)).slice(0, n)
const sources: Record<string, SequenceSource> = {
  lin: { name: 'lin', bases: fill(3000), topology: 'linear' },
  tiny: { name: 'tiny', bases: fill(30), topology: 'linear' },
}

function scene(samples: LaneSample[], opts: { width?: number; exposure?: number; conditions?: Partial<GelSetup['conditions']> } = {}): GelScene {
  const setup: GelSetup = {
    conditions: { ...DEFAULT_CONDITIONS, ...opts.conditions },
    lanes: samples.map((sample, i) => ({ id: String(i), sample })),
  }
  const layout = layoutGel(setup, id => sources[id] ?? null)
  return buildScene({
    width: opts.width ?? 400,
    height: 300,
    layout,
    lanes: samples.map((s, i) => ({ label: String(i + 1), isLadder: s.kind === 'ladder' })),
    exposure: opts.exposure ?? 0,
  })
}

const seq = (ng: number): LaneSample => ({ kind: 'sequence', sourceId: 'lin', enzymes: [], ng })
const pixel = (r: Raster, x: number, y: number) => {
  const o = (Math.round(y) * r.width + Math.round(x)) * 4
  return [r.data[o], r.data[o + 1], r.data[o + 2]]
}
const luma = (p: number[]) => p[0] + p[1] + p[2]

describe('toneMap', () => {
  it('rises monotonically and saturates below 1', () => {
    expect(toneMap(0, 0)).toBe(0)
    expect(toneMap(10, 0)).toBeLessThan(toneMap(40, 0))
    expect(toneMap(1e6, 0)).toBeCloseTo(1, 6)
  })

  it('brightens with exposure', () => {
    expect(toneMap(10, 1)).toBeGreaterThan(toneMap(10, 0))
    expect(toneMap(10, -1)).toBeLessThan(toneMap(10, 0))
  })
})

describe('looks', () => {
  it('every look has a ramp from 0 to 1', () => {
    for (const id of GEL_LOOK_ORDER) {
      const ramp = GEL_LOOKS[id].ramp
      expect(ramp[0][0]).toBe(0)
      expect(ramp[ramp.length - 1][0]).toBe(1)
    }
  })

  it('UV runs dark to white; inverted runs white to dark', () => {
    const uv = rampTable(GEL_LOOKS.uv)
    expect(uv[0]).toBeLessThan(30)
    expect(uv[255 * 3]).toBe(255)
    expect(rampColour(GEL_LOOKS.inverted, 0)).toBe('rgb(250,250,250)')
  })

  it('falls back to the default look for unknown ids', () => {
    expect(getLook('nope').id).toBe('uv')
  })
})

describe('buildScene', () => {
  it('keeps every lane inside the slab', () => {
    const s = scene([{ kind: 'ladder', ladderId: '1kb' }, seq(500), { kind: 'empty' }])
    for (const lane of s.lanes) {
      expect(lane.x).toBeGreaterThanOrEqual(s.slab.x)
      expect(lane.x + lane.w).toBeLessThanOrEqual(s.slab.x + s.slab.w + 1e-6)
    }
    expect(s.lanes.map(l => l.loaded)).toEqual([true, true, false])
  })

  it('labels the first ladder, thinning labels that would collide', () => {
    const s = scene([{ kind: 'ladder', ladderId: '1kb-extend' }])
    expect(s.sizeLabels.length).toBeGreaterThan(5)
    for (let i = 1; i < s.sizeLabels.length; i++) {
      expect(s.sizeLabels[i].y - s.sizeLabels[i - 1].y).toBeGreaterThanOrEqual(9)
    }
    // Reference band survives thinning.
    expect(s.sizeLabels.some(l => l.text === '3.0 kb')).toBe(true)
  })

  it('leaves out size labels without a ladder and leaves room for them with one', () => {
    expect(scene([seq(100)]).sizeLabels).toEqual([])
    expect(scene([{ kind: 'ladder', ladderId: '1kb' }]).slab.x).toBeGreaterThan(scene([seq(100)]).slab.x)
  })

  it('flags lanes that lost fragments off the bottom', () => {
    const s = scene([{ kind: 'sequence', sourceId: 'tiny', enzymes: [], ng: 100 }], { conditions: { dyeFront: 1, agarosePct: 0.7 } })
    expect(s.ranOff).toEqual([{ laneIdx: 0, count: 1 }])
  })

  it('gives heavier bands a brighter peak', () => {
    const s = scene([seq(20), seq(400)])
    expect(s.bands[1].peak).toBeGreaterThan(s.bands[0].peak)
  })
})

describe('renderRaster', () => {
  const look = GEL_LOOKS.uv

  it('covers the slab at the requested scale', () => {
    const s = scene([seq(100)])
    const r = renderRaster(s, look, { scale: 2, exposure: 0, effects: NO_EFFECTS })
    expect(r.width).toBe(Math.round(s.slab.w * 2))
    expect(r.height).toBe(Math.round(s.slab.h * 2))
    expect(r.data.length).toBe(r.width * r.height * 4)
  })

  it('draws a band brighter than the bare gel, and only inside its lane', () => {
    const s = scene([seq(200), { kind: 'empty' }])
    const r = renderRaster(s, look, { scale: 1, exposure: 0, effects: NO_EFFECTS })
    const band = s.bands[0]
    const y = band.y + band.h / 2 - s.slab.y
    const inLane = pixel(r, s.lanes[0].cx - s.slab.x, y)
    const emptyLane = pixel(r, s.lanes[1].cx - s.slab.x, y)
    expect(luma(inLane)).toBeGreaterThan(luma(emptyLane) + 300)
  })

  it('shows more DNA as a brighter band', () => {
    const s = scene([seq(10), seq(80)])
    const r = renderRaster(s, look, { scale: 1, exposure: 0, effects: NO_EFFECTS })
    const at = (i: number) => pixel(r, s.lanes[i].cx - s.slab.x, s.bands[i].y + s.bands[i].h / 2 - s.slab.y)
    expect(luma(at(1))).toBeGreaterThan(luma(at(0)))
  })

  it('renders a flat background with effects off, and a noisy one with grain', () => {
    const s = scene([{ kind: 'empty' }])
    const clean = renderRaster(s, look, { scale: 1, exposure: 0, effects: NO_EFFECTS })
    expect(pixel(clean, 3, 3)).toEqual(pixel(clean, 20, 40))
    const grainy = renderRaster(s, look, { scale: 1, exposure: 0, effects: { ...NO_EFFECTS, grain: true } })
    const samples = new Set(Array.from({ length: 30 }, (_, i) => luma(pixel(grainy, i, 10))))
    expect(samples.size).toBeGreaterThan(1)
    // Deterministic: the same gel always gets the same grain.
    const again = renderRaster(s, look, { scale: 1, exposure: 0, effects: { ...NO_EFFECTS, grain: true } })
    expect(again.data).toEqual(grainy.data)
  })

  it('bends bands down at the lane centre when smiling', () => {
    const s = scene([seq(15)], { width: 200 })
    const r = renderRaster(s, look, { scale: 1, exposure: 0, effects: { ...NO_EFFECTS, smile: true } })
    const lane = s.lanes[0]
    const bg = luma(pixel(r, 2, 2))
    // Brightness-weighted centre of the band in one pixel column.
    const centroid = (x: number) => {
      let sum = 0, weighted = 0
      for (let y = 0; y < r.height; y++) {
        const l = Math.max(0, luma(pixel(r, x, y)) - bg)
        sum += l
        weighted += l * y
      }
      return weighted / sum
    }
    const centre = centroid(lane.cx - s.slab.x)
    const edge = centroid(lane.x - s.slab.x + 4)
    expect(centre).toBeGreaterThan(edge)
  })
})

describe('sceneToSvg', () => {
  it('embeds the slab raster for photo looks', () => {
    const svg = sceneToSvg(scene([seq(100)]), GEL_LOOKS.uv, { showDyeFronts: false, slabPng: 'data:image/png;base64,AAAA' })
    expect(svg).toContain('<image')
    expect(svg).toContain('data:image/png;base64,AAAA')
  })

  it('draws schematic bands as vector rectangles', () => {
    const s = scene([seq(100)])
    const svg = sceneToSvg(s, GEL_LOOKS.schematic, { showDyeFronts: false, slabPng: null })
    expect(svg).not.toContain('<image')
    expect(svg.match(/rx="1"/g)).toHaveLength(s.bands.length)
  })

  it('escapes labels', () => {
    const s = scene([seq(100)])
    s.lanes[0].label = '<a&b>'
    expect(sceneToSvg(s, GEL_LOOKS.uv, { showDyeFronts: false, slabPng: null })).toContain('&lt;a&amp;b&gt;')
  })

  it('draws dye fronts only in loaded lanes', () => {
    const s = scene([seq(100), { kind: 'empty' }])
    const without = sceneToSvg(s, GEL_LOOKS.inverted, { showDyeFronts: false, slabPng: null })
    const withDyes = sceneToSvg(s, GEL_LOOKS.inverted, { showDyeFronts: true, slabPng: null })
    const count = (svg: string) => (svg.match(/fill-opacity="0.4"/g) ?? []).length
    expect(count(without)).toBe(0)
    expect(count(withDyes)).toBe(s.dyeFronts.length)
  })
})

describe('scene labels and the add-lane slot', () => {
  const setup = (labelMode: 'numbers' | 'names', ghostLane = false, label = 'A long sample name') => {
    const layout = layoutGel({ conditions: DEFAULT_CONDITIONS, lanes: [{ id: 'a', sample: seq(100) }] }, id => sources[id] ?? null)
    return buildScene({ width: 400, height: 300, layout, lanes: [{ label, isLadder: false }], exposure: 0, labelMode, ghostLane })
  }

  it('makes room above the gel for names written at an angle', () => {
    expect(setup('names').slab.y).toBeGreaterThan(setup('numbers').slab.y)
    expect(setup('names').labelMode).toBe('names')
  })

  it('reserves a slot after the last lane only when asked', () => {
    expect(setup('numbers').ghost).toBeNull()
    const s = setup('numbers', true)
    expect(s.ghost!.x).toBeGreaterThan(s.lanes[0].x + s.lanes[0].w)
    expect(s.ghost!.x + s.ghost!.w).toBeLessThanOrEqual(s.slab.x + s.slab.w)
  })

  it('writes angled names into the SVG', () => {
    expect(sceneToSvg(setup('names'), GEL_LOOKS.uv, { showDyeFronts: false, slabPng: null })).toContain('rotate(-45)')
  })

  it('numbers each band within its lane', () => {
    const s = scene([{ kind: 'ladder', ladderId: '1kb' }])
    expect(s.bands.map(b => b.bandIdx)).toEqual(s.bands.map((_, i) => i))
  })
})
