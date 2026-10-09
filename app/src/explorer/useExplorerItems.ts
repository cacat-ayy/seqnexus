/**
 * Builds the explorer's item list from the store.
 *
 * This replaces the 36 separate store subscriptions the old explorer opened at
 * the top of its render: five arrays, five active ids, and one selector per
 * action. Everything the tree needs now arrives as one memoised array.
 */

import { useMemo } from 'react'
import { useEditorStore, type Assembly, type Contig } from '../store'
import type { ExplorerItem, ItemKind } from './types'
import { documentKind } from './types'
import type { Alphabet } from '../models/alphabet'
import {
  sequenceToItem, readToItem, readSetToItem, alignmentToItem, assemblyToItem, contigToItem, oligoToItem, gelToItem, cloneToItem,
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
 * Mirror of App's centre-panel precedence: clone, gel, contig, assembly
 * overview, sequencing reads, alignment, then the open document. Keep in step
 * with the chain in App.tsx if that order ever changes.
 */
function resolveOpen(s: {
  gels: { id: string }[]; activeGelId: string | null
  clones: { id: string }[]; activeCloneId: string | null
  contigs: { id: string }[]; activeContigId: string | null
  assemblies: { id: string }[]; activeAssemblyId: string | null
  readSets: { id: string }[]; activeReadSetId: string | null
  activeSequencingReadIds: string[]
  alignments: { id: string }[]; activeAlignmentId: string | null
  activeTabId: string | null
  tabs: { id: string; doc: { sequence: { alphabet: Alphabet } } }[]
}): OpenTarget {
  if (s.activeGelId && s.gels.some(g => g.id === s.activeGelId)) {
    return { kind: 'gel', id: s.activeGelId }
  }
  if (s.activeCloneId && s.clones.some(c => c.id === s.activeCloneId)) {
    return { kind: 'clone', id: s.activeCloneId }
  }
  if (s.activeContigId && s.contigs.some(c => c.id === s.activeContigId)) {
    return { kind: 'contig', id: s.activeContigId }
  }
  if (s.activeAssemblyId && s.assemblies.some(a => a.id === s.activeAssemblyId)) {
    return { kind: 'assembly', id: s.activeAssemblyId }
  }
  if (s.activeReadSetId && s.readSets.some(r => r.id === s.activeReadSetId)) {
    return { kind: 'readset', id: s.activeReadSetId }
  }
  if (s.activeSequencingReadIds.length > 0) {
    return { kind: 'read', id: s.activeSequencingReadIds[0] }
  }
  if (s.activeAlignmentId && s.alignments.some(a => a.id === s.activeAlignmentId)) {
    return { kind: 'alignment', id: s.activeAlignmentId }
  }
  const active = s.tabs.find(t => t.id === s.activeTabId)
  return { kind: active ? documentKind(active.doc.sequence.alphabet) : 'sequence', id: s.activeTabId }
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
  const assemblies = useEditorStore(s => s.assemblies)
  const activeAssemblyId = useEditorStore(s => s.activeAssemblyId)
  const readSets = useEditorStore(s => s.readSets)
  const activeReadSetId = useEditorStore(s => s.activeReadSetId)
  const oligos = useEditorStore(s => s.oligos)
  const gels = useEditorStore(s => s.gels)
  const activeGelId = useEditorStore(s => s.activeGelId)
  const clones = useEditorStore(s => s.clones)
  const activeCloneId = useEditorStore(s => s.activeCloneId)

  // The sequence behind each open tab a cloning design draws on, so a design
  // can say when one of its parts has moved on. Only the sequences a design
  // actually uses are looked up, and the strings are passed by reference.
  const liveDoc = useEditorStore(s => s.doc)
  const tabSequenceById = useMemo(() => {
    const map = new Map<string, { bases: string; topology: 'linear' | 'circular' }>()
    if (clones.length === 0) return map
    const needed = new Set(
      clones.flatMap(c => c.design.parts.map(part => part.source?.id).filter((id): id is string => !!id)),
    )
    for (const tab of tabs) {
      if (!needed.has(tab.id)) continue
      const doc = tab.id === activeTabId ? liveDoc : tab.doc
      map.set(tab.id, { bases: doc.sequence.bases, topology: doc.sequence.topology })
    }
    return map
  }, [clones, tabs, activeTabId, liveDoc])

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
      clones, activeCloneId,
      contigs, activeContigId,
      assemblies, activeAssemblyId,
      readSets, activeReadSetId,
      activeSequencingReadIds,
      alignments, activeAlignmentId,
      activeTabId, tabs,
    })

    const contigById = new Map(contigs.map(c => [c.id, c]))
    const contigsOf = (a: Assembly) => a.contigIds.map(id => contigById.get(id)).filter((c): c is Contig => !!c)

    const ctx: AdapterContext = {
      open,
      includedReadIds: activeSequencingReadIds,
      tabNameById: new Map(tabs.map(t => [t.id, t.doc.name])),
      oligosBindingOpen,
      tabSequenceById,
      openSequenceName: tabs.find(t => t.id === activeTabId)?.doc.name,
    }

    const byKind: Record<ItemKind, ExplorerItem[]> = {
      'sequence': tabs.filter(t => t.doc.sequence.alphabet !== 'protein').map(t => sequenceToItem(t, ctx)),
      'protein': tabs.filter(t => t.doc.sequence.alphabet === 'protein').map(t => sequenceToItem(t, ctx)),
      'read': sequencingReads.map(r => readToItem(r, ctx)),
      'readset': readSets.map(r => readSetToItem(r, ctx)),
      'alignment': alignments.map(a => alignmentToItem(a, ctx)),
      'assembly': assemblies.map(a => assemblyToItem(a, contigsOf(a), ctx)),
      // Only an assembly with several shows its contigs as rows.
      'contig': assemblies.flatMap(a => a.contigIds.length > 1 ? contigsOf(a).map(c => contigToItem(c, ctx)) : []),
      'gel': gels.map(g => gelToItem(g, ctx)),
      'clone': clones.map(c => cloneToItem(c, ctx)),
      'oligo': oligos.map(o => oligoToItem(o, ctx)),
    }

    const items = [
      ...byKind['sequence'], ...byKind['protein'], ...byKind['read'], ...byKind['readset'], ...byKind['alignment'],
      ...byKind['assembly'], ...byKind['contig'], ...byKind['gel'], ...byKind['clone'], ...byKind['oligo'],
    ]

    return { items, byKind, byUid: new Map(items.map(i => [i.uid, i])), open }
  }, [
    tabs, activeTabId, sequencingReads, activeSequencingReadIds,
    alignments, activeAlignmentId,
    contigs, activeContigId, assemblies, activeAssemblyId, readSets, activeReadSetId, gels, activeGelId, clones, activeCloneId, oligos, oligosBindingOpen,
    tabSequenceById,
  ])
}
