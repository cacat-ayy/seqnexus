import { describe, it, expect } from 'vitest'
import { buildPlasmidScene, isFlipped, textScale, type PlasmidSceneInput, type SceneItem } from './scene'
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
    const tick = texts.find(t => t.text === '500')
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

  it('lists its names beside the circle, flat, in order', () => {
    const scene = buildPlasmidScene(input({ enzymeGroups: MCS }))
    const names = MCS.map(s => texts(scene.items).find(t => t.text === s.label)!)
    for (const t of names) {
      expect(t).toBeDefined()
      expect(t.rotate).toBeUndefined()
      expect(Math.hypot(t.x - 300, t.y - 300)).toBeGreaterThan(scene.baseRadius)
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
    // Beside the sites, on their side, rather than stacked out on its own.
    expect(lacO.align).toBe(last.align)
    expect(Math.abs(lacO.y - last.y)).toBeLessThan(60)
    // Its place among the sites can give way to keep the leaders apart: a
    // feature's leader starts on its own ring, inside the sites', and the
    // layout moves a feature name before it moves a site, so the cloning
    // site's own order is what stays.
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

describe('a map wider than it is tall', () => {
  const wide = buildPlasmidScene(input({ size: 900, height: 500 }))
  const square = buildPlasmidScene(input({ size: 500 }))

  it('reports the box it was given', () => {
    expect(wide.size).toBe(900)
    expect(wide.height).toBe(500)
  })

  it('keeps the circle the size the shorter side allows', () => {
    expect(wide.baseRadius).toBe(square.baseRadius)
  })

  it('centres the circle in the box', () => {
    const ring = wide.items.find(i => i.kind === 'ring')
    expect(ring).toBeDefined()
    if (ring?.kind !== 'ring') throw new Error('not a ring')
    expect(ring.cx).toBe(450)
    expect(ring.cy).toBe(250)
  })

  it('fills the whole box with the background', () => {
    const bg = wide.items[0]
    if (bg.kind !== 'rect') throw new Error('not the background')
    expect([bg.w, bg.h]).toEqual([900, 500])
  })

  it('lets a long name run further before it is shortened', () => {
    const long = ann(1600, 1640, 'long', 'a feature with a very long name indeed')
    const names = (over: Partial<PlasmidSceneInput>) =>
      buildPlasmidScene(input({ rings: stackAnnotations([long]), ...over })).items
        .flatMap(i => (i.kind === 'text' ? [i.text] : []))
    const narrow = names({ size: 500 }).find(t => t.startsWith('a feature'))
    const roomy = names({ size: 900, height: 500 }).find(t => t.startsWith('a feature'))
    expect(narrow).toBeDefined()
    expect(roomy).toBeDefined()
    expect(roomy!.length).toBeGreaterThan(narrow!.length)
  })

  it('still behaves as a square map when no height is given', () => {
    const plain = buildPlasmidScene(input({ size: 500 }))
    expect(plain.height).toBe(500)
    expect(plain.baseRadius).toBe(square.baseRadius)
  })
})

describe('names stay inside the map', () => {
  // A crowded origin: several features at nearly the same angle, which is
  // what stacks names outward at 12 o'clock.
  const cluster = [
    ann(2680, 20, 'c1', 'homology to fragment A'),
    ann(2660, 10, 'c2', 'homology to fragment B'),
    ann(2600, 40, 'c3', 'a terminator with a name'),
    ann(2500, 60, 'c4', 'multiple cloning site'),
    ann(2400, 80, 'c5', 'homology to the vector'),
  ]
  const boxes = (size: number, height: number) =>
    buildPlasmidScene(input({ size, height, rings: stackAnnotations(cluster) }))
      .items.flatMap(i => {
        if (i.kind !== 'text') return []
        const w = measure(i.text, i.font)
        const x1 = i.align === 'center' ? i.x - w / 2 : i.align === 'right' ? i.x - w : i.x
        return [{ text: i.text, x1, x2: x1 + w, y: i.y }]
      })

  it('keeps every name within a wide map', () => {
    const out = boxes(900, 500).filter(b => b.x1 < 0 || b.x2 > 900 || b.y < 0 || b.y > 500)
    expect(out).toEqual([])
  })

  it('keeps every name within a square map too', () => {
    const out = boxes(500, 500).filter(b => b.x1 < 0 || b.x2 > 500 || b.y < 0 || b.y > 500)
    expect(out).toEqual([])
  })
})

describe('crowded spots in columns with elbow leaders', () => {
  type Line = Extract<SceneItem, { kind: 'line' }>
  const leaders = (items: SceneItem[]) =>
    items.filter((i): i is Line => i.kind === 'line' && i.width === 0.75 && Math.hypot(i.x2 - i.x1, i.y2 - i.y1) >= 3)
  /**
   * Crossings out in the open: two leaders meeting more than 24 px from
   * where either starts. Leaders leaving ticks a pixel or two apart touch
   * near the ticks whatever their order, and the layout does not reorder
   * names over that.
   */
  const crossingsIn = (items: SceneItem[]) => {
    const segs = leaders(items)
    // Each segment's leader starts where its run of joined segments starts.
    const starts: { x: number; y: number }[] = []
    segs.forEach((s, i) => {
      const prev = segs[i - 1]
      starts.push(prev && prev.x2 === s.x1 && prev.y2 === s.y1 ? starts[i - 1] : { x: s.x1, y: s.y1 })
    })
    const side = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
      (bx - ax) * (py - ay) - (by - ay) * (px - ax)
    let n = 0
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i], b = segs[j]
        const s1 = side(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1)
        const s2 = side(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2)
        if (!(s1 * s2 < -1e-6 && side(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1) * side(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2) < -1e-6)) continue
        const t = s1 / (s1 - s2)
        const px = b.x1 + (b.x2 - b.x1) * t
        const py = b.y1 + (b.y2 - b.y1) * t
        const far = (s: { x: number; y: number }) => Math.hypot(px - s.x, py - s.y) >= 24
        if (far(starts[i]) && far(starts[j])) n++
      }
    }
    return n
  }
  const texts = (items: SceneItem[]) =>
    items.filter((i): i is Extract<SceneItem, { kind: 'text' }> => i.kind === 'text')

  // A multiple cloning site straddling the origin, with overlapping features
  // on stacked rings around it: the shape of a plasmid's own junction.
  const seqLen = 2686
  const sites = ['EcoRI', 'SacI', 'KpnI', 'SmaI', 'BamHI', 'XbaI', 'SalI', 'PstI', 'SphI', 'HindIII']
    .map((label, i) => ({ key: label, label, cutPos: (seqLen - 30 + i * 6) % seqLen, methEffect: null }))
  const features = [
    ann(2600, 40, 'f1', 'homology arm left'),
    ann(2620, 60, 'f2', 'multiple cloning site'),
    ann(2560, 20, 'f3', 'terminator'),
    ann(10, 120, 'f4', 'homology arm right'),
    ann(2640, 90, 'f5', 'lacZ fragment'),
  ]
  const scene = (size = 600, height?: number) => buildPlasmidScene(input({
    size, height, seqLen, enzymeGroups: sites, rings: stackAnnotations(features),
  }))

  it('opens a spot at 12 o\'clock both ways, a column to each side', () => {
    const s = scene()
    const cx = s.size / 2
    const named = texts(s.items).filter(t => sites.some(x => x.label === t.text) || features.some(f => f.name === t.text))
    expect(named.some(t => t.x < cx && t.align === 'right')).toBe(true)
    expect(named.some(t => t.x > cx && t.align === 'left')).toBe(true)
  })

  /** The right-hand column's site names, top to bottom, as cut-order indices. */
  const rightColumn = (s: ReturnType<typeof scene>) => {
    const cx = s.size / 2
    return texts(s.items)
      .filter(t => t.align === 'left' && t.x > cx && sites.some(x => x.label === t.text))
      .sort((a, b) => a.y - b.y)
      .map(t => sites.findIndex(x => x.label === t.text))
  }

  it('reads a column downward in the order its sites come down that side, given room above', () => {
    // Tall enough that the rings stop well short of the top edge, so every
    // leader can climb its radius to its row.
    const order = rightColumn(scene(600, 1000))
    expect(order.length).toBeGreaterThan(2)
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1])
  })


  it('never crosses two leaders', () => {
    for (const [w, h] of [[600, undefined], [900, 500], [500, undefined], [1200, 700], [600, 1000]] as const) {
      expect(crossingsIn(scene(w, h).items)).toBe(0)
    }
  })

  it('makes a crowded spot of a few bunched feature names, with no cut sites at all', () => {
    const s = buildPlasmidScene(input({ size: 600, seqLen, rings: stackAnnotations(features) }))
    expect(crossingsIn(s.items)).toBe(0)
    const named = texts(s.items).filter(t => features.some(f => f.name === t.text))
    expect(named.length).toBeGreaterThanOrEqual(3)
    // Written flat beside the circle, not along an arc or turned.
    for (const t of named) {
      expect(t.rotate).toBeUndefined()
      expect(Math.hypot(t.x - s.size / 2, t.y - s.size / 2)).toBeGreaterThan(s.baseRadius)
    }
  })

  it('puts each name just past what is drawn at its height, not in a column', () => {
    // A 12 o'clock spot with room above: the stack is narrow at the top and
    // the circle widens below it, so the names near the top sit closer to
    // the vertical through the centre than the names further down.
    const s = scene(600, 1000)
    const cx = s.size / 2
    const right = texts(s.items)
      .filter(t => t.align === 'left' && t.x > cx && t.rotate === undefined)
      .sort((a, b) => a.y - b.y)
    expect(right.length).toBeGreaterThan(2)
    expect(right[0].x).toBeLessThan(right[right.length - 1].x)
  })
})

