/**
 * What the sequence view lays out in its feature lanes and translation rows.
 *
 * The lanes hold more than the document's features: ORFs from the finder,
 * primer binding sites (saved, and the workbench's unsaved picks) and the
 * auto-annotation suggestions. The view and the PDF export both build them
 * here, so an export lays out exactly the bars the view shows.
 */

import { useMemo } from 'react'
import { useEditorStore } from '../store'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import type { Alphabet } from '../models/alphabet'
import { IntervalTree } from '../models/IntervalTree'
import { orfOverlayData } from '../utils/orf-features'
import { motifIdFor, PEPTIDE_ID_PREFIX } from '../utils/motif-features'
import { proteinScale, scaleProfile } from '../protein/scales'
import type { GraphTrack } from './sequence-paint'
import { offeredSuggestions, proposalAnnotations } from '../utils/auto-annotations'
import { usePrimerSites, useDesignPreview } from '../primers/usePrimerSites'
import { primerItems, type PrimerItem } from '../primers/display'
import { guideItems, type GuideItem } from '../crispr/display'
import { resolveNuclease } from '../crispr/nucleases'
import { guideKey } from '../utils/guide-features'
import { geneticCode } from '../codon/genetic-codes'
import { framesFor, translationRowCount, translatesSelection } from '../codon/translation-display'

export function useSequenceTracks(doc: DocumentState) {
  const hiddenAnnotationIds = useEditorStore(s => s.hiddenAnnotationIds)
  const showOrfs = useEditorStore(s => s.showOrfs)
  const allOrfResults = useEditorStore(s => s.orfResults)
  const showMotifs = useEditorStore(s => s.showMotifs)
  const allMotifResults = useEditorStore(s => s.motifResults)
  const motifCategoriesOff = useEditorStore(s => s.motifCategoriesOff)
  const peptideOverlay = useEditorStore(s => s.peptideOverlay)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const designPicks = useEditorStore(s => s.primerDesign.picks)
  const designBatch = useEditorStore(s => s.primerDesign.batch)
  const showGuides = useEditorStore(s => s.showGuides)
  const guideResults = useEditorStore(s => s.guideResults)
  const guideDraw = useEditorStore(s => s.crisprDraw)
  const guidePicks = useEditorStore(s => s.guidePicks)
  const selectedGuideKey = useEditorStore(s => s.selectedGuideKey)
  const customNucleases = useEditorStore(s => s.customNucleases)
  const showAutoAnnotations = useEditorStore(s => s.showAutoAnnotations)
  const allAutoAnnotations = useEditorStore(s => s.autoAnnotations)
  const autoOverlapThreshold = useEditorStore(s => s.autoAnnotateOverlapThreshold)
  const autoAnnotationPicks = useEditorStore(s => s.autoAnnotationPicks)

  // Convert ORF results to Annotation objects for unified rendering.
  // The id carries the ORF's identity rather than its index in the list, so a
  // pick survives the re-scan that changing the ORF settings triggers.
  const orfCodeId = useEditorStore(s => s.translationCodeId)
  const orfAnnotations = useMemo(
    () => (showOrfs ? allOrfResults.map(orf => new Annotation(orfOverlayData(orf, orfCodeId))) : []),
    [showOrfs, allOrfResults, orfCodeId],
  )

  // Motif hits on a protein, drawn like ORFs: an overlay of what the scan
  // found, with the id carrying the hit's identity so a pick survives a
  // re-scan. Categories switched off in the panel are left out here too.
  const motifAnnotations = useMemo(() => {
    if (!showMotifs || allMotifResults.length === 0) return []
    const off = new Set(motifCategoriesOff)
    return allMotifResults.filter(h => !off.has(h.category)).map(hit => new Annotation({
      id: motifIdFor(hit),
      name: hit.name,
      type: hit.type,
      start: hit.start,
      end: hit.end,
      strand: 0,
      color: hit.color,
    }))
  }, [showMotifs, allMotifResults, motifCategoriesOff])

  // A digest's peptides, drawn as bars over the protein they were cut
  // from; the dialog that made them owns the overlay and takes it away.
  const peptideAnnotations = useMemo(() => {
    if (!peptideOverlay || peptideOverlay.tabId !== activeTabId) return []
    return peptideOverlay.peptides.map((p, i) => new Annotation({
      id: `${PEPTIDE_ID_PREFIX}${i}`,
      name: p.name,
      type: 'mat_peptide',
      start: p.start,
      end: p.end,
      strand: 0,
      color: p.color,
    }))
  }, [peptideOverlay, activeTabId])

  // Primers: one lane item per binding site, spanning its tails too. Saved
  // primers and the workbench's unsaved picks go through the same path; the
  // picks are flagged as previews and drawn dashed.
  const primerSites = usePrimerSites(doc)
  const designPreview = useDesignPreview(doc, designPicks, designBatch)
  const allPrimerItems = useMemo(
    () => [...primerItems(doc.primers ?? [], primerSites, doc.sequence.length), ...designPreview.items],
    [doc.primers, primerSites, doc.sequence.length, designPreview.items],
  )
  const primerItemById = useMemo(
    () => new Map<string, PrimerItem>(allPrimerItems.map(i => [i.annotation.id, i])),
    [allPrimerItems],
  )

  // Guides: one lane item per site the scan found, with the PAM inside its
  // footprint so it gets room in the lane. The overlay switch governs them,
  // the way it governs ORFs: the panel can list sites without drawing them.
  const allGuideItems = useMemo(() => {
    if (!showGuides || guideResults.length === 0) return []
    const wanted = guideDraw === 'all'
      ? guideResults
      : guideDraw === 'picked'
        ? guideResults.filter(c => guidePicks.has(guideKey(c.site)))
        : guideResults.filter(c => guideKey(c.site) === selectedGuideKey)
    return guideItems(wanted, id => resolveNuclease(id, customNucleases), doc.sequence.length)
  }, [showGuides, guideResults, guideDraw, guidePicks, selectedGuideKey, customNucleases, doc.sequence.length])
  const guideItemById = useMemo(
    () => new Map<string, GuideItem>(allGuideItems.map(i => [i.annotation.id, i])),
    [allGuideItems],
  )

  /**
   * Auto-annotation proposals, as annotations.
   *
   * Matches the document already covers are dropped here rather than drawn
   * greyed out: a suggestion to add something that exists is not a suggestion.
   */
  const autoAnnotations = useMemo(() => {
    if (!showAutoAnnotations || allAutoAnnotations.length === 0) return []
    // One per locus: the best of the relatives offered on a stretch, or the
    // one the user picked among them.
    return proposalAnnotations(
      offeredSuggestions(
        allAutoAnnotations, doc.annotations, autoOverlapThreshold, doc.sequence.length,
        doc.metadata?.rejectedSuggestions, autoAnnotationPicks,
      ).map(l => l.shown),
    )
  }, [showAutoAnnotations, allAutoAnnotations, doc.annotations, doc.sequence.length, doc.metadata?.rejectedSuggestions, autoOverlapThreshold, autoAnnotationPicks])

  // Filter out hidden annotations
  const hiddenSet = useMemo(() => new Set(hiddenAnnotationIds), [hiddenAnnotationIds])
  const visibleAnnotations = useMemo(() =>
    hiddenSet.size === 0 ? doc.annotations : doc.annotations.filter(a => !hiddenSet.has(a.id)),
    [doc.annotations, hiddenSet]
  )

  const annTree = useMemo(() => {
    const tree = new IntervalTree()
    for (const ann of visibleAnnotations) {
      tree.insert(ann)
    }
    for (const ann of orfAnnotations) {
      tree.insert(ann)
    }
    for (const item of allPrimerItems) {
      tree.insert(item.annotation)
    }
    for (const item of allGuideItems) {
      tree.insert(item.annotation)
    }
    for (const ann of autoAnnotations) {
      tree.insert(ann)
    }
    for (const ann of motifAnnotations) {
      tree.insert(ann)
    }
    for (const ann of peptideAnnotations) {
      tree.insert(ann)
    }
    return tree
  }, [visibleAnnotations, orfAnnotations, allPrimerItems, allGuideItems, autoAnnotations, motifAnnotations, peptideAnnotations])

  // Combined list for hit-testing (visible annotations + ORFs + primers + proposals)
  const allAnnotations = useMemo(() => {
    const extra = [...orfAnnotations, ...allPrimerItems.map(i => i.annotation), ...allGuideItems.map(i => i.annotation), ...autoAnnotations, ...motifAnnotations, ...peptideAnnotations]
    if (extra.length === 0) return visibleAnnotations
    return [...visibleAnnotations, ...extra]
  }, [visibleAnnotations, orfAnnotations, allPrimerItems, allGuideItems, autoAnnotations, motifAnnotations, peptideAnnotations])

  return {
    primerSites, designPreview, allPrimerItems, primerItemById,
    allGuideItems, guideItemById,
    visibleAnnotations, annTree, allAnnotations,
  }
}

