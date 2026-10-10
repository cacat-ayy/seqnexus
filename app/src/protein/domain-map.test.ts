import { describe, it, expect } from 'vitest'
import { buildDomainMapScene } from './domain-map'
import { Annotation } from '../models/Annotation'
import { getPlasmidStyle, type PlasmidColors } from '../plasmid/styles'
import { renderSceneToSvg } from '../plasmid/renderSvg'

const colors: PlasmidColors = {
  bg: '#ffffff', backbone: '#000000', text: '#000000', textMuted: '#444444', tickMinor: '#999999',
  accent: '#000000', selection: 'rgba(0,0,0,0.12)', search: '#888888', searchCurrent: '#000000',
  enzyme: '#333333', guide: '#7c3aed', primer: '#555555', gc: '#666666', gcSkewPos: '#777777', gcSkewNeg: '#bbbbbb',
  dam: '#666666', dcm: '#999999',
}
const measure = (text: string) => text.length * 6

function scene(features: Annotation[], width = 800) {
  return buildDomainMapScene({
    width, seqLen: 300, name: 'Test', firstNumber: 1, features,
    style: getPlasmidStyle('publication'), colors, measureText: measure,
    hoveredAnnotationId: null, selection: null,
  })
}

describe('buildDomainMapScene', () => {
  it('is as wide as asked and as tall as its lanes need', () => {
    const empty = scene([])
    const one = scene([new Annotation({ id: 'a', name: 'Domain', type: 'Domain', start: 10, end: 100, strand: 0 })])
    expect(empty.size).toBe(800)
    expect(one.size).toBe(800)
    expect(one.height!).toBeGreaterThan(empty.height!)
  })

  it('stacks overlapping features in separate lanes and gives each a hit box', () => {
    const s = scene([
      new Annotation({ id: 'a', name: 'A', type: 'Domain', start: 10, end: 200, strand: 0 }),
      new Annotation({ id: 'b', name: 'B', type: 'Region', start: 50, end: 150, strand: 0 }),
    ])
    const boxes = s.hitRegions.filter(r => r.kind === 'box')
    expect(boxes.map(b => b.id).sort()).toEqual(['a', 'b'])
    const [ya, yb] = ['a', 'b'].map(id => (boxes.find(b => b.id === id) as { y: number }).y)
    expect(ya).not.toBe(yb)
  })

  it('draws a one-residue feature as a site and a disulfide as a bracket', () => {
    const s = scene([
      new Annotation({ id: 'site', name: 'P', type: 'modified_residue', start: 40, end: 41, strand: 0 }),
      new Annotation({ id: 'ss', name: 'Cys3-Cys30', type: 'disulfide', start: 2, end: 30, strand: 0, segments: [[2, 3], [29, 30]] }),
    ])
    expect(s.items.some(i => i.kind === 'dot')).toBe(true)
    expect(s.hitRegions.some(r => r.kind === 'box' && r.id === 'ss')).toBe(true)
  })

  it('renders to SVG with the scene height', () => {
    const s = scene([new Annotation({ id: 'a', name: 'Domain', type: 'Domain', start: 10, end: 100, strand: 0 })])
    const svg = renderSceneToSvg(s)
    expect(svg).toContain(`width="800" height="${s.height}"`)
    expect(svg).toContain('Domain')
  })
})