describe('the ring layout (sites outside)', () => {
  type Text = Extract<SceneItem, { kind: 'text' }>
  type Curved = Extract<SceneItem, { kind: 'curvedText' }>
  type Band = Extract<SceneItem, { kind: 'arcBand' }>
  const sites = [
    { key: 'BamHI', label: 'BamHI', cutPos: 300, methEffect: null },
    { key: 'EcoRI', label: 'EcoRI', cutPos: 2000, methEffect: null },
  ]
  const features = [ann(100, 900, 'a', 'ampR'), ann(1200, 1500, 'b', 'ori'), ann(1600, 1620, 'c', 'a promoter')]
  const build = (layout: 'features-outside' | 'sites-outside') => buildPlasmidScene(input({
    enzymeGroups: sites, rings: stackAnnotations(features), layout,
  }))
  const at = (s: { size: number; height?: number }, x: number, y: number) =>
    Math.hypot(x - s.size / 2, y - (s.height ?? s.size) / 2)

  it('draws the features inside the backbone, and outside it in the default layout', () => {
    const ring = build('sites-outside')
    const plain = build('features-outside')
    const featureBands = (s: ReturnType<typeof build>) =>
      s.items.filter((i): i is Band => i.kind === 'arcBand' && i.fill === features[0].color)
    expect(featureBands(ring).every(b => b.radius < ring.baseRadius)).toBe(true)
    expect(featureBands(plain).every(b => b.radius > plain.baseRadius)).toBe(true)
  })

  it('names every site outside the circle, with its position beside it', () => {
    const s = build('sites-outside')
    const texts = s.items.filter((i): i is Text => i.kind === 'text')
    for (const site of sites) {
      const name = texts.find(t => t.text === site.label)
      expect(name).toBeDefined()
      expect(at(s, name!.x, name!.y)).toBeGreaterThan(s.baseRadius)
      const pos = texts.find(t => t.text === `(${(site.cutPos + 1).toLocaleString('en-US')})` && t.y === name!.y)
      expect(pos).toBeDefined()
      // The name is the end nearer the circle, the position the outer end.
      expect(at(s, pos!.x, pos!.y)).toBeGreaterThan(at(s, name!.x, name!.y))
    }
  })

  it('keeps the ruler numbers inside the backbone and no site names inside', () => {
    const s = build('sites-outside')
    const turned = s.items.filter((i): i is Text => i.kind === 'text' && i.rotate !== undefined)
    expect(turned.length).toBeGreaterThan(0)
    for (const t of turned) {
      expect(/^[\d.,]+$/.test(t.text)).toBe(true)
      expect(at(s, t.x, t.y)).toBeLessThan(s.baseRadius)
    }
  })

  it('writes a name that does not fit its arrow curved, inside the ring', () => {
    const s = build('sites-outside')
    const name = s.items.find((i): i is Curved => i.kind === 'curvedText' && i.text === 'a promoter')
    expect(name).toBeDefined()
    const arc = s.items.find((i): i is Band => i.kind === 'arcBand' && i.fill === features[2].color)!
    expect(name!.radius).toBeLessThan(arc.radius)
  })

  it('leaves the leaders uncrossed and every name on the map', () => {
    const many = Array.from({ length: 24 }, (_, i) => ({
      key: `E${i}`, label: `Enzyme${i}`, cutPos: Math.round((i * 2686) / 24 + (i % 3) * 7), methEffect: null,
    }))
    for (const [w, h] of [[600, undefined], [900, 600]] as const) {
      const s = buildPlasmidScene(input({ size: w, height: h, enzymeGroups: many, layout: 'sites-outside' }))
      const texts = s.items.filter((i): i is Text => i.kind === 'text' && i.rotate === undefined && i.align !== 'center')
      for (const t of texts) {
        const wid = measure(t.text, t.font)
        const x1 = t.align === 'right' ? t.x - wid : t.x
        expect(x1).toBeGreaterThanOrEqual(0)
        expect(x1 + wid).toBeLessThanOrEqual(w)
        expect(t.y).toBeGreaterThanOrEqual(0)
        expect(t.y).toBeLessThanOrEqual(h ?? w)
      }
      expect(openCrossings(s.items)).toBe(0)
    }
  })
})

