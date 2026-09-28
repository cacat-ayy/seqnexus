import { describe, it, expect } from 'vitest'
import { buildPlasmidScene, type PlasmidSceneInput, type SceneItem } from './scene'
import { stackAnnotations } from './geometry'
import { PLASMID_STYLES, getPlasmidStyle, resolvePlasmidColors } from './styles'
import { Annotation } from '../models/Annotation'

/**
 * A deterministic stand-in for canvas text metrics, so the layout can be
 * exercised with no DOM at all. That the layout accepts one is the whole
 * reason the SVG export can share it.
 */
const measure = (text: string, font: string) => {
  const size = parseFloat(/([\d.]+)px/.exec(font)?.[1] ?? '11')
  return text.length * size * 0.55
}

function ann(start: number, end: number, id: string, name = id, color = '#4dabf7') {
  return new Annotation({ id, name, type: 'CDS', start, end, strand: 1, color })
}

function input(over: Partial<PlasmidSceneInput> = {}): PlasmidSceneInput {
  const style = getPlasmidStyle('modern')
  const annotations = over.rings ? [] : [ann(100, 900, 'a', 'ampR'), ann(1200, 1500, 'b', 'ori')]
  return {
    size: 600,
    seqLen: 2686,
    name: 'pUC19',
    topology: 'circular',
    displayOrigin: 0,
    style,
    colors: resolvePlasmidColors(style, null),
    measureText: measure,
    rings: stackAnnotations(annotations),
    hoveredAnnotationId: null,
    proposalIds: new Set<string>(),
    pickedIds: new Set<string>(),
    enzymeGroups: [],
    hoveredEnzymeKey: null,
    primers: [],
    selection: { anchor: 0, caret: 0 },
    selectionSpansOrigin: false,
    selectionLength: 0,
    methylation: { dam: [], dcm: [] },
    gc: null,
    gcPercent: 50,
    legend: null,
    ...over,
  }
}

const kinds = (items: SceneItem[]) => items.map(i => i.kind)

describe('buildPlasmidScene', () => {
  it('is pure: the same input gives a deep-equal scene', () => {
    expect(buildPlasmidScene(input())).toEqual(buildPlasmidScene(input()))
  })

  it('needs no DOM', () => {
    // Nothing here touches document or a canvas; if it did, this would throw
    // under the node environment the rest of the suite shares.
    expect(() => buildPlasmidScene(input())).not.toThrow()
  })

  it('draws a backbone and one band per feature', () => {
    const scene = buildPlasmidScene(input())
    expect(kinds(scene.items)).toContain('ring')
    const bands = scene.items.filter(i => i.kind === 'arcBand')
    expect(bands.length).toBeGreaterThanOrEqual(2)
  })

  it('exposes a hit region per feature', () => {
    const scene = buildPlasmidScene(input())
    const ids = scene.hitRegions.filter(r => r.type === 'feature').map(r => r.id)
    expect(ids).toEqual(expect.arrayContaining(['a', 'b']))
  })

  it('reports the empty case rather than drawing an empty ring', () => {
    const scene = buildPlasmidScene(input({ seqLen: 0 }))
    const texts = scene.items.filter(i => i.kind === 'text')
    expect(texts).toHaveLength(1)
    expect(scene.items.some(i => i.kind === 'ring')).toBe(false)
  })

  it('puts the size, GC and topology in the centre', () => {
    const scene = buildPlasmidScene(input())
    const centre = scene.items.find(
      (i): i is Extract<SceneItem, { kind: 'text' }> =>
        i.kind === 'text' && i.text.includes('bp'),
    )
    expect(centre?.text).toContain('50% GC')
    expect(centre?.text).toContain('circular')
  })
})

describe('selection', () => {
  it('draws a slim band, not a slab three arc-widths wide', () => {
    const style = getPlasmidStyle('modern')
    const scene = buildPlasmidScene(input({
      selection: { anchor: 100, caret: 400 }, selectionLength: 300,
    }))
    const band = scene.items.find(
      (i): i is Extract<SceneItem, { kind: 'arcBand' }> => i.kind === 'arcBand',
    )
    // The old code used arcWidth * 3, which buried the enzyme ticks.
    expect(band!.width).toBeLessThan(style.arcWidth * 2)
  })

  it('omits the caret while a range is selected', () => {
    const withSel = buildPlasmidScene(input({
      selection: { anchor: 100, caret: 400 }, selectionLength: 300,
    }))
    const withoutSel = buildPlasmidScene(input())
    expect(withSel.items.filter(i => i.kind === 'line').length)
      .not.toBe(withoutSel.items.filter(i => i.kind === 'line').length)
  })
})

