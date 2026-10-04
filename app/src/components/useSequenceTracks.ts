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
import { Annotation, type AnnotationData } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { IntervalTree } from '../models/IntervalTree'
import { orfColor } from '../workers/orf-finder'
import { orfIdFor, orfName } from '../utils/orf-features'
import { proposalsFrom, proposalAnnotations } from '../utils/auto-annotations'
import { usePrimerSites, useDesignPreview } from '../primers/usePrimerSites'
import { primerItems, type PrimerItem } from '../primers/display'
import { geneticCode } from '../codon/genetic-codes'
import { framesFor, translationRowCount, translatesSelection } from '../codon/translation-display'

export function useSequenceTracks(doc: DocumentState) {
  const hiddenAnnotationIds = useEditorStore(s => s.hiddenAnnotationIds)
  const showOrfs = useEditorStore(s => s.showOrfs)
  const allOrfResults = useEditorStore(s => s.orfResults)
  const designPicks = useEditorStore(s => s.primerDesign.picks)
  const designBatch = useEditorStore(s => s.primerDesign.batch)
  const showAutoAnnotations = useEditorStore(s => s.showAutoAnnotations)
  const allAutoAnnotations = useEditorStore(s => s.autoAnnotations)
  const autoOverlapThreshold = useEditorStore(s => s.autoAnnotateOverlapThreshold)

  // Convert ORF results to Annotation objects for unified rendering.
  // The id carries the ORF's identity rather than its index in the list, so a
  // pick survives the re-scan that changing the ORF settings triggers.
  const orfAnnotations = useMemo(() => {
    if (!showOrfs) return []
    return allOrfResults.map(orf => {
      const data: AnnotationData = {
        id: orfIdFor(orf),
        name: orfName(orf),
        type: 'CDS',
        start: orf.start,
        end: orf.end,
        strand: orf.strand,
        color: orfColor(orf.strand, orf.frame),
      }
      return new Annotation(data)
    })
  }, [showOrfs, allOrfResults])

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

  /**
   * Auto-annotation proposals, as annotations.
   *
   * Matches the document already covers are dropped here rather than drawn
   * greyed out: a suggestion to add something that exists is not a suggestion.
   */
  const autoAnnotations = useMemo(() => {
    if (!showAutoAnnotations || allAutoAnnotations.length === 0) return []
    return proposalAnnotations(
      proposalsFrom(allAutoAnnotations, doc.annotations, autoOverlapThreshold),
    )
  }, [showAutoAnnotations, allAutoAnnotations, doc.annotations, autoOverlapThreshold])

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
    for (const ann of autoAnnotations) {
      tree.insert(ann)
    }
    return tree
  }, [visibleAnnotations, orfAnnotations, allPrimerItems, autoAnnotations])

  // Combined list for hit-testing (visible annotations + ORFs + primers + proposals)
  const allAnnotations = useMemo(() => {
    const extra = [...orfAnnotations, ...allPrimerItems.map(i => i.annotation), ...autoAnnotations]
    if (extra.length === 0) return visibleAnnotations
    return [...visibleAnnotations, ...extra]
  }, [visibleAnnotations, orfAnnotations, allPrimerItems, autoAnnotations])

  return {
    primerSites, designPreview, allPrimerItems, primerItemById, visibleAnnotations, annTree, allAnnotations,
  }
}

/**
 * Which reading frames to draw, and how many rows that needs.
 *
 * An empty frame list means the annotation modes, which draw one row per
 * distinct feature translation instead, and keep the two rows the view has
 * always reserved for them.
 */
export function useTranslationSettings() {
  const showTranslation = useEditorStore(s => s.showTranslation)
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