/** Leader crossings more than 24 px from where both leaders start. */
function openCrossings(items: SceneItem[]): number {
  type Line = Extract<SceneItem, { kind: 'line' }>
  const segs = items.filter((i): i is Line => i.kind === 'line' && i.width === 0.75 && Math.hypot(i.x2 - i.x1, i.y2 - i.y1) >= 3)
  const starts: { x: number; y: number }[] = []
  segs.forEach((s, i) => {
    const prev = segs[i - 1]
    starts.push(prev && prev.x2 === s.x1 && prev.y2 === s.y1 ? starts[i - 1] : { x: s.x1, y: s.y1 })
  })
  const side = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
    (bx - ax) * (py - ay) - (by - ay) * (px - ax)
  let n = 0
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j]
      const s1 = side(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1)
      const s2 = side(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2)
      if (!(s1 * s2 < -1e-6 && side(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1) * side(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2) < -1e-6)) continue
      const t = s1 / (s1 - s2)
      const px = b.x1 + (b.x2 - b.x1) * t
      const py = b.y1 + (b.y2 - b.y1) * t
      if (Math.hypot(px - starts[i].x, py - starts[i].y) >= 24 && Math.hypot(px - starts[j].x, py - starts[j].y) >= 24) n++
    }
  }
  return n
}

