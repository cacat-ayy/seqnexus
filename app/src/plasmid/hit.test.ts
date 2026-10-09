import { describe, it, expect } from 'vitest'
import { buildPlasmidScene, type PlasmidSceneInput, type HitRegion } from './scene'
import { hitTestScene } from './hit'
import { getPlasmidStyle, resolvePlasmidColors } from './styles'
import { stackAnnotations, posToAngle } from './geometry'
import { Annotation } from '../models/Annotation'

const measure = (text: string, font: string) => {
  const size = parseFloat(/([\d.]+)px/.exec(font)?.[1] ?? '11')
  return text.length * size * 0.55
}

// A multiple cloning site: twelve sites within 60 bp of a 2,686 bp plasmid,
// a couple of pixels apart on the backbone.
const MCS = ['EcoRI', 'SacI', 'KpnI', 'SmaI', 'BamHI', 'XbaI', 'SalI', 'AccI', 'PstI', 'SbfI', 'SphI', 'HindIII']
  .map((label, i) => ({ key: `${label}@${396 + i * 5}`, label, cutPos: 396 + i * 5, methEffect: null }))

function scene(over: Partial<PlasmidSceneInput> = {}) {
  const style = getPlasmidStyle('modern')
  return buildPlasmidScene({
    size: 600,
    seqLen: 2686,
    name: 'pUC19',
    topology: 'circular',
    displayOrigin: 0,
    style,
    colors: resolvePlasmidColors(style, null),
    measureText: measure,
    rings: stackAnnotations([new Annotation({ id: 'lac', name: 'lacZ', type: 'CDS', start: 145, end: 469, strand: -1, color: '#4dabf7' })]),
    hoveredAnnotationId: null,
    proposalIds: new Set(),
    pickedIds: new Set(),
    enzymeGroups: MCS,
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
  })
}

const labels = (regions: HitRegion[]) =>
  regions.filter((r): r is Extract<HitRegion, { kind: 'label' }> => r.kind === 'label')

describe('pointing at a crowded cloning site', () => {
  it('gives every name a box the size of its text', () => {
    const named = labels(scene().hitRegions)
    expect(named.length).toBeGreaterThan(6)
    for (const r of named) expect(r.w).toBeGreaterThan(r.h)
  })

  it('returns the site whose name is clicked, for every name drawn', () => {
    const s = scene()
    for (const r of labels(s.hitRegions)) {
      expect(hitTestScene(s, r.x, r.y)?.id).toBe(r.id)
      // Towards either end of the text too, not only its middle.
      const along = r.w / 2 - 2
      expect(hitTestScene(s, r.x + Math.cos(r.rotate) * along, r.y + Math.sin(r.rotate) * along)?.id).toBe(r.id)
      expect(hitTestScene(s, r.x - Math.cos(r.rotate) * along, r.y - Math.sin(r.rotate) * along)?.id).toBe(r.id)
    }
  })

  it('takes the nearest mark on the backbone, not the first in range', () => {
    const s = scene()
    const c = s.size / 2
    for (const site of [MCS[0], MCS[6], MCS[11]]) {
      const a = posToAngle(site.cutPos, 2686)
      const hit = hitTestScene(s, c + Math.cos(a) * s.baseRadius, c + Math.sin(a) * s.baseRadius)
      expect(hit?.id).toBe(site.key)
    }
  })

  it('still finds a feature away from the sites', () => {
    const s = scene()
    const arc = s.hitRegions.find(r => r.kind === 'arc')!
    if (arc.kind !== 'arc') throw new Error('no arc')
    const a = arc.startAngle + 0.05
    const c = s.size / 2
    expect(hitTestScene(s, c + Math.cos(a) * arc.radius, c + Math.sin(a) * arc.radius)?.id).toBe('lac')
  })

  it('finds nothing in empty space', () => {
    expect(hitTestScene(scene(), 300, 300)).toBeNull()
  })
})

describe('hovering a name', () => {
  it('moves nothing, so the name stays under the pointer', () => {
    const plain = labels(scene().hitRegions)
    for (const r of plain) {
      const hovered = labels(scene({ hoveredEnzymeKey: r.id }).hitRegions)
      expect(hovered.map(h => [h.id, h.x, h.y])).toEqual(plain.map(h => [h.id, h.x, h.y]))
    }
  })
})
