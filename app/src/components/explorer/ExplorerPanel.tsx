import './explorer.css'
import '../ContextMenuPopup.css'
/**
 * The explorer sidebar.
 *
 * Replaces FileExplorer, which rendered five hand-written sections with five
 * copies of rename, delete and context-menu handling. This owns the panel
 * chrome (width, header, search, dialogs) and delegates the list itself to
 * ExplorerTree over the flat node array from `buildNodes`.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Upload, SlidersHorizontal } from 'lucide-react'
import { useEditorStore, folderSubtree } from '../../store'
import { notify } from '../../toast'
import { concatenate } from '../../msa/edit'
import { useListMultiSelect } from '../../hooks/useListMultiSelect'
import ConfirmDialog, { type ConfirmButton } from '../ConfirmDialog'
import ExplorerToolbar from './ExplorerToolbar'
import ExplorerFilterBar from './ExplorerFilterBar'
import ExplorerTree, { type TreeHandlers } from './ExplorerTree'
import ExplorerContextMenu, {
  type ExplorerMenuTarget, type SelectionCapabilities,
} from './ExplorerContextMenu'
import ExplorerNoteDialog from './ExplorerNoteDialog'
import { OligoExportDialog, OligoImportDialog } from '../primers/OligoDialogs'
import ExplorerTagEditor from './ExplorerTagEditor'
import ExplorerBulkBar from './ExplorerBulkBar'
import ExplorerFolderPicker from './ExplorerFolderPicker'
import ExplorerRecentlyDeleted from './ExplorerRecentlyDeleted'
import ExplorerRail from './ExplorerRail'
import ExplorerHoverCard from './ExplorerHoverCard'
import { useExplorerItems } from '../../explorer/useExplorerItems'
import { useItemActions } from '../../explorer/useItemActions'
import { buildNodes } from '../../explorer/buildNodes'
import { gelsUsingSequences } from '../../gel/workspace'
import { groupSelection } from '../../explorer/selection'
import { ITEM_KINDS, parseUid, type ExplorerItem, type Density, type ItemKind } from '../../explorer/types'
import { DENSITIES } from '../../explorer/types'
import {
  buildFilter, filterCount, toggleIn, NO_FILTERS, type ExplorerFilters,
} from '../../explorer/filters'
import { useTreeKeyboard } from '../../explorer/useTreeKeyboard'
import { useDelayedHover, type HoverTarget } from '../../hooks/useDelayedHover'
import {
  loadExplorerSettings, saveExplorerSettings, clampWidth, SIDEBAR_MIN,
} from '../../utils/explorer-settings'
import type { ExportItemKind } from '../ExportModal'
import { ALN_EXTENSIONS } from '../../msa/formats'

interface Props {
  open: boolean
  onCollapse: () => void
  onExpand: () => void
  onImportFiles?: (files: File[]) => void
  onOpenProperties?: () => void
  onNewSequence?: () => void
  onFetch?: () => void
  onAlignToRef?: (readIds: string | string[]) => void
  onQuickAlign?: (tabIds: string[], readIds?: string[]) => void
  onExportItems?: (items: Partial<Record<ExportItemKind, string[]>>) => void
}

const IMPORT_ACCEPT = ['.gb', '.gbk', '.genbank', '.fasta', '.fa', '.fna', '.fastq', '.fq', '.txt', '.dna', '.geneious', '.ab1', '.abi', '.abif', '.scf', ...ALN_EXTENSIONS].join(',')

/** Stable empty array, so an untagged row's props keep their identity. */
const EMPTY_TAGS: string[] = []

/**
 * The gel lanes that deleting these sequences would take with them, as
 * `2 lanes on "Gel A" and "Gel B"`, or null when no gel uses them. Gels
 * going in the same delete are skipped: their lanes go either way.
 */
function gelLanesAtRisk(
  sequenceIds: readonly string[],
  deletedGelIds: ReadonlySet<string> = new Set(),
): { count: number; phrase: string } | null {
  const gels = useEditorStore.getState().gels.filter(g => !deletedGelIds.has(g.id))
  const usage = gelsUsingSequences(gels, new Set(sequenceIds))
  if (usage.length === 0) return null
  const count = usage.reduce((n, g) => n + g.lanes, 0)
  const names = usage.slice(0, 3).map(g => `"${g.name}"`)
  const others = usage.length - names.length
  const where = others > 0
    ? `${names.join(', ')} and ${others} other gel${others === 1 ? '' : 's'}`
    : names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
  return { count, phrase: `${count} lane${count === 1 ? '' : 's'} on ${where}` }
}

