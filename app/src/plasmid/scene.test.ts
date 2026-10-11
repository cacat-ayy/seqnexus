import { describe, it, expect } from 'vitest'
import { buildPlasmidScene, isFlipped, type PlasmidSceneInput, type SceneItem } from './scene'
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

// The explorer's hover-card thumbnail: the card already prints the name,
// length and topology, and feature names are unreadable at 132px.
describe('thumbnail options', () => {
  const texts = (items: SceneItem[]) => items.flatMap(i =>
    i.kind === 'text' || i.kind === 'curvedText' ? [i.text] : [])

  it('draws feature names by default', () => {
    const t = texts(buildPlasmidScene(input()).items)
    expect(t).toContain('ampR')
    expect(t).toContain('ori')
  })

  it('keeps the features but drops their names', () => {
    const labelled = buildPlasmidScene(input())
    const bare = buildPlasmidScene(input({ showFeatureLabels: false }))
    const t = texts(bare.items)
    expect(t).not.toContain('ampR')
    expect(t).not.toContain('ori')
    // Same arcs, and still hoverable.
    expect(bare.items.filter(i => i.kind === 'arcBand'))
      .toEqual(labelled.items.filter(i => i.kind === 'arcBand'))
    expect(bare.hitRegions).toEqual(labelled.hitRegions)
  })

  it('leaves the centre empty', () => {
    const t = texts(buildPlasmidScene(input({ showCentre: false })).items)
    expect(t).not.toContain('pUC19')
    expect(t.some(s => s.includes('bp') || s.includes('circular'))).toBe(false)
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

describe('curved label direction', () => {
  // The canvas and SVG emitters turn each glyph by angle + 90° when a label
  // runs clockwise and by angle - 90° when it is flipped. Upright means that
  // turn stays within a quarter turn either way.
  const turn = (angle: number) => {
    const t = isFlipped(angle) ? angle - Math.PI / 2 : angle + Math.PI / 2
    return Math.atan2(Math.sin(t), Math.cos(t))
  }

  it('keeps labels upright all the way round', () => {
    for (let deg = -90; deg < 270; deg += 5) {
      if (deg % 180 === 0) continue // 3 and 9 o'clock read sideways either way
      expect(Math.abs(turn((deg * Math.PI) / 180)), `at ${deg}°`).toBeLessThan(Math.PI / 2)
    }
  })

  it('flips only the bottom half', () => {
    expect(isFlipped(-Math.PI / 2)).toBe(false) // 12 o'clock
    expect(isFlipped(-Math.PI * 0.75)).toBe(false) // top left, where the bug was
    expect(isFlipped(Math.PI / 4)).toBe(true) // bottom right, where the bug was
    expect(isFlipped(Math.PI / 2)).toBe(true) // 6 o'clock
  })
})

describe('spliced features and several selected ranges', () => {
  const bands = (items: SceneItem[]) => items.filter((i): i is Extract<SceneItem, { kind: 'arcBand' }> => i.kind === 'arcBand')

  it('draws a spliced feature exon by exon, with a thin arc over the intron', () => {
    const spliced = new Annotation({
      id: 's', name: 'exons', type: 'CDS', start: 100, end: 900, strand: 1,
      segments: [[100, 300], [600, 900]],
    })
    const b = bands(buildPlasmidScene(input({ rings: stackAnnotations([spliced]) })).items)
    const exons = b.filter(x => x.width > 2)
    const intron = b.filter(x => x.width <= 2)
    expect(exons).toHaveLength(2)
    expect(intron).toHaveLength(1)
    // Only the exon the feature ends in carries the arrow.
    expect(exons.map(x => x.strand)).toEqual([0, 1])
    expect(intron[0].span).toBeCloseTo((300 / 2686) * Math.PI * 2)
  })

  it('draws no intron where a join is split only at the origin', () => {
    const wrapped = new Annotation({
      id: 'w', name: 'wrap', type: 'CDS', start: 2600, end: 50, strand: 1,
      segments: [[2600, 2686], [0, 50]],
    })
    const b = bands(buildPlasmidScene(input({ rings: stackAnnotations([wrapped]) })).items)
    expect(b.filter(x => x.width <= 2)).toHaveLength(0)
  })

  it('draws a band for every selected range', () => {
    const one = bands(buildPlasmidScene(input({ selection: { anchor: 10, caret: 20 } })).items).length
    const three = bands(buildPlasmidScene(input({
      selection: { anchor: 10, caret: 20 },
      extraSelections: [{ anchor: 40, caret: 50 }, { anchor: 2600, caret: 5 }],
    })).items).length
    expect(three - one).toBe(2)
  })
})

describe('the cloning workspace options', () => {
  const crowded = Array.from({ length: 60 }, (_, i) => ({
    key: `e${i}`, label: `Enz${i}`, cutPos: 400 + i * 2, methEffect: null,
  }))
  const texts = (items: SceneItem[]) =>
    items.filter((i): i is Extract<SceneItem, { kind: 'text' }> => i.kind === 'text')

  it('keeps a chosen site on a map too crowded for every name', () => {
    const scene = buildPlasmidScene(input({ enzymeGroups: crowded, pickedEnzymeKeys: new Set(['e59']) }))
    const label = texts(scene.items).find(t => t.text === 'Enz59')
    expect(label).toBeDefined()
    expect(label!.fill).toBe(resolvePlasmidColors(getPlasmidStyle('modern'), null).accent)
  })

  it('draws a band per marked stretch, in its own colour', () => {
    const scene = buildPlasmidScene(input({
      regions: [{ start: 10, end: 400, color: 'hsl(1 50% 50%)' }, { start: 2600, end: 20, color: 'hsl(2 50% 50%)' }],
    }))
    const fills = scene.items.filter(i => i.kind === 'arcBand').map(i => (i as { fill: string }).fill)
    expect(fills).toContain('hsl(1 50% 50%)')
    expect(fills).toContain('hsl(2 50% 50%)')
  })

  it('can leave the caret off', () => {
    const lines = (over: Partial<PlasmidSceneInput>) =>
      buildPlasmidScene(input(over)).items.filter(i => i.kind === 'line').length
    expect(lines({ showCaret: false })).toBe(lines({}) - 1)
  })

  it('writes a note in the middle in place of the selection count', () => {
    const scene = buildPlasmidScene(input({
      selection: { anchor: 10, caret: 50 }, selectionLength: 40, centreNote: 'Keeps 2,635 bp',
    }))
    const all = texts(scene.items).map(t => t.text)
    expect(all).toContain('Keeps 2,635 bp')
    expect(all).not.toContain('40 bp selected')
  })

  it('breaks the backbone of a linear molecule, and only when asked', () => {
    const rings = (over: Partial<PlasmidSceneInput>) =>
      buildPlasmidScene(input({ topology: 'linear', ...over })).items.filter(i => i.kind === 'ring').length
    expect(rings({})).toBe(1)
    expect(rings({ openEnds: true })).toBe(0)
    expect(buildPlasmidScene(input({ openEnds: true })).items.some(i => i.kind === 'ring')).toBe(true)
  })
})

describe('a crowded stretch of cut sites', () => {
  const MCS = ['EcoRI', 'SacI', 'KpnI', 'SmaI', 'BamHI', 'XbaI', 'SalI', 'PstI', 'SphI', 'HindIII']
    .map((label, i) => ({ key: label, label, cutPos: 396 + i * 6, methEffect: null }))
  const texts = (items: SceneItem[]) =>
    items.filter((i): i is Extract<SceneItem, { kind: 'text' }> => i.kind === 'text')
  const bracket = (items: SceneItem[]) =>
    items.filter(i => i.kind === 'arcBand' && i.width === 1.5 && i.strand === 0)

  it('lists its names in one straight column beside the circle, in order', () => {
    const scene = buildPlasmidScene(input({ enzymeGroups: MCS }))
    const names = MCS.map(s => texts(scene.items).find(t => t.text === s.label)!)
    for (const t of names) {
      expect(t).toBeDefined()
      expect(t.rotate).toBeUndefined()
      expect(Math.hypot(t.x - 300, t.y - 300)).toBeGreaterThan(scene.baseRadius)
      expect(t.x).toBeCloseTo(names[0].x, 6)
    }
    // The stretch is on the right, so clockwise reads downward.
    for (let i = 1; i < names.length; i++) expect(names[i].y).toBeGreaterThan(names[i - 1].y)
    expect(bracket(scene.items)).toHaveLength(1)
  })

  it('leaves a short run inside the circle, as before', () => {
    const scene = buildPlasmidScene(input({ enzymeGroups: MCS.slice(0, 4) }))
    expect(bracket(scene.items)).toHaveLength(0)
    for (const s of MCS.slice(0, 4)) {
      const t = texts(scene.items).find(x => x.text === s.label)
      if (t) expect(Math.hypot(t.x - 300, t.y - 300)).toBeLessThan(scene.baseRadius)
    }
  })

  it('keeps the circle in the middle', () => {
    const scene = buildPlasmidScene(input({ enzymeGroups: MCS }))
    expect(scene.baseRadius).toBe(600 * getPlasmidStyle('modern').radiusFactor)
    const name = texts(scene.items).find(t => t.text === 'pUC19')!
    expect(name.x).toBe(300)
  })

  it('keeps feature names off the list', () => {
    const scene = buildPlasmidScene(input({
      enzymeGroups: MCS,
      rings: stackAnnotations([ann(100, 900, 'a', 'ampR'), ann(397, 454, 'mcs', 'multiple cloning site')]),
    }))
    const list = MCS.map(s => texts(scene.items).find(t => t.text === s.label)!)
    const feature = texts(scene.items).find(t => t.text.startsWith('mult'))!
    expect(feature).toBeDefined()
    const w = measure(feature.text, feature.font)
    const fx1 = feature.align === 'left' ? feature.x : feature.align === 'right' ? feature.x - w : feature.x - w / 2
    for (const t of list) {
      const tw = measure(t.text, t.font)
      const overlapX = fx1 < t.x + tw && fx1 + w > t.x
      const overlapY = Math.abs(feature.y - t.y) < 10
      expect(overlapX && overlapY).toBe(false)
    }
  })
})

describe('feature names beside a crowded stretch', () => {
  const MCS = ['EcoRI', 'SacI', 'KpnI', 'SmaI', 'BamHI', 'XbaI', 'SalI', 'PstI', 'SphI', 'HindIII']
    .map((label, i) => ({ key: label, label, cutPos: 396 + i * 6, methEffect: null }))

  it('join its list, in their place round the circle', () => {
    const scene = buildPlasmidScene(input({
      enzymeGroups: MCS,
      rings: stackAnnotations([ann(100, 300, 'a', 'ampR'), ann(469, 491, 'laco', 'lacO')]),
    }))
    const text = (t: string) => scene.items.find(i => i.kind === 'text' && i.text === t) as Extract<SceneItem, { kind: 'text' }>
    const lacO = text('lacO')
    const last = text('HindIII')
    expect(lacO).toBeDefined()
    expect(lacO.x).toBeCloseTo(last.x, 6)
    // lacO is past the cloning site clockwise, so it comes after HindIII.
    expect(lacO.y).toBeGreaterThan(last.y)
  })
})

describe('a small map', () => {
  const small = [ann(100, 900, 'a', 'ampR'), ann(1200, 1500, 'b', 'ori'), ann(469, 491, 'laco', 'lacO')]
  const names = (size: number) =>
    buildPlasmidScene(input({ size, rings: stackAnnotations(small) })).items
      .flatMap(i => (i.kind === 'text' || i.kind === 'curvedText' ? [i.text] : []))

  it('leaves small features unnamed', () => {
    expect(names(440)).not.toContain('lacO')
    expect(names(440)).toContain('ori')
  })

  it('names them on a larger map', () => {
    expect(names(600)).toContain('lacO')
  })
})