describe('inner label placement', () => {
  const enzymes = Array.from({ length: 40 }, (_, i) => ({
    key: `e${i}`,
    label: `EcoRI${i}`,
    cutPos: Math.round((i / 40) * 2686),
    methEffect: null,
  }))

  it('never places a label over the centre title', () => {
    const scene = buildPlasmidScene(input({ enzymeGroups: enzymes }))
    const cx = 300
    const cy = 300
    // The reserved block the builder uses, as a slightly tighter box so a
    // label merely grazing the edge does not fail the test.
    for (const item of scene.items) {
      if (item.kind !== 'text') continue
      if (Math.abs(item.y - cy) > 30) continue
      // The centre name and meta lines are themselves centred text.
      if (Math.abs(item.x - cx) < 1) continue
      expect(Math.abs(item.x - cx)).toBeGreaterThan(60)
    }
  })

  it('shares one tier map between ruler numbers and cut-site names', () => {
    // A cut site placed exactly on a major tick must not land on top of the
    // tick's own number, which is the collision the two old passes produced.
    const scene = buildPlasmidScene(input({
      seqLen: 5000,
      enzymeGroups: [{ key: 'x', label: 'BamHI', cutPos: 500, methEffect: null }],
    }))
    const texts = scene.items.filter(
      (i): i is Extract<SceneItem, { kind: 'text' }> => i.kind === 'text',
    )
    const tick = texts.find(t => t.text === '501')
    const enzyme = texts.find(t => t.text === 'BamHI')
    expect(tick).toBeDefined()
    expect(enzyme).toBeDefined()
    expect(Math.hypot(tick!.x - enzyme!.x, tick!.y - enzyme!.y)).toBeGreaterThan(8)
  })

  it('drops labels it cannot place rather than stacking them', () => {
    const scene = buildPlasmidScene(input({ enzymeGroups: enzymes }))
    const drawn = scene.items.filter(i => i.kind === 'text' && i.text.startsWith('EcoRI'))
    expect(drawn.length).toBeLessThanOrEqual(enzymes.length)
  })
})

describe('styles', () => {
  it('every preset produces a scene', () => {
    for (const style of PLASMID_STYLES) {
      const scene = buildPlasmidScene(input({
        style, colors: resolvePlasmidColors(style, null),
      }))
      expect(scene.items.length).toBeGreaterThan(0)
    }
  })

  it('publication draws on white with black ink, whatever the app theme', () => {
    const style = getPlasmidStyle('publication')
    const colors = resolvePlasmidColors(style, null)
    const scene = buildPlasmidScene(input({ style, colors }))
    expect(scene.background).toBe('#ffffff')
    expect(colors.backbone).toBe('#000000')
    expect(colors.text).toBe('#000000')
  })

  it('publication fills features opaquely, because alpha over white shifts the hue', () => {
    // Worth testing on real feature bands rather than on the scene as a whole:
    // with no methylation or GC ring present, an "everything is opaque" check
    // would pass without exercising anything.
    const style = getPlasmidStyle('publication')
    const scene = buildPlasmidScene(input({
      style, colors: resolvePlasmidColors(style, null),
    }))
    const featureIds = new Set(scene.hitRegions.filter(r => r.type === 'feature').map(r => r.id))
    expect(featureIds.size).toBeGreaterThan(0)
    const bands = scene.items.filter(
      (i): i is Extract<SceneItem, { kind: 'arcBand' }> =>
        i.kind === 'arcBand' && i.fill === '#4dabf7',
    )
    expect(bands).toHaveLength(featureIds.size)
    for (const band of bands) expect(band.alpha ?? 1).toBe(1)
    // And each carries the black outline the style asks for.
    for (const band of bands) expect(band.stroke).toBe('#000000')
  })

  it('keeps suggestions faint even in publication, so they still read as suggestions', () => {
    const style = getPlasmidStyle('publication')
    const a = ann(100, 900, 'auto_x', 'suggested')
    const scene = buildPlasmidScene(input({
      style,
      colors: resolvePlasmidColors(style, null),
      rings: stackAnnotations([a]),
      proposalIds: new Set(['auto_x']),
    }))
    const band = scene.items.find(
      (i): i is Extract<SceneItem, { kind: 'arcBand' }> =>
        i.kind === 'arcBand' && i.fill === '#4dabf7',
    )
    expect(band!.alpha).toBeLessThan(1)
    expect(band!.dash).toBe(true)
  })

  it('minimal omits the ruler and the cut-site names', () => {
    const style = getPlasmidStyle('minimal')
    const scene = buildPlasmidScene(input({
      style,
      colors: resolvePlasmidColors(style, null),
      enzymeGroups: [{ key: 'x', label: 'BamHI', cutPos: 500, methEffect: null }],
    }))
    const texts = scene.items.filter(
      (i): i is Extract<SceneItem, { kind: 'text' }> => i.kind === 'text',
    )
    expect(texts.some(t => t.text === 'BamHI')).toBe(false)
    expect(texts.some(t => /^\d+$/.test(t.text))).toBe(false)
  })
})

describe('primers', () => {
  it('draws two arcs per pair, which the old map drew none of', () => {
    const scene = buildPlasmidScene(input({
      primers: [
        { id: 'p0f', name: 'F', start: 10, end: 30, strand: 1, selected: false },
        { id: 'p0r', name: 'R', start: 200, end: 220, strand: -1, selected: true },
      ],
    }))
    const regions = scene.hitRegions.filter(r => r.type === 'primer')
    expect(regions.map(r => r.id)).toEqual(['p0f', 'p0r'])
  })
})

describe('legend', () => {
  it('is emitted as scene items, so it survives export', () => {
    const scene = buildPlasmidScene(input({
      legend: [{ label: 'CDS', color: '#ff0000' }, { label: 'promoter', color: '#00ff00' }],
    }))
    const texts = scene.items.filter(
      (i): i is Extract<SceneItem, { kind: 'text' }> => i.kind === 'text',
    )
    expect(texts.some(t => t.text === 'CDS')).toBe(true)
    expect(texts.some(t => t.text === 'promoter')).toBe(true)
  })
})
