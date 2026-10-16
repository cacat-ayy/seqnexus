/**
 * What the plasmid map draws, gathered from the store: the feature rings,
 * enzyme and primer marks, methylation, GC and the legend.
 *
 * The map view and the PDF export's map page both build their scene from
 * this, so the exported map shows what the view shows.
 */

import { useMemo } from 'react'
import { useEditorStore } from '../store'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { offeredSuggestions, proposalAnnotations, keyFromAutoId } from '../utils/auto-annotations'
import { orfOverlayData, keyFromOrfId } from '../utils/orf-features'
import { groupCutSites, enzymeGroupKey, type GroupedCutSite } from '../enzymes/grouping'
import { usePrimerSites, useDesignPreview } from '../primers/usePrimerSites'
import { primerItems, type PrimerItem } from '../primers/display'
import { cutPosition } from '../crispr/finder'
import { resolveNuclease } from '../crispr/nucleases'
import { guideKey, guideName } from '../utils/guide-features'
import type { SceneGuide } from './scene'
import { gcPercent } from '../primers/thermodynamics'
import type { ScenePrimer, SceneEnzymeGroup } from './scene'
import { getPlasmidStyle } from './styles'
import { stackAnnotations } from './geometry'
import { computeGcSeries, findMethylationSites } from './gc'