describe('a crowded spot inside the ring layout', () => {
  type Curved = Extract<SceneItem, { kind: 'curvedText' }>
  // Five small features side by side on one ring, too short for their names
  // to fit in their arrows, of different lengths.
  const bunch = [
    ann(500, 512, 'f1', 'twelve bp feature'),
    ann(513, 533, 'f2', 'twenty bp feature'),
    ann(534, 564, 'f3', 'thirty bp feature'),
    ann(565, 605, 'f4', 'forty bp feature'),
    ann(606, 656, 'f5', 'fifty bp feature'),
  ]
  const names = (hovered: string | null = null) =>
    buildPlasmidScene(input({ rings: stackAnnotations(bunch), layout: 'sites-outside', hoveredAnnotationId: hovered }))
      .items.filter((i): i is Curved => i.kind === 'curvedText').map(i => i.text)

  it('names at most two of them', () => {
    expect(names().filter(n => n.endsWith('feature'))).toHaveLength(2)
  })

  it('keeps the names of the largest and leaves off the smallest', () => {
    const shown = names()
    expect(shown).toContain('fifty bp feature')
    expect(shown).toContain('forty bp feature')
    expect(shown).not.toContain('twelve bp feature')
  })

  it('always shows the one under the pointer', () => {
    expect(names('f1')).toContain('twelve bp feature')
  })
})

