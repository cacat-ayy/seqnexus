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
  sequenceToItem, readToItem, alignmentToItem, readAlignmentToItem, contigToItem, oligoToItem,
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
 * Mirror of App's centre-panel precedence: contig, then read alignment, then
 * sequencing reads, then alignment, then the open document. Keep in step with
 * the chain in App.tsx if that order ever changes.
 */
function resolveOpen(s: {
  contigs: { id: string }[]; activeContigId: string | null
  readAlignments: { id: string }[]; activeReadAlignmentId: string | null
  activeSequencingReadIds: string[]
  alignments: { id: string }[]; activeAlignmentId: string | null
  activeTabId: string | null
}): OpenTarget {
  if (s.activeContigId && s.contigs.some(c => c.id === s.activeContigId)) {
    return { kind: 'contig', id: s.activeContigId }
  }
  if (s.activeReadAlignmentId && s.readAlignments.some(ra => ra.id === s.activeReadAlignmentId)) {
    return { kind: 'read-alignment', id: s.activeReadAlignmentId }
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
  const readAlignments = useEditorStore(s => s.readAlignments)
  const activeReadAlignmentId = useEditorStore(s => s.activeReadAlignmentId)
  const contigs = useEditorStore(s => s.contigs)
  const activeContigId = useEditorStore(s => s.activeContigId)
  const oligos = useEditorStore(s => s.oligos)

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
      contigs, activeContigId,
      readAlignments, activeReadAlignmentId,
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

    // Read alignments owned by a contig are listed inside it, not alongside
    // it. Same rule the old explorer applied, kept so a contig of twelve
    // reads does not also spill twelve rows into the tree.
    const contigOwned = new Set<string>()
    for (const c of contigs) for (const id of c.readAlignmentIds) contigOwned.add(id)

    const byKind: Record<ItemKind, ExplorerItem[]> = {
      'sequence': tabs.map(t => sequenceToItem(t, ctx)),
      'read': sequencingReads.map(r => readToItem(r, ctx)),
      'alignment': alignments.map(a => alignmentToItem(a, ctx)),
      'read-alignment': readAlignments
        .filter(ra => !contigOwned.has(ra.id))
        .map(ra => readAlignmentToItem(ra, ctx)),
      'contig': contigs.map(c => contigToItem(c, ctx)),
      'oligo': oligos.map(o => oligoToItem(o, ctx)),
    }

    const items = [
      ...byKind['sequence'], ...byKind['read'], ...byKind['alignment'],
      ...byKind['read-alignment'], ...byKind['contig'], ...byKind['oligo'],
    ]

    return { items, byKind, byUid: new Map(items.map(i => [i.uid, i])), open }
  }, [
    tabs, activeTabId, sequencingReads, activeSequencingReadIds,
    alignments, activeAlignmentId, readAlignments, activeReadAlignmentId,
    contigs, activeContigId, oligos, oligosBindingOpen,
  ])
}
