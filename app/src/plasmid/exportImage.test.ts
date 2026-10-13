import { describe, it, expect } from 'vitest'
import { buildPlasmidScene, type PlasmidSceneInput } from './scene'
import { stackAnnotations } from './geometry'
import { getPlasmidStyle, resolvePlasmidColors } from './styles'
import { Annotation } from '../models/Annotation'
import { FIGURE_SIZE, figureSceneInput } from './exportImage'
import { PAPER } from '../pdf/print-colors'

const measure = (text: string) => text.length * 6

function onScreen(): PlasmidSceneInput {
  const style = getPlasmidStyle('modern')
  return {
    size: 340,
    seqLen: 2686,
    name: 'pUC19',
    topology: 'circular',
    displayOrigin: 0,
    style,
    colors: { ...resolvePlasmidColors(style, null), bg: '#111111' },
    measureText: measure,
    rings: stackAnnotations([new Annotation({ id: 'a', name: 'ampR', type: 'CDS', start: 100, end: 900, strand: 1 })]),
    hoveredAnnotationId: 'a',
    proposalIds: new Set<string>(),
    pickedIds: new Set<string>(),
    enzymeGroups: [{ key: 'EcoRI', label: 'EcoRI', cutPos: 396, methEffect: null }],
    hoveredEnzymeKey: 'EcoRI',
    primers: [],
    selection: { anchor: 10, caret: 400 },
    selectionSpansOrigin: false,
    selectionLength: 390,
    searchHits: [{ start: 50, end: 60 }],
    currentSearchHit: 0,
    methylation: { dam: [], dcm: [] },
    gc: null,
    gcPercent: 50,
    legend: null,
  }
}

describe('figureSceneInput', () => {
  it('draws the map at the figure size on white, without what belongs to the screen', () => {
    const figure = figureSceneInput(onScreen())
    expect(figure.size).toBe(FIGURE_SIZE)
    expect(figure.colors.bg).toBe(PAPER)
    expect(figure.hoveredAnnotationId).toBeNull()
    expect(figure.hoveredEnzymeKey).toBeNull()
    expect(figure.selection.anchor).toBe(figure.selection.caret)
    expect(figure.searchHits).toEqual([])
    expect(figure.showCaret).toBe(false)
    // What the map shows by choice stays.
    expect(figure.enzymeGroups).toHaveLength(1)
    expect(figure.rings).toEqual(onScreen().rings)
  })

  it("has no selection band or caret in the figure", () => {
    const bands = (input: PlasmidSceneInput) => buildPlasmidScene(input).items
      .filter(i => i.kind === 'arcBand' && 'fill' in i && i.fill === input.colors.selection).length
    expect(bands(onScreen())).toBeGreaterThan(0)
    expect(bands(figureSceneInput(onScreen()))).toBe(0)
  })
})