function ExplorerPanel({
  open, onCollapse, onExpand, onImportFiles, onOpenProperties, onNewSequence, onFetch,
  onAlignToRef, onQuickAlign, onExportItems,
}: Props) {
  const folders = useEditorStore(s => s.folders)
  const itemMeta = useEditorStore(s => s.itemMeta)
  const tagColors = useEditorStore(s => s.tagColors)
  const selectedIds = useEditorStore(s => s.explorerSelectedIds)
  const setSelectedIds = useEditorStore(s => s.setExplorerSelectedIds)
  const toggleFolder = useEditorStore(s => s.toggleFolder)
  const renameFolder = useEditorStore(s => s.renameFolder)
  const moveItemToFolder = useEditorStore(s => s.moveItemToFolder)
  const setFolderParent = useEditorStore(s => s.setFolderParent)

  const { items, byKind, byUid, open: openTarget } = useExplorerItems()
  const actions = useItemActions()

  // --- Persisted panel preferences ---
  const [settings, setSettings] = useState(loadExplorerSettings)
  const patchSettings = useCallback((patch: Partial<typeof settings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      saveExplorerSettings(next)
      return next
    })
  }, [])

  const collapsedGroups = useMemo(() => new Set(settings.collapsedGroups), [settings.collapsedGroups])

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<ExplorerFilters>(NO_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [draggingUids, setDraggingUids] = useState<ReadonlySet<string>>(new Set())
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null)
  const [fileDragOver, setFileDragOver] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<ExplorerMenuTarget | null>(null)
  const [noteTarget, setNoteTarget] = useState<ExplorerItem | null>(null)
  const [tagTarget, setTagTarget] = useState<{ item: ExplorerItem; x: number; y: number } | null>(null)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [recentCollapsed, setRecentCollapsed] = useState(true)
  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    buttons: ConfirmButton[]
    onResult: (value: string | null) => void
  } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const fileDragDepth = useRef(0)

  const starred = useMemo(
    () => new Set(Object.entries(itemMeta).filter(([, m]) => m.starred).map(([uid]) => uid)),
    [itemMeta],
  )
  const notes = useMemo(() => {
    const out: Record<string, string | undefined> = {}
    for (const [uid, m] of Object.entries(itemMeta)) if (m.note) out[uid] = m.note
    return out
  }, [itemMeta])
  const tagsByUid = useMemo(() => {
    const out: Record<string, string[] | undefined> = {}
    for (const [uid, m] of Object.entries(itemMeta)) if (m.tags?.length) out[uid] = m.tags
    return out
  }, [itemMeta])
  const allTags = useMemo(
    () => [...new Set(Object.values(tagsByUid).flatMap(t => t ?? []))].sort((a, b) => a.localeCompare(b)),
    [tagsByUid],
  )

  const query = search.toLowerCase().trim()

  /**
   * Everything else a query can match, per uid: notes, tags, description and
   * feature names. Built only when there is a query worth matching, since
   * walking every annotation of every open plasmid is not free.
   */
  const searchText = useMemo(() => {
    if (query.length < 2) return undefined
    const out: Record<string, string> = {}
    for (const item of items) {
      const parts: string[] = []
      const meta = itemMeta[item.uid]
      if (meta?.note) parts.push(meta.note)
      if (meta?.tags?.length) parts.push(meta.tags.join(' '))
      if (item.kind === 'sequence') {
        const tab = useEditorStore.getState().tabs.find(t => t.id === item.id)
        if (tab?.doc.description) parts.push(tab.doc.description)
        // Feature names are the expensive part, so they wait for a query
        // long enough to be worth the walk.
        if (query.length >= 3 && tab) {
          for (const a of tab.doc.annotations) parts.push(a.name)
        }
      }
      if (parts.length > 0) out[item.uid] = parts.join(' ').toLowerCase()
    }
    return out
  }, [query, items, itemMeta])

  const itemFilter = useMemo(
    () => buildFilter(filters, tagsByUid, starred),
    [filters, tagsByUid, starred],
  )

  const { nodes, itemUids, matchCount } = useMemo(
    () => buildNodes({
      byKind, folders, starred, tagsByUid, collapsedGroups, query,
      groupBy: settings.groupBy, sortBy: settings.sortBy, sortDir: settings.sortDir,
      nestDerived: settings.nestDerived,
      searchText, filter: itemFilter,
    }),
    [
      byKind, folders, starred, tagsByUid, collapsedGroups, query,
      settings.groupBy, settings.sortBy, settings.sortDir, settings.nestDerived,
      searchText, itemFilter,
    ],
  )

  // --- Selection ---
  // The open item counts as selected for the first ctrl-click, so ctrl-
  // clicking a second row selects both rather than only the second. With one
  // uid namespace this no longer needs a per-section lookup.
  const openUid = openTarget.id ? `${openTarget.kind}:${openTarget.id}` : null
  const resolveActivePeer = useCallback(() => openUid, [openUid])
  const { handleItemClick } = useListMultiSelect(itemUids, {
    selected: selectedIds,
    onSelectedChange: setSelectedIds,
    resolveActivePeer,
  })

  // Hover previews. The shared delay is what stops a card flashing for every
  // row the pointer sweeps across on its way somewhere else.
  // Destructured because the two callbacks are stable while the wrapper
  // object is not, and the row handlers below are memoised on them.
  const { target: hoverTarget, show: showHover, hide: hideHover } =
    useDelayedHover<HoverTarget & { item: ExplorerItem }>()

  // --- Single delete ---
  // Ahead of the keyboard handlers, so the Delete key goes through it too.
  const deleteItem = useCallback((item: ExplorerItem) => {
    setCtxMenu(null)
    // No confirmation for a single item: every kind lands in the delete
    // buffer now, so the undo in the toast is the safety net. A modal on
    // every delete trained people to dismiss it without reading. The
    // exception is a sequence that gels are made from, since deleting it
    // takes their lanes too, somewhere the user is not looking.
    const atRisk = item.kind === 'sequence' ? gelLanesAtRisk([item.id]) : null
    if (!atRisk) { actions.remove(item); return }
    setConfirmState({
      title: 'Delete Sequence',
      message: `"${item.name}" is used in ${atRisk.phrase}. Deleting it also deletes ${atRisk.count === 1 ? 'that lane' : 'those lanes'}.`,
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Delete', value: 'delete', variant: 'danger' },
      ],
      onResult: value => {
        setConfirmState(null)
        if (value === 'delete') actions.remove(item)
      },
    })
  }, [actions])

  // --- Keyboard navigation ---
  const keyboard = useTreeKeyboard(nodes, useMemo(() => ({
    open: item => actions.open(item),
    toggleStar: uid => actions.toggleStar(uid),
    startRename: node => {
      if (node.type === 'item') setRenamingKey(node.item.uid)
      else if (node.type === 'folder') setRenamingKey(node.folder.id)
    },
    remove: item => deleteItem(item),
    setExpanded: (node, expanded) => {
      if (node.type === 'folder') {
        if (node.folder.collapsed === expanded) toggleFolder(node.folder.id)
      } else if (node.type === 'group') {
        const next = new Set(settings.collapsedGroups)
        if (expanded) next.delete(node.key)
        else next.add(node.key)
        patchSettings({ collapsedGroups: [...next] })
      }
    },
    select: (index, mode) => {
      if (index < 0) { setSelectedIds(new Set()); return }
      const node = nodes[index]
      if (node?.type !== 'item') return
      if (mode === 'replace') setSelectedIds(new Set())
      else if (mode === 'toggle') setSelectedIds(toggleIn(selectedIds, node.item.uid))
      else setSelectedIds(new Set([...selectedIds, node.item.uid]))
    },
  }), [actions, deleteItem, nodes, toggleFolder, settings.collapsedGroups, patchSettings, selectedIds, setSelectedIds]))

  // --- Width and resizing ---
  const resizing = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const width = dragWidth ?? settings.width

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    resizing.current = true
    startX.current = e.clientX
    startWidth.current = width
    setDragWidth(width)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [width])

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return
    // The panel is on the left, so dragging right widens it.
    setDragWidth(clampWidth(startWidth.current + (e.clientX - startX.current)))
  }, [])

  const handleResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return
    resizing.current = false
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    const final = clampWidth(startWidth.current + (e.clientX - startX.current))
    setDragWidth(null)
    patchSettings({ width: final })
  }, [patchSettings])

  // --- Imports ---
  const importFiles = useCallback((files: FileList | null) => {
    if (!files || !onImportFiles) return
    onImportFiles(Array.from(files))
  }, [onImportFiles])

  // --- Deletion ---
  const deleteSelection = useCallback(() => {
    const uids = [...selectedIds]
    const count = uids.length
    if (count === 0) return
    setCtxMenu(null)
    const picked = uids.map(uid => byUid.get(uid)).filter((i): i is ExplorerItem => !!i)
    const seqIds = picked.filter(i => i.kind === 'sequence').map(i => i.id)
    const atRisk = gelLanesAtRisk(seqIds, new Set(picked.filter(i => i.kind === 'gel').map(i => i.id)))
    setConfirmState({
      title: 'Delete Selected',
      message: `Are you sure you want to delete ${count} selected item${count > 1 ? 's' : ''}?`
        + (atRisk
          ? ` ${atRisk.phrase} ${atRisk.count === 1 ? 'uses' : 'use'} the selected sequence${seqIds.length === 1 ? '' : 's'} and will be deleted too.`
          : ''),
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Delete', value: 'delete', variant: 'danger' },
      ],
      onResult: value => {
        setConfirmState(null)
        if (value !== 'delete') return
        for (const uid of uids) {
          const item = byUid.get(uid)
          if (item) actions.removeQuiet(item)
        }
        setSelectedIds(new Set())
        notify.success(`Deleted ${count} item${count === 1 ? '' : 's'}`)
      },
    })
  }, [selectedIds, byUid, actions, setSelectedIds])

  const deleteFolder = useCallback((folderId: string, name: string) => {
    setCtxMenu(null)
    const store = useEditorStore.getState()
    // Counted across the whole subtree, because that is what Delete All
    // takes: a folder that looks empty can still have a full child.
    const subtree = folderSubtree(folders, folderId)
    const contents = folders.filter(f => subtree.has(f.id)).flatMap(f => f.itemUids)
    const count = contents.length
    const parsed = contents.map(parseUid)
    const idsOf = (kind: ItemKind) => parsed.flatMap(p => (p?.kind === kind ? [p.id] : []))
    const atRisk = gelLanesAtRisk(idsOf('sequence'), new Set(idsOf('gel')))
    setConfirmState({
      title: 'Delete Folder',
      message: count > 0
        ? `"${name}" contains ${count} item${count > 1 ? 's' : ''}. What would you like to do?`
          + (atRisk ? ` Delete All also deletes ${atRisk.phrase} made from sequences in it.` : '')
        : `Are you sure you want to delete the folder "${name}"?`,
      buttons: count > 0
        ? [
            { label: 'Cancel', value: 'cancel' },
            { label: 'Keep Contents', value: 'keep', variant: 'primary' },
            { label: 'Delete All', value: 'delete-all', variant: 'danger' },
          ]
        : [
            { label: 'Cancel', value: 'cancel' },
            { label: 'Delete', value: 'keep', variant: 'danger' },
          ],
      onResult: value => {
        setConfirmState(null)
        if (value === 'keep') store.deleteFolder(folderId)
        else if (value === 'delete-all') store.deleteFolderWithContents(folderId)
      },
    })
  }, [folders])

  // --- Primer library ---
  const libraryOligos = useEditorStore(s => s.oligos)
  const [oligoImportOpen, setOligoImportOpen] = useState(false)
  const [oligoExportIds, setOligoExportIds] = useState<string[] | null>(null)

  // --- Export ---
  const exportItems = useCallback((uids: Iterable<string>) => {
    setCtxMenu(null)
    // Oligos have their own formats (CSV, FASTA, order sheet); everything
    // else goes through the sequence export dialog.
    const { oligo: oligoIds, ...grouped } = groupSelection(uids)
    if (oligoIds?.length) setOligoExportIds(oligoIds)
    if (Object.keys(grouped).length === 0) return
    onExportItems?.(grouped)
  }, [onExportItems])

  // --- Selection actions, shared by the context menu and the bulk bar ---
  const runAlignSelected = useCallback(() => {
    setCtxMenu(null)
    const grouped = groupSelection(selectedIds)
    onQuickAlign?.(grouped.sequence ?? [], grouped.read?.length ? grouped.read : undefined)
  }, [selectedIds, onQuickAlign])

  const runAlignSelectedToRef = useCallback(() => {
    setCtxMenu(null)
    onAlignToRef?.(groupSelection(selectedIds).read ?? [])
  }, [selectedIds, onAlignToRef])

  /** Join the selected alignments end to end, in list order, matching rows by name. */
  const runJoinAlignments = useCallback(() => {
    setCtxMenu(null)
    const ids = new Set(groupSelection(selectedIds).alignment ?? [])
    const store = useEditorStore.getState()
    const alns = store.alignments.filter(a => ids.has(a.id))
    if (alns.length < 2) return
    try {
      const doc = alns.slice(1).reduce((acc, a) => concatenate(acc, a.doc, 'name'), alns[0].doc)
      const joined = { ...doc, origin: { method: 'manual' as const, detail: 'Joined alignments', at: Date.now() } }
      store.addAlignment(joined, { name: alns.map(a => a.name).join(' + ') })
      setSelectedIds(new Set())
      notify.success(`Joined ${alns.length} alignments: ${joined.rows.length} rows, ${(joined.rows[0]?.seq.length ?? 0).toLocaleString()} columns`)
    } catch (err) {
      notify.error('Could not join the alignments', { detail: err instanceof Error ? err.message : String(err) })
    }
  }, [selectedIds, setSelectedIds])

  const fileSelectionInto = useCallback((folderId: string | null) => {
    const store = useEditorStore.getState()
    for (const uid of selectedIds) store.moveItemToFolder(uid, folderId)
    setFilePickerOpen(false)
  }, [selectedIds])

  // --- Selection capabilities, for the multi-selection menu ---
  const selectionCaps = useMemo<SelectionCapabilities>(() => {
    const grouped = groupSelection(selectedIds)
    const seqs = grouped.sequence ?? []
    const reads = grouped.read ?? []
    const alns = (grouped.alignment ?? []).map(id => useEditorStore.getState().alignments.find(a => a.id === id)).filter(Boolean)
    return {
      canAlign: seqs.length + reads.length >= 2,
      canAlignToRef: reads.length > 0,
      canJoinAlignments: alns.length >= 2 && new Set(alns.map(a => a!.doc.kind)).size === 1,
      canExport: selectedIds.size > 0,
    }
  }, [selectedIds])

  const tree: TreeHandlers = useMemo(() => ({
    onItemClick: (e, item) => {
      // Ctrl-click on a read adds it to the multi-trace view rather than
      // extending the selection: comparing traces is what that gesture is
      // for here, and it predates the shared selection hook.
      if ((e.ctrlKey || e.metaKey) && item.kind === 'read') {
        e.preventDefault()
        actions.toggleInMultiView(item)
        return
      }
      handleItemClick(e, item.uid, () => actions.open(item))
    },
    onItemContextMenu: (e, item) => {
      e.preventDefault()
      e.stopPropagation()
      setCtxMenu(selectedIds.size > 1 && selectedIds.has(item.uid)
        ? { type: 'selection', count: selectedIds.size, x: e.clientX, y: e.clientY }
        : { type: 'item', item, x: e.clientX, y: e.clientY })
    },
    onToggleStar: uid => actions.toggleStar(uid),
    onOpenMenu: (e, item) => {
      e.preventDefault()
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setCtxMenu({ type: 'item', item, x: rect.right, y: rect.bottom })
    },
    onRenameSubmit: (item, name) => { actions.rename(item, name); setRenamingKey(null) },
    onStartRename: item => setRenamingKey(item.uid),
    onRenameCancel: () => setRenamingKey(null),
    onToggleGroup: key => {
      const next = new Set(settings.collapsedGroups)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      patchSettings({ collapsedGroups: [...next] })
    },
    onToggleFolder: id => toggleFolder(id),
    onFolderContextMenu: (e, folderId, name) => {
      e.preventDefault()
      e.stopPropagation()
      setCtxMenu({ type: 'folder', folderId, name, x: e.clientX, y: e.clientY })
    },
    onFolderRenameSubmit: (folderId, name) => {
      if (name.trim()) renameFolder(folderId, name.trim())
      setRenamingKey(null)
    },
    onStartFolderRename: folderId => setRenamingKey(folderId),
    onDropOnFolder: folderId => {
      // A dragged folder is re-parented; dragged items are filed. Folders
      // hold every kind now, so nothing needs filtering out.
      if (draggingFolderId) {
        setFolderParent(draggingFolderId, folderId)
      } else {
        for (const uid of draggingUids) moveItemToFolder(uid, folderId)
      }
      setDraggingUids(new Set())
      setDraggingFolderId(null)
    },
    onFolderDragStart: id => setDraggingFolderId(id),
    onDragStart: uid => {
      // Dragging a row that is part of a multi-selection drags all of it.
      setDraggingUids(selectedIds.size > 1 && selectedIds.has(uid) ? new Set(selectedIds) : new Set([uid]))
    },
    onDragEnd: () => { setDraggingUids(new Set()); setDraggingFolderId(null) },
    onHover: (item, e) => {
      // Offset to the right of the pointer so the card never covers the row
      // it describes. useClampedPosition flips it back near the edge.
      showHover({ key: item.uid, x: e.clientX + 16, y: e.clientY, item })
    },
    onHoverEnd: () => hideHover(),
  }), [
    actions, handleItemClick, selectedIds, settings.collapsedGroups, patchSettings,
    toggleFolder, renameFolder, moveItemToFolder, setFolderParent, draggingUids, draggingFolderId,
    showHover, hideHover,
  ])

  // Clear the context menu when the underlying item disappears, so a delete
  // from elsewhere cannot leave a menu pointing at nothing.
  useEffect(() => {
    if (ctxMenu?.type === 'item' && !byUid.has(ctxMenu.item.uid)) setCtxMenu(null)
  }, [ctxMenu, byUid])

  // Counted from the items themselves, not from the rendered rows: with every
  // group collapsed there are no rows, and that is not an empty explorer.
  const totalItems = useMemo(
    () => Object.values(byKind).reduce((n, list) => n + list.length, 0),
    [byKind],
  )
  const availableKinds = useMemo(
    () => new Set(ITEM_KINDS.filter(k => byKind[k].length > 0)),
    [byKind],
  )
  const activeFilterCount = filterCount(filters)
  const isEmpty = totalItems === 0 && !query
  // A filter that hides everything reads as an empty explorer unless it says
  // otherwise, which is the whole reason filters are not persisted.
  const noMatches = !isEmpty && matchCount === 0 && (query !== '' || activeFilterCount > 0)

  const menuItem = ctxMenu?.type === 'item' ? ctxMenu.item : null

  const railCounts = useMemo(
    () => Object.fromEntries(ITEM_KINDS.map(k => [k, byKind[k].length])) as Record<ItemKind, number>,
    [byKind],
  )

  if (!open) {
    return (
      <ExplorerRail
        counts={railCounts}
        starredCount={starred.size}
        openKind={openTarget.id ? openTarget.kind : null}
        onExpand={group => {
          // Expanding straight to a group is the point of the rail, so a
          // collapsed target is opened rather than silently ignored.
          if (group && collapsedGroups.has(group)) {
            patchSettings({ collapsedGroups: settings.collapsedGroups.filter(k => k !== group) })
          }
          onExpand()
        }}
      />
    )
  }

  return (
    <aside
      className={`explorer-sidebar ${open ? '' : 'collapsed'}`}
      // Width only. The upper bound is a stylesheet rule so the narrow
      // viewport media queries can tighten it without the inline style
      // winning, and without overwriting the user's saved preference.
      style={{ width }}
      onDragEnter={e => {
        if (!e.dataTransfer.types.includes('Files')) return
        fileDragDepth.current++
        setFileDragOver(true)
      }}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDragLeave={() => {
        // Counted, because dragleave also fires when crossing child elements.
        fileDragDepth.current = Math.max(0, fileDragDepth.current - 1)
        if (fileDragDepth.current === 0) setFileDragOver(false)
      }}
      onDrop={e => {
        fileDragDepth.current = 0
        setFileDragOver(false)
        if (!e.dataTransfer.files?.length) return
        e.preventDefault()
        importFiles(e.dataTransfer.files)
      }}
    >
      <ExplorerToolbar
        density={settings.density}
        groupBy={settings.groupBy}
        sortBy={settings.sortBy}
        sortDir={settings.sortDir}
        nestDerived={settings.nestDerived}
        onCycleDensity={() => {
          const i = DENSITIES.indexOf(settings.density)
          patchSettings({ density: DENSITIES[(i + 1) % DENSITIES.length] as Density })
        }}
        onGroupBy={mode => patchSettings({ groupBy: mode })}
        onSort={(by, dir) => patchSettings({ sortBy: by, sortDir: dir })}
        onToggleNestDerived={() => patchSettings({ nestDerived: !settings.nestDerived })}
        onNewSequence={() => onNewSequence?.()}
        onAddOligos={() => setOligoImportOpen(true)}
        onNewFolder={() => useEditorStore.getState().createFolder('New Folder')}
        onFetch={() => onFetch?.()}
        onPickFiles={() => fileInputRef.current?.click()}
        onPickFolder={() => folderInputRef.current?.click()}
        onCollapse={onCollapse}
      />

      <div className="ex-search-wrap">
        <input
          className="ex-search"
          type="text"
          placeholder="Search names, notes, tags, features…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button className="ex-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
            &times;
          </button>
        )}
        <button
          className={`ex-filter-btn ${filtersOpen ? 'open' : ''} ${activeFilterCount > 0 ? 'active' : ''}`}
          title={activeFilterCount > 0 ? `${activeFilterCount} filters active` : 'Filter'}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(o => !o)}
        >
          <SlidersHorizontal size={12} />
          {activeFilterCount > 0 && <span className="ex-filter-count">{activeFilterCount}</span>}
        </button>
      </div>

      {filtersOpen && (
        <ExplorerFilterBar
          filters={filters}
          onChange={setFilters}
          availableKinds={availableKinds}
          allTags={allTags}
          tagColors={tagColors}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={IMPORT_ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={e => { importFiles(e.target.files); e.target.value = '' }}
      />
      <input
        ref={folderInputRef}
        type="file"
        /* @ts-expect-error webkitdirectory is non-standard but widely supported */
        webkitdirectory=""
        multiple
        style={{ display: 'none' }}
        onChange={e => { importFiles(e.target.files); e.target.value = '' }}
      />

      <ExplorerRecentlyDeleted
        collapsed={recentCollapsed}
        onToggle={() => setRecentCollapsed(c => !c)}
      />

      {isEmpty ? (
        <div className="ex-blank">
          <div className="ex-blank-text">Nothing open yet.<br />Drop files here, or:</div>
          <div className="ex-blank-actions">
            <button className="ex-blank-btn" onClick={() => fileInputRef.current?.click()}>Import files</button>
            <button className="ex-blank-btn" onClick={() => onFetch?.()}>Fetch from NCBI</button>
            <button className="ex-blank-btn" onClick={() => onNewSequence?.()}>New sequence</button>
          </div>
        </div>
      ) : noMatches ? (
        <div className="ex-no-matches">No matches</div>
      ) : (
        <ExplorerTree
          nodes={nodes}
          density={settings.density}
          selected={selectedIds}
          starred={starred}
          tagsByUid={tagsByUid}
          tagColors={tagColors}
          renamingKey={renamingKey}
          draggingUids={draggingUids}
          handlers={tree}
          scrollToUid={openUid}
          focusIndex={keyboard.focusIndex}
          onKeyDown={keyboard.onKeyDown}
          onFocusIndex={keyboard.setFocusIndex}
        />
      )}

      {selectedIds.size > 1 && (
        <ExplorerBulkBar
          count={selectedIds.size}
          selection={selectionCaps}
          has={{
            exportItems: !!onExportItems,
            alignToRef: !!onAlignToRef,
            quickAlign: !!onQuickAlign,
          }}
          hasFolders={folders.length > 0}
          onAlignSelected={runAlignSelected}
          onAlignToRef={runAlignSelectedToRef}
          onJoinAlignments={runJoinAlignments}
          onFile={() => setFilePickerOpen(true)}
          onExport={() => exportItems(selectedIds)}
          onDelete={deleteSelection}
          onClear={() => setSelectedIds(new Set())}
        />
      )}

      {hoverTarget && !ctxMenu && (
        <ExplorerHoverCard
          item={hoverTarget.item}
          x={hoverTarget.x}
          y={hoverTarget.y}
          note={notes[hoverTarget.item.uid]}
          tags={tagsByUid[hoverTarget.item.uid] ?? EMPTY_TAGS}
          tagColors={tagColors}
        />
      )}

      {fileDragOver && (
        <div className="ex-drop-overlay"><Upload size={14} /> Drop to import</div>
      )}

      <div
        className={`ex-resize-handle ${dragWidth !== null ? 'dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        onDoubleClick={() => patchSettings({ width: SIDEBAR_MIN })}
      />

      {ctxMenu && (
        <ExplorerContextMenu
          target={ctxMenu}
          starred={menuItem ? starred.has(menuItem.uid) : false}
          selection={selectionCaps}
          has={{
            properties: !!onOpenProperties,
            exportItems: !!onExportItems,
            alignToRef: !!onAlignToRef,
            quickAlign: !!onQuickAlign,
          }}
          onClose={() => setCtxMenu(null)}
          onRename={() => {
            setRenamingKey(ctxMenu.type === 'folder' ? ctxMenu.folderId : menuItem?.uid ?? null)
            setCtxMenu(null)
          }}
          onDuplicate={() => { if (menuItem) actions.duplicate(menuItem); setCtxMenu(null) }}
          onProperties={() => {
            if (menuItem) actions.open(menuItem)
            setCtxMenu(null)
            onOpenProperties?.()
          }}
          onExport={() => exportItems(ctxMenu.type === 'selection' ? selectedIds : menuItem ? [menuItem.uid] : [])}
          onDelete={() => {
            if (ctxMenu.type === 'selection') deleteSelection()
            else if (ctxMenu.type === 'folder') deleteFolder(ctxMenu.folderId, ctxMenu.name)
            else if (menuItem) deleteItem(menuItem)
          }}
          onToggleStar={() => { if (menuItem) actions.toggleStar(menuItem.uid); setCtxMenu(null) }}
          onEditNote={() => { setNoteTarget(menuItem); setCtxMenu(null) }}
          onEditTags={() => {
            if (menuItem) setTagTarget({ item: menuItem, x: ctxMenu.x, y: ctxMenu.y })
            setCtxMenu(null)
          }}
          onAlignToRef={() => {
            setCtxMenu(null)
            if (ctxMenu.type === 'selection') runAlignSelectedToRef()
            else if (menuItem) onAlignToRef?.(menuItem.id)
          }}
          onAlignSelected={runAlignSelected}
          onJoinAlignments={runJoinAlignments}
        />
      )}

      <ExplorerFolderPicker
        open={filePickerOpen}
        count={selectedIds.size}
        folders={folders}
        onPick={fileSelectionInto}
        onCancel={() => setFilePickerOpen(false)}
      />

      {tagTarget && (
        <ExplorerTagEditor
          x={tagTarget.x}
          y={tagTarget.y}
          itemName={tagTarget.item.name}
          active={tagsByUid[tagTarget.item.uid] ?? []}
          all={allTags}
          colors={tagColors}
          onToggle={tag => {
            const store = useEditorStore.getState()
            const has = (store.itemMeta[tagTarget.item.uid]?.tags ?? []).includes(tag)
            if (has) store.removeTag(tagTarget.item.uid, tag)
            else store.addTag(tagTarget.item.uid, tag)
          }}
          onCreate={tag => useEditorStore.getState().addTag(tagTarget.item.uid, tag)}
          onSetColor={(tag, color) => useEditorStore.getState().setTagColor(tag, color)}
          onClose={() => setTagTarget(null)}
        />
      )}

      {noteTarget && (
        <ExplorerNoteDialog
          open
          itemName={noteTarget.name}
          initialNote={notes[noteTarget.uid] ?? ''}
          onCancel={() => setNoteTarget(null)}
          onSave={note => {
            useEditorStore.getState().setItemNote(noteTarget.uid, note)
            setNoteTarget(null)
          }}
        />
      )}

      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        buttons={confirmState?.buttons ?? []}
        onResult={confirmState?.onResult ?? (() => {})}
      />

      <OligoImportDialog
        open={oligoImportOpen}
        onClose={() => setOligoImportOpen(false)}
        onImport={list => {
          setOligoImportOpen(false)
          const ids = useEditorStore.getState().addLibraryOligos(list)
          notify.success(ids.length === list.length
            ? `Added ${ids.length} oligo${ids.length === 1 ? '' : 's'} to the library`
            : `Added ${ids.length}; ${list.length - ids.length} were already in the library`)
        }}
      />
      <OligoExportDialog
        open={oligoExportIds !== null}
        onClose={() => setOligoExportIds(null)}
        oligos={libraryOligos.filter(o => oligoExportIds?.includes(o.id))}
        baseName="oligos"
      />
    </aside>
  )
}

/**
 * Memoised. App re-renders on every dialog toggle and every toast, and this
 * panel subscribes to enough of the store to be worth stopping at its own
 * boundary. App.perf.test.tsx guards that the props it is handed stay stable.
 */
export default memo(ExplorerPanel)