export function usePlasmidSceneData(doc: DocumentState) {
  const hiddenAnnotationIds = useEditorStore(s => s.hiddenAnnotationIds)
  const showOrfs = useEditorStore(s => s.showOrfs)
  const showEnzymes = useEditorStore(s => s.showEnzymes)
  const showAutoAnnotations = useEditorStore(s => s.showAutoAnnotations)
  const allEnzymeCutSites = useEditorStore(s => s.enzymeCutSites)
  const allOrfResults = useEditorStore(s => s.orfResults)
  const designPicks = useEditorStore(s => s.primerDesign.picks)
  const designBatch = useEditorStore(s => s.primerDesign.batch)
  const allAutoAnnotations = useEditorStore(s => s.autoAnnotations)
  const autoAnnotationPicks = useEditorStore(s => s.autoAnnotationPicks)
  const orfPicks = useEditorStore(s => s.orfPicks)
  const autoOverlapThreshold = useEditorStore(s => s.autoAnnotateOverlapThreshold)

  // Global display preferences
  const plasmidStyleId = useEditorStore(s => s.plasmidStyle)
  const layout = useEditorStore(s => s.plasmidLayout)
  const showGcRing = useEditorStore(s => s.showGcRing)
  const showPlasmidLegend = useEditorStore(s => s.showPlasmidLegend)
  const style = useMemo(() => getPlasmidStyle(plasmidStyleId), [plasmidStyleId])

  const enzymeCutSites = useMemo(() => (showEnzymes ? allEnzymeCutSites : []), [showEnzymes, allEnzymeCutSites])
  const damMeth = doc.metadata?.damMethylated || false
  const dcmMeth = doc.metadata?.dcmMethylated || false
  const groupedEnzymeSites = useMemo(
    () => groupCutSites(enzymeCutSites, damMeth, dcmMeth),
    [enzymeCutSites, damMeth, dcmMeth],
  )
  const orfResults = useMemo(() => (showOrfs ? allOrfResults : []), [showOrfs, allOrfResults])

  // --- Derived data ---
  const orfCodeId = useEditorStore(s => s.translationCodeId)
  const orfAnnotations = useMemo(
    () => orfResults.map(orf => new Annotation(orfOverlayData(orf, orfCodeId))), [orfResults, orfCodeId])

  const hiddenSet = useMemo(() => new Set(hiddenAnnotationIds), [hiddenAnnotationIds])
  const visibleAnnotations = useMemo(() =>
    hiddenSet.size === 0 ? doc.annotations : doc.annotations.filter(a => !hiddenSet.has(a.id)),
    [doc.annotations, hiddenSet],
  )

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

  const allAnnotations = useMemo(() => {
    const extra = [...orfAnnotations, ...autoAnnotations]
    return extra.length === 0 ? visibleAnnotations : [...visibleAnnotations, ...extra]
  }, [visibleAnnotations, orfAnnotations, autoAnnotations])

  /** Stacked once. Previously recomputed in the draw and in all four handlers,
   *  including on every pointer move. */
  const rings = useMemo(() => stackAnnotations(allAnnotations), [allAnnotations])

  const annById = useMemo(() => {
    const m = new Map<string, Annotation>()
    for (const a of allAnnotations) m.set(a.id, a)
    return m
  }, [allAnnotations])

  const proposalIds = useMemo(() => {
    const s = new Set<string>()
    for (const a of allAnnotations) if (keyFromAutoId(a.id) !== null) s.add(a.id)
    return s
  }, [allAnnotations])

  const pickedIds = useMemo(() => {
    const s = new Set<string>()
    for (const a of allAnnotations) {
      const autoKey = keyFromAutoId(a.id)
      if (autoKey !== null && autoAnnotationPicks.has(autoKey)) { s.add(a.id); continue }
      const orfK = keyFromOrfId(a.id)
      if (orfK !== null && orfPicks.has(orfK)) s.add(a.id)
    }
    return s
  }, [allAnnotations, autoAnnotationPicks, orfPicks])

  const sceneEnzymes: SceneEnzymeGroup[] = useMemo(
    () => groupedEnzymeSites.map(g => ({
      key: enzymeGroupKey(g),
      label: g.label,
      cutPos: g.fwdCut,
      methEffect: g.methEffect,
    })),
    [groupedEnzymeSites],
  )

  const enzymeByKey = useMemo(() => {
    const m = new Map<string, GroupedCutSite>()
    for (const g of groupedEnzymeSites) m.set(enzymeGroupKey(g), g)
    return m
  }, [groupedEnzymeSites])

  // Saved primers and the workbench's unsaved picks, one item per binding site.
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
  /** How many sites the primer behind an item has, for the hover card and menu. */
  const siteCountOf = (item: PrimerItem) =>
    (item.preview ? designPreview.sites : primerSites).get(item.primer.id)?.length ?? 1

  // An unsaved pick is outlined in the accent colour, which is how the map
  // already marks anything picked but not yet in the document.
  const scenePrimers: ScenePrimer[] = useMemo(() => allPrimerItems.map(({ site, annotation, preview }) => ({
    id: annotation.id,
    name: annotation.name,
    start: site.start,
    end: site.end,
    strand: site.strand,
    selected: !!preview,
    color: annotation.color,
    tail5: site.tail5.length > 0,
    tail3: site.tail3.length > 0,
  })), [allPrimerItems])

  /** Scanned once per sequence rather than once per redraw. */
  const methylation = useMemo(
    () => findMethylationSites(doc.sequence.bases, damMeth, dcmMeth),
    [doc.sequence.bases, damMeth, dcmMeth],
  )

  // Guide cuts for the map: a tick where each one cuts, which is what a map
  // is read for. The protospacers themselves are 20 bases on a plasmid-wide
  // circle, so they are left to the sequence view and to the feature rings.
  const showGuides = useEditorStore(s => s.showGuides)
  const guideResults = useEditorStore(s => s.guideResults)
  const crisprNucleaseId = useEditorStore(s => s.crisprNucleaseId)
  const customNucleases = useEditorStore(s => s.customNucleases)
  const drawScope = useEditorStore(s => s.crisprDraw)
  const guidePicks = useEditorStore(s => s.guidePicks)
  const selectedKey = useEditorStore(s => s.selectedGuideKey)
  const sceneGuides = useMemo<SceneGuide[]>(() => {
    if (!showGuides || guideResults.length === 0) return []
    const nuclease = resolveNuclease(crisprNucleaseId, customNucleases)
    if (!nuclease || nuclease.cleaves === 'none') return []
    const circular = doc.sequence.topology === 'circular'
    const scope = drawScope === 'all'
      ? guideResults
      : drawScope === 'picked'
        ? guideResults.filter(c => guidePicks.has(guideKey(c.site)))
        : guideResults.filter(c => guideKey(c.site) === selectedKey)
    return scope.filter(c => !c.site.offEnd).map(c => ({
      key: guideKey(c.site),
      label: guideName(c.site, nuclease),
      cutPos: cutPosition(c.site, doc.sequence.length, circular),
      strand: c.site.strand,
      ...(c.site.cutTop !== c.site.cutBottom ? { secondCut: c.site.cutBottom } : {}),
    }))
  }, [showGuides, guideResults, crisprNucleaseId, customNucleases, drawScope, guidePicks, selectedKey, doc.sequence.length, doc.sequence.topology])

  const gcSeries = useMemo(
    () => (showGcRing ? computeGcSeries(doc.sequence.bases) : null),
    [showGcRing, doc.sequence.bases],
  )

  const gcOverall = useMemo(
    () => (doc.sequence.length > 0 ? gcPercent(doc.sequence.bases) : null),
    [doc.sequence.bases, doc.sequence.length],
  )

  const legend = useMemo(() => {
    if (!showPlasmidLegend) return null
    const seen = new Map<string, string>()
    for (const a of allAnnotations) if (!seen.has(a.type)) seen.set(a.type, a.color)
    return [...seen].slice(0, 12).map(([label, color]) => ({ label, color }))
  }, [showPlasmidLegend, allAnnotations])

  return {
    style, layout, allAnnotations, rings, annById, proposalIds, pickedIds, sceneEnzymes, enzymeByKey, sceneGuides,
    primerSites, designPreview, allPrimerItems, primerItemById, siteCountOf, scenePrimers,
    methylation, gcSeries, gcOverall, legend,
  }
}
