/**
 * Everything the sequence PDF reads, gathered from the store the way the
 * sequence view and the plasmid map gather it for the screen.
 *
 * Works whether or not the text view is mounted (the map-only layout has
 * none), so the export does not depend on what is on screen; only the
 * "visible region" and "as on screen" line length do, and they fall back
 * when there is no view.
 */

import { useMemo } from 'react'
import { useEditorStore } from '../store'
import { groupCutSites } from '../enzymes/grouping'
import { buildBasePalette } from '../utils/base-colors'
import { buildResiduePalette } from '../utils/residue-colors'
import { useSequenceTracks, useTranslationSettings, useProteinGraph } from '../components/useSequenceTracks'
import { useBasesPerRow } from '../components/sequence-view-controls'
import { usePlasmidSceneData } from '../plasmid/usePlasmidSceneData'
import { buildPlasmidScene } from '../plasmid/scene'
import { pdfMeasure } from './fonts'
import { printPlasmidColors, printSequenceColors } from './print-colors'
import type { SequencePdfSource } from './sequence-pdf'

const NO_SELECTION = { anchor: 0, caret: 0 }

export function useSequencePdfSource(): SequencePdfSource {
  const doc = useEditorStore(s => s.doc)
  const colorScheme = useEditorStore(s => s.colorScheme)
  const colorTarget = useEditorStore(s => s.colorTarget)
  // A protein has no complement, no translation and its own colour scheme.
  const protein = doc.sequence.alphabet === 'protein'
  const showComplement = useEditorStore(s => s.showComplement) && !protein
  const proteinColorScheme = useEditorStore(s => s.proteinColorScheme)
  const showAnnotations = useEditorStore(s => s.showAnnotationTracks)
  const aminoAcidStyle = useEditorStore(s => s.aminoAcidStyle)
  const threeLetter = useEditorStore(s => s.threeLetterAminoAcids)
  const selection = useEditorStore(s => s.selection)
  const search = useEditorStore(s => s.search)
  const zoomLevel = useEditorStore(s => s.zoomLevel)
  const showEnzymes = useEditorStore(s => s.showEnzymes)
  const cutSites = useEditorStore(s => s.enzymeCutSites)
  const autoPicks = useEditorStore(s => s.autoAnnotationPicks)
  const orfPicks = useEditorStore(s => s.orfPicks)
  const motifPicks = useEditorStore(s => s.motifPicks)
  const guidePicks = useEditorStore(s => s.guidePicks)
  const screenBasesPerRow = useBasesPerRow()
  const graph = useProteinGraph(doc)

  const { annTree, primerItemById, guideItemById, visibleAnnotations } = useSequenceTracks(doc)
  const { translationFrames, translationRows, translateSelection, translationCode } = useTranslationSettings(doc.sequence.alphabet)
  const {
    style: mapStyle, layout: mapLayout, rings, proposalIds, pickedIds, sceneEnzymes, scenePrimers,
    methylation, gcSeries, gcOverall, legend,
  } = usePlasmidSceneData(doc)

  const damMeth = doc.metadata?.damMethylated || false
  const dcmMeth = doc.metadata?.dcmMethylated || false
  const groupedSites = useMemo(
    () => (showEnzymes ? groupCutSites(cutSites, damMeth, dcmMeth) : []),
    [showEnzymes, cutSites, damMeth, dcmMeth],
  )

  // Read once per dialog: the print palette does not follow the theme.
  const colors = useMemo(() => printSequenceColors(), [])
  const basePalette = useMemo(
    () => (protein ? buildResiduePalette(proteinColorScheme, colors.text) : buildBasePalette(colorScheme, colors.text)),
    [protein, proteinColorScheme, colorScheme, colors.text],
  )
  const mapColors = useMemo(() => printPlasmidColors(mapStyle), [mapStyle])

  const circular = doc.sequence.topology === 'circular'
  const plasmidScene = useMemo(() => {
    if (!circular || doc.sequence.length === 0) return null
    return (size: number) => buildPlasmidScene({
      size,
      seqLen: doc.sequence.length,
      name: doc.name,
      topology: doc.sequence.topology,
      displayOrigin: doc.metadata?.displayOrigin || 0,
      style: mapStyle,
      colors: mapColors,
      // Measured in the PDF's own fonts, so labels are placed for the glyphs they print in.
      measureText: (text, font) => pdfMeasure(font, text),
      rings,
      hoveredAnnotationId: null,
      proposalIds,
      pickedIds,
      enzymeGroups: sceneEnzymes,
      hoveredEnzymeKey: null,
      primers: scenePrimers,
      selection: NO_SELECTION,
      selectionSpansOrigin: false,
      selectionLength: 0,
      // A caret is where the cursor is on screen, not part of the map.
      showCaret: false,
      methylation,
      gc: gcSeries,
      gcPercent: gcOverall,
      legend,
      layout: mapLayout,
    })
  }, [
    circular, doc, mapStyle, mapLayout, mapColors, rings, proposalIds, pickedIds, sceneEnzymes,
    scenePrimers, methylation, gcSeries, gcOverall, legend,
  ])

  const paintBackground = colorTarget === 'background' && (protein ? proteinColorScheme : colorScheme) !== 'none'
  return useMemo(() => ({
    doc,
    annTree,
    features: visibleAnnotations,
    groupedSites,
    primerItemById,
    guideItemById,
    guidePicks,
    autoPicks,
    orfPicks,
    motifPicks,
    graph,
    translationFrames,
    translationRows,
    translateSelection,
    translationCode,
    aminoAcidStyle,
    threeLetter,
    basePalette,
    paintBackground,
    showComplement,
    showAnnotations,
    colors,
    selection,
    search,
    zoomLevel,
    screenBasesPerRow,
    plasmidScene,
  }), [
    doc, annTree, visibleAnnotations, groupedSites, primerItemById, guideItemById, guidePicks, autoPicks, orfPicks, motifPicks, graph,
    translationFrames, translationRows, translateSelection, translationCode, aminoAcidStyle,
    threeLetter, basePalette, paintBackground, showComplement, showAnnotations, colors,
    selection, search, zoomLevel, screenBasesPerRow, plasmidScene,
  ])
}
