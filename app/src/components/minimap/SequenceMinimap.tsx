/**
 * The sequence view's overview: restriction sites, feature lanes around a
 * backbone and a GC profile, positioned in display coordinates (respecting a
 * moved origin).
 *
 * Hover is shared both ways with the main view: pointing at a feature or a
 * cut site here highlights it there, and the reverse.
 */

import { useCallback, useMemo, useRef } from 'react'
import { useEditorStore, selectionSegments } from '../../store'
import { displayPosition } from '../../models/Document'
import type { IntervalTree } from '../../models/IntervalTree'
import { enzymeGroupKey, type GroupedCutSite } from '../../enzymes/grouping'
import Minimap from './Minimap'
import type { MinimapTrack } from './types'
import type { ViewportSource } from './viewport'
import { buildGcIndex } from './geometry'
import { featureTrack } from './tracks/features'
import { gcTrack } from './tracks/gc'
import { cutSiteTrack, toCutMarks, ENZYME_ITEM_PREFIX } from './tracks/cutSites'
import { markerTrack } from './tracks/markers'

interface Props {
  /** Everything the main view lays out: features, ORFs, primers, proposals. */
  annTree: IntervalTree
  /** Cut sites as the main view groups them; null while enzymes are hidden. */
  enzymeGroups: readonly GroupedCutSite[] | null
  hoveredEnzymeGroup: GroupedCutSite | null
  onHoverEnzymeGroup: (group: GroupedCutSite | null) => void
  viewport: ViewportSource
  onNavigate: (start: number) => void
}

export default function SequenceMinimap({
  annTree, enzymeGroups, hoveredEnzymeGroup, onHoverEnzymeGroup, viewport, onNavigate,
}: Props) {
  const sequence = useEditorStore(s => s.doc.sequence)
  const displayOrigin = useEditorStore(s => s.doc.metadata?.displayOrigin)
  const selection = useEditorStore(s => s.selection)
  const hoveredAnnotationId = useEditorStore(s => s.hoveredAnnotationId)
  const setHoveredAnnotation = useEditorStore(s => s.setHoveredAnnotation)

  const seqLen = sequence.length
  const origin = (sequence.topology === 'circular' ? displayOrigin : 0) || 0

  const formatPosition = useCallback(
    (pos: number) => displayPosition(Math.min(seqLen - 1, Math.max(0, Math.floor(pos))), origin, seqLen).toLocaleString(),
    [origin, seqLen],
  )
  const formatRange = useCallback(
    (start: number, end: number) => `${formatPosition(start)}–${formatPosition((end - 1 + seqLen) % seqLen)}`,
    [formatPosition, seqLen],
  )

  const groupByKey = useMemo(
    () => new Map((enzymeGroups ?? []).map(g => [enzymeGroupKey(g), g])),
    [enzymeGroups],
  )
  const cutMarks = useMemo(() => enzymeGroups && toCutMarks(enzymeGroups, seqLen), [enzymeGroups, seqLen])

  // Find hits as ticks, so the whole sequence shows where the matches are
  // and the user can jump between clusters of them.
  const searchMatches = useEditorStore(s => s.search.matches)
  const searchTrack = useMemo(() => {
    if (searchMatches.length === 0) return null
    const [s0, e0] = searchMatches[0]
    return markerTrack('search-hits', [{
      label: 'Find hit',
      positions: searchMatches.map(m => m[0]),
      width: Math.max(1, e0 - s0),
      color: t => t.warning,
    }])
  }, [searchMatches])

  const gcIndex = useMemo(() => buildGcIndex(sequence.bases), [sequence.bases])
  const tracks = useMemo(() => {
    const out: MinimapTrack[] = []
    if (cutMarks) out.push(cutSiteTrack(cutMarks, formatPosition))
    out.push(featureTrack({ features: annTree.all(), formatRange }))
    if (searchTrack) out.push(searchTrack)
    out.push(gcTrack(gcIndex))
    return out
  }, [cutMarks, annTree, formatPosition, formatRange, gcIndex, searchTrack])

  const segments = useMemo(
    () => selectionSegments(selection, sequence.topology, seqLen),
    [selection, sequence.topology, seqLen],
  )

  // Route the hovered item to whichever store owns its kind, clearing only
  // what this minimap set itself.
  const lastHover = useRef<string | null>(null)
  const handleHoverItem = useCallback((id: string | null) => {
    const prev = lastHover.current
    lastHover.current = id
    const isEnzyme = (x: string | null) => !!x && x.startsWith(ENZYME_ITEM_PREFIX)
    if (isEnzyme(prev) && !isEnzyme(id)) onHoverEnzymeGroup(null)
    if (prev && !isEnzyme(prev) && (!id || isEnzyme(id))) setHoveredAnnotation(null)
    if (isEnzyme(id)) onHoverEnzymeGroup(groupByKey.get(id!.slice(ENZYME_ITEM_PREFIX.length)) ?? null)
    else if (id) setHoveredAnnotation(id)
  }, [groupByKey, onHoverEnzymeGroup, setHoveredAnnotation])

  const highlightId = hoveredEnzymeGroup
    ? ENZYME_ITEM_PREFIX + enzymeGroupKey(hoveredEnzymeGroup)
    : hoveredAnnotationId

  return (
    <Minimap
      kind="sequence"
      length={seqLen}
      tracks={tracks}
      viewport={viewport}
      onNavigate={onNavigate}
      selection={segments}
      formatPosition={formatPosition}
      highlightId={highlightId}
      onHoverItem={handleHoverItem}
      ariaLabel="Sequence overview"
    />
  )
}