/**
 * A protein's graph track, from the scale and window chosen in the display
 * popover; null for DNA or when none is chosen. The view and the PDF export
 * build it here, so both draw the same curve.
 */
export function useProteinGraph(doc: DocumentState): GraphTrack | null {
  const scaleId = useEditorStore(s => s.proteinScale)
  const windowPref = useEditorStore(s => s.proteinScaleWindow)
  const protein = doc.sequence.alphabet === 'protein'
  return useMemo(() => {
    if (!protein || scaleId === 'none') return null
    const scale = proteinScale(scaleId)
    const window = windowPref || scale.window
    return {
      values: scaleProfile(doc.sequence.bases, scale, window),
      min: scale.min, max: scale.max, mid: scale.mid,
      label: `${scale.short} ${window}`,
    }
  }, [protein, scaleId, windowPref, doc])
}

/**
 * Which reading frames to draw, and how many rows that needs.
 *
 * An empty frame list means the annotation modes, which draw one row per
 * distinct feature translation instead, and keep the two rows the view has
 * always reserved for them. A protein has nothing to translate, so for one
 * there are no frames and no rows whatever the preference says.
 */
export function useTranslationSettings(alphabet: Alphabet = 'dna') {
  const showTranslation = useEditorStore(s => s.showTranslation) && alphabet !== 'protein'
  const translationFrame = useEditorStore(s => s.translationFrame)
  const translationCodeId = useEditorStore(s => s.translationCodeId)
  const translationFrames = useMemo(
    () => (showTranslation ? framesFor(translationFrame) : []),
    [showTranslation, translationFrame],
  )
  const translationRows = showTranslation ? translationRowCount(translationFrame) : 0
  const translateSelection = showTranslation && translatesSelection(translationFrame)
  const translationCode = useMemo(() => geneticCode(translationCodeId), [translationCodeId])
  return { translationFrames, translationRows, translateSelection, translationCode }
}