describe('the ring layout names a cloning site round the circle', () => {
  type Text = Extract<SceneItem, { kind: 'text' }>
  type Line = Extract<SceneItem, { kind: 'line' }>
  // pUC19's cloning site at half past one, NdeI a little way before it.
  const mcs: [string, number][] = [
    ['NdeI', 183], ['EcoRI', 396], ['SacI', 406], ['KpnI', 412], ['SmaI', 414], ['BamHI', 417],
    ['XbaI', 423], ['SalI', 429], ['PstI', 439], ['SphI', 445], ['HindIII', 447],
  ]
  const build = (size: number, height?: number) => buildPlasmidScene(input({
    size, height, layout: 'sites-outside',
    rings: stackAnnotations([ann(146, 469, 'lacZ', 'lacZ-alpha'), ann(1626, 2486, 'amp', 'AmpR'), ann(867, 1455, 'ori', 'ori')]),
    enzymeGroups: mcs.map(([label, cutPos]) => ({ key: label, label, cutPos, methEffect: null })),
  }))
  const siteNames = (s: ReturnType<typeof build>) =>
    s.items.filter((i): i is Text => i.kind === 'text' && mcs.some(([n]) => n === i.text))
  const leaders = (s: ReturnType<typeof build>) =>
    s.items.filter((i): i is Line => i.kind === 'line' && i.width === 0.75)
  const box = (t: Text) => {
    const w = measure(t.text, t.font)
    const fs = parseFloat(/([\d.]+)px/.exec(t.font)![1])
    const x1 = t.align === 'right' ? t.x - w : t.align === 'center' ? t.x - w / 2 : t.x
    return { x1, x2: x1 + w, y1: t.y - fs / 2, y2: t.y + fs / 2 }
  }
  const sizes: [number, number | undefined][] = [[300, undefined], [350, undefined], [450, undefined], [600, undefined], [900, undefined], [900, 500]]

  it('hangs every leader end on one circle on each side', () => {
    for (const [w, h] of sizes) {
      const s = build(w, h)
      const cx = w / 2
      const cy = (h ?? w) / 2
      const ends = leaders(s).filter(l => l.x2 > cx).map(l => Math.hypot(l.x2 - cx, l.y2 - cy))
      expect(ends.length).toBeGreaterThan(5)
      expect(Math.max(...ends) - Math.min(...ends)).toBeLessThan(0.01)
    }
  })

  it('keeps the names apart, on the map, and the leaders out of them and uncrossed', () => {
    for (const [w, h] of sizes) {
      const s = build(w, h)
      const texts = s.items.filter((i): i is Text => i.kind === 'text' && i.rotate === undefined && i.align !== 'center')
      const boxes = texts.map(box)
      for (let i = 0; i < boxes.length; i++) {
        const a = boxes[i]
        expect(a.x1).toBeGreaterThanOrEqual(0)
        expect(a.x2).toBeLessThanOrEqual(w)
        expect(a.y1).toBeGreaterThanOrEqual(0)
        expect(a.y2).toBeLessThanOrEqual(h ?? w)
        for (let j = i + 1; j < boxes.length; j++) {
          const b = boxes[j]
          const apart = a.x2 <= b.x1 + 0.5 || b.x2 <= a.x1 + 0.5 || a.y2 <= b.y1 + 0.5 || b.y2 <= a.y1 + 0.5
          expect(apart).toBe(true)
        }
      }
      for (const l of leaders(s)) {
        for (const b of boxes) {
          for (let k = 1; k < 40; k++) {
            const x = l.x1 + (l.x2 - l.x1) * k / 40
            const y = l.y1 + (l.y2 - l.y1) * k / 40
            expect(x > b.x1 + 0.5 && x < b.x2 - 0.5 && y > b.y1 + 0.5 && y < b.y2 - 0.5).toBe(false)
          }
        }
      }
      expect(openCrossings(s.items)).toBe(0)
    }
  })

  it('keeps the names in the order of their sites', () => {
    for (const [w, h] of sizes) {
      const names = siteNames(build(w, h)).filter(t => t.align === 'left').map(t => t.text)
      const order = mcs.map(([n]) => n).filter(n => names.includes(n))
      expect(names).toEqual(order)
    }
  })

  it('centres the stack on its sites rather than jamming it against the top', () => {
    const s = build(350)
    const cy = 175
    const ys = siteNames(s).filter(t => t.text !== 'NdeI').map(t => t.y)
    const mid = (Math.min(...ys) + Math.max(...ys)) / 2
    // The sites are at about half past one, 63 px above the centre.
    const siteY = cy - s.baseRadius * Math.cos((416 / 2686) * 2 * Math.PI)
    expect(Math.abs(mid - siteY)).toBeLessThan(40)
    expect(Math.min(...ys)).toBeGreaterThan(20)
  })

  it('names every site of the cloning site from a mid-sized map up', () => {
    for (const w of [450, 600, 900]) {
      expect(siteNames(build(w)).map(t => t.text).sort()).toEqual(mcs.map(([n]) => n).sort())
    }
  })

  it('drops a position before its name where the map runs out of room', () => {
    for (const [w, h] of sizes) {
      const s = build(w, h)
      const texts = s.items.filter((i): i is Text => i.kind === 'text')
      const positions = texts.filter(t => /^\(\d[\d,]*\)$/.test(t.text))
      // Every position shown has its name on the same row.
      for (const p of positions) expect(siteNames(s).some(t => t.y === p.y)).toBe(true)
    }
    // A small map has a name shown without its position.
    const small = build(300)
    const texts = small.items.filter((i): i is Text => i.kind === 'text')
    const bare = siteNames(small).filter(t => !texts.some(p => p !== t && p.y === t.y && p.text.startsWith('(')))
    expect(bare.length).toBeGreaterThan(0)
  })
})

