/**
 * Builds the explorer's item list from the store.
 *
 * This replaces the 36 separate store subscriptions the old explorer opened at
 * the top of its render: five arrays, five active ids, and one selector per
 * action. Everything the tree needs now arrives as one memoised array.
 */

import { useMemo } from 'react'
import { useEditorStore } from '../store'
import type { ExplorerItem, ItemKind } from './types'
import {
  sequenceToItem, readToItem, alignmentToItem, contigToItem, oligoToItem, gelToItem,
  type AdapterContext, type OpenTarget,
} from './adapters'
import { findBindingSites } from '../primers/binding'

export interface ExplorerItems {
  /** Every visible item, kind order then name. */
  items: ExplorerItem[]
  byKind: Record<ItemKind, ExplorerItem[]>
  byUid: Map<string, ExplorerItem>
  /** Which kind the centre panel is currently showing. */
  open: OpenTarget
}

// No sorting here: `buildNodes` owns the ordering, because sorting has to
// happen inside each group and the groups do not exist yet at this point.

/**
 * Mirror of App's centre-panel precedence: gel, then contig, then read alignment, then
 * sequencing reads, then alignment, then the open document. Keep in step with
 * the chain in App.tsx if that order ever changes.
 */
function resolveOpen(s: {
  gels: { id: string }[]; activeGelId: string | null
  contigs: { id: string }[]; activeContigId: string | null

  activeSequencingReadIds: string[]
  alignments: { id: string }[]; activeAlignmentId: string | null
  activeTabId: string | null
}): OpenTarget {
  if (s.activeGelId && s.gels.some(g => g.id === s.activeGelId)) {
    return { kind: 'gel', id: s.activeGelId }
  }
  if (s.activeContigId && s.contigs.some(c => c.id === s.activeContigId)) {
    return { kind: 'contig', id: s.activeContigId }
  }
  if (s.activeSequencingReadIds.length > 0) {
    return { kind: 'read', id: s.activeSequencingReadIds[0] }
  }
  if (s.activeAlignmentId && s.alignments.some(a => a.id === s.activeAlignmentId)) {
    return { kind: 'alignment', id: s.activeAlignmentId }
  }
  return { kind: 'sequence', id: s.activeTabId }
}

export function useExplorerItems(): ExplorerItems {
  const tabs = useEditorStore(s => s.tabs)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const sequencingReads = useEditorStore(s => s.sequencingReads)
  const activeSequencingReadIds = useEditorStore(s => s.activeSequencingReadIds)
  const alignments = useEditorStore(s => s.alignments)
  const activeAlignmentId = useEditorStore(s => s.activeAlignmentId)
  const contigs = useEditorStore(s => s.contigs)
  const activeContigId = useEditorStore(s => s.activeContigId)
  const oligos = useEditorStore(s => s.oligos)
  const gels = useEditorStore(s => s.gels)
  const activeGelId = useEditorStore(s => s.activeGelId)

  // Which library oligos bind the open sequence. Its own memo, keyed on the
  // bases, so a rename or a star does not re-run the binding search.
  const openDoc = tabs.find(t => t.id === activeTabId)?.doc
  const openBases = oligos.length > 0 ? openDoc?.sequence.bases ?? '' : ''
  const openTopology = openDoc?.sequence.topology ?? 'linear'
  const oligosBindingOpen = useMemo(() => {
    if (!openBases) return new Set<string>()
    const sites = findBindingSites(oligos, openBases, openTopology)
    return new Set([...sites].filter(([, s]) => s.length > 0).map(([id]) => id))
  }, [oligos, openBases, openTopology])

  return useMemo(() => {
    const open = resolveOpen({
      gels, activeGelId,
      contigs, activeContigId,
      activeSequencingReadIds,
      alignments, activeAlignmentId,
      activeTabId,
    })

    const ctx: AdapterContext = {
      open,
      includedReadIds: activeSequencingReadIds,
      tabNameById: new Map(tabs.map(t => [t.id, t.doc.name])),
      oligosBindingOpen,
      openSequenceName: tabs.find(t => t.id === activeTabId)?.doc.name,
    }

    const byKind: Record<ItemKind, ExplorerItem[]> = {
      'sequence': tabs.map(t => sequenceToItem(t, ctx)),
      'read': sequencingReads.map(r => readToItem(r, ctx)),
      'alignment': alignments.map(a => alignmentToItem(a, ctx)),
      'contig': contigs.map(c => contigToItem(c, ctx)),
      'gel': gels.map(g => gelToItem(g, ctx)),
      'oligo': oligos.map(o => oligoToItem(o, ctx)),
    }

    const items = [
      ...byKind['sequence'], ...byKind['read'], ...byKind['alignment'],
      ...byKind['contig'], ...byKind['gel'], ...byKind['oligo'],
    ]

    return { items, byKind, byUid: new Map(items.map(i => [i.uid, i])), open }
  }, [
    tabs, activeTabId, sequencingReads, activeSequencingReadIds,
    alignments, activeAlignmentId,
    contigs, activeContigId, gels, activeGelId, oligos, oligosBindingOpen,
  ])
}
