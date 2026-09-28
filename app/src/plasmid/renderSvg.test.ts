import { describe, it, expect } from 'vitest'
import { renderSceneToSvg } from './renderSvg'
import { buildPlasmidScene, type PlasmidScene, type PlasmidSceneInput } from './scene'
import { stackAnnotations } from './geometry'
import { getPlasmidStyle, resolvePlasmidColors } from './styles'
import { Annotation } from '../models/Annotation'

const measure = (text: string, font: string) => {
  const size = parseFloat(/([\d.]+)px/.exec(font)?.[1] ?? '11')
  return text.length * size * 0.55
}

function scene(over: Partial<PlasmidSceneInput> = {}): PlasmidScene {
  const style = getPlasmidStyle('publication')
  const annotations = [
    new Annotation({ id: 'a', name: 'ampR', type: 'CDS', start: 100, end: 900, strand: 1, color: '#4dabf7' }),
    new Annotation({ id: 'b', name: 'ori', type: 'rep_origin', start: 1200, end: 1500, strand: -1, color: '#f76707' }),
    // A very long name, so at least one label lands outside its arc.
    new Annotation({ id: 'c', name: 'a rather long feature name', type: 'CDS', start: 1600, end: 1650, strand: 1, color: '#37b24d' }),
  ]
  return buildPlasmidScene({
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
    enzymeGroups: [{ key: 'e', label: 'EcoRI', cutPos: 400, methEffect: null }],
    hoveredEnzymeKey: null,
    primers: [{ id: 'p', name: 'F', start: 20, end: 45, strand: 1, selected: true }],
    selection: { anchor: 100, caret: 400 },
    selectionSpansOrigin: false,
    selectionLength: 300,
    methylation: { dam: [50, 120], dcm: [] },
    gc: null,
    gcPercent: 51,
    legend: [{ label: 'CDS', color: '#4dabf7' }],
    ...over,
  })
}

function parse(svg: string): Document {
  return new DOMParser().parseFromString(svg, 'image/svg+xml')
}

describe('renderSceneToSvg', () => {
  it('emits well-formed XML', () => {
    const doc = parse(renderSceneToSvg(scene()))
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.documentElement.tagName).toBe('svg')
  })

  it('sizes the viewBox to the scene', () => {
    const doc = parse(renderSceneToSvg(scene()))
    expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 600 600')
  })

  it('emits one element per scene item, so the two emitters cannot drift', () => {
    const s = scene()
    const doc = parse(renderSceneToSvg(s))
    const drawn = doc.querySelectorAll('rect, circle, path, line, text')
    // Curved labels contribute a <path> in defs plus a <text>, so count those
    // defs paths out of the comparison.
    const defsPaths = doc.querySelectorAll('defs path').length
    expect(drawn.length - defsPaths).toBe(s.items.length)
  })

  it('keeps text as text rather than outlines, so a figure stays editable', () => {
    const doc = parse(renderSceneToSvg(scene()))
    const texts = [...doc.querySelectorAll('text')].map(t => t.textContent)
    expect(texts).toContain('pUC19')
    expect(texts).toContain('EcoRI')
    expect(texts.some(t => t?.includes('51% GC'))).toBe(true)
  })

  it('curves feature names along a path instead of one element per character', () => {
    const doc = parse(renderSceneToSvg(scene()))
    const textPaths = doc.querySelectorAll('textPath')
    expect(textPaths.length).toBeGreaterThan(0)
    // Every textPath must point at a path that actually exists.
    for (const tp of textPaths) {
      const href = tp.getAttribute('href')!
      expect(doc.querySelector(`defs ${href}`)).not.toBeNull()
    }
  })

  it('escapes markup in a sequence name', () => {
    const svg = renderSceneToSvg(scene({ name: '<script>&"' }))
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
    expect(parse(svg).querySelector('parsererror')).toBeNull()
  })

  it('carries the legend into the export', () => {
    const doc = parse(renderSceneToSvg(scene()))
    expect([...doc.querySelectorAll('text')].some(t => t.textContent === 'CDS')).toBe(true)
  })

  it('renders an empty sequence without failing', () => {
    const doc = parse(renderSceneToSvg(scene({ seqLen: 0 })))
    expect(doc.querySelector('parsererror')).toBeNull()
  })
})

describe('full-circle features', () => {
  it('still draws a feature that spans the whole plasmid', () => {
    // A 2π arc has coincident start and end points, so a single SVG arc
    // command renders nothing. The canvas drew it, so the export must too.
    const s = scene({
      rings: stackAnnotations([
        new Annotation({ id: 'w', name: 'whole', type: 'CDS', start: 0, end: 0, strand: 1, color: '#123456' }),
      ]),
    })
    const doc = parse(renderSceneToSvg(s))
    const band = [...doc.querySelectorAll('path')].find(p => p.getAttribute('fill') === '#123456')
    expect(band).toBeDefined()
    // More than one arc command, which is what makes it a visible ring.
    expect((band!.getAttribute('d')!.match(/A /g) ?? []).length).toBeGreaterThan(1)
  })
})