describe('text grows with a large map', () => {
  type Text = Extract<SceneItem, { kind: 'text' }>
  const px = (t: Text) => parseFloat(/([\d.]+)px/.exec(t.font)![1])

  it('scales from 600 px up to half as large again, never down', () => {
    expect(textScale(300)).toBe(1)
    expect(textScale(600)).toBe(1)
    expect(textScale(750)).toBe(1.25)
    expect(textScale(900)).toBe(1.5)
    expect(textScale(2000)).toBe(1.5)
  })

  it('draws the names and the middle larger on a large map, the same on a small one', () => {
    const name = (size: number, height?: number) =>
      buildPlasmidScene(input({ size, height })).items.find((i): i is Text => i.kind === 'text' && i.text === 'pUC19')!
    expect(px(name(400))).toBe(px(name(600)))
    expect(px(name(900))).toBeCloseTo(px(name(600)) * 1.5, 0)
    // By the shorter side: a wide panel is not a bigger map.
    expect(px(name(1200, 600))).toBe(px(name(600)))
  })
})

describe('the default layout names a crowded spot round the circle when it fits', () => {
  type Text = Extract<SceneItem, { kind: 'text' }>
  type Line = Extract<SceneItem, { kind: 'line' }>
  type Band = Extract<SceneItem, { kind: 'arcBand' }>
  const mcs: [string, number][] = [
    ['EcoRI', 396], ['SacI', 406], ['KpnI', 412], ['SmaI', 414], ['BamHI', 417],
    ['XbaI', 423], ['SalI', 429], ['PstI', 439], ['SphI', 445], ['HindIII', 447],
  ]
  const puc = [ann(146, 469, 'lacZ', 'lacZ-alpha'), ann(397, 453, 'mcs', 'MCS'), ann(867, 1455, 'ori', 'ori'), ann(1626, 2486, 'amp', 'AmpR')]
  // Four features stacked at 6 o'clock, far from the cloning site.
  const stack = [ann(1250, 1450, 's1', 's1'), ann(1260, 1440, 's2', 's2'), ann(1270, 1430, 's3', 's3'), ann(1280, 1420, 's4', 's4')]
  const build = (size: number, features = puc) => buildPlasmidScene(input({
    size, rings: stackAnnotations(features),
    enzymeGroups: mcs.map(([label, cutPos]) => ({ key: label, label, cutPos, methEffect: null })),
  }))
  const names = (s: ReturnType<typeof build>) =>
    s.items.filter((i): i is Text => i.kind === 'text' && mcs.some(([n]) => n === i.text))
  const leaders = (s: ReturnType<typeof build>) =>
    s.items.filter((i): i is Line => i.kind === 'line' && i.width === 0.75)
  /** The short flat tails into names that only the columns draw. */
  const tails = (s: ReturnType<typeof build>) =>
    leaders(s).filter(l => Math.abs(l.y1 - l.y2) < 0.01 && Math.abs(Math.abs(l.x2 - l.x1) - 6) < 0.5)

  it('hangs the names of a cloning site on one circle, in its order', () => {
    for (const size of [600, 750, 900]) {
      const s = build(size)
      expect(tails(s)).toHaveLength(0)
      const c = size / 2
      const ends = leaders(s).filter(l => l.x2 > c && l.y2 < c).map(l => Math.hypot(l.x2 - c, l.y2 - c))
      expect(Math.max(...ends) - Math.min(...ends)).toBeLessThan(0.01)
      const order = names(s).sort((a, b) => a.y - b.y).map(t => t.text)
      expect(order).toEqual(mcs.map(([n]) => n))
      expect(openCrossings(s.items)).toBe(0)
    }
  })

  it('hangs them past the rings by the site, not past a deeper stack elsewhere', () => {
    const plain = build(600)
    const stacked = build(600, [...puc, ...stack])
    const bracket = (s: ReturnType<typeof build>) =>
      s.items.find((i): i is Band => i.kind === 'arcBand' && i.width === 1.5 && i.strand === 0 && i.alpha === 0.6)!
    expect(bracket(stacked).radius).toBeCloseTo(bracket(plain).radius, 5)
    const d = (s: ReturnType<typeof build>) => names(s).map(t => Math.hypot(t.x - 300, t.y - 300))
    expect(Math.max(...d(stacked))).toBeCloseTo(Math.max(...d(plain)), 5)
  })

  it('brings a feature name in the spot up to the sites\' bracket before it turns to its name', () => {
    // Too long to fit in its arrow, so it is named outside, in the spot, with
    // a short feature stacked over it for its leader to rise past.
    const s = build(750, [
      ...puc.map(f => (f.id === 'mcs' ? ann(397, 453, 'mcs', 'multiple cloning site') : f)),
      ann(400, 450, 'cap', 'c'),
    ])
    const mcsName = s.items.find((i): i is Text => i.kind === 'text' && i.text.startsWith('multiple'))!
    expect(mcsName).toBeDefined()
    expect(tails(s)).toHaveLength(0)
    // A radial piece: its two ends at the same angle from the centre.
    const c = 375
    const radial = leaders(s).filter(l => {
      const a1 = Math.atan2(l.y1 - c, l.x1 - c)
      const a2 = Math.atan2(l.y2 - c, l.x2 - c)
      return Math.abs(a1 - a2) < 1e-6 && Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 2
    })
    expect(radial.length).toBeGreaterThan(0)
  })

  it('lists the spot in columns where the circle would name fewer of its sites', () => {
    const s = build(480)
    expect(tails(s).length).toBeGreaterThan(0)
    expect(names(s)).toHaveLength(mcs.length)
  })
})
