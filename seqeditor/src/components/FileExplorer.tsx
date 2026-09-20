import './FileExplorer.css'
import './ContextMenuPopup.css'
/**
 * File explorer sidebar with search and collapsible folders.
 *
 * Files not assigned to any folder appear under "Ungrouped" at the root.
 * Users can create folders, drag files into them, and search across all files.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useEditorStore, type ExplorerFolder } from '../store'
import ConfirmDialog, { type ConfirmButton } from './ConfirmDialog'
import {
  Circle, Ruler, X, Folder, Dna,
  Plus, ChevronRight, ChevronDown,
  Copy, Pencil, Trash2, Activity, AlignLeft, ArrowRightLeft, Download, Layers,
} from 'lucide-react'

interface FileExplorerProps {
  onImportFile?: (file: File) => void
  onOpenProperties?: () => void
  onOpenInfo?: () => void
  onAlignToRef?: (readIds: string | string[]) => void
  onQuickAlign?: (tabIds: string[], readIds?: string[]) => void
  /** Called with item IDs grouped by kind to export. Opens the export modal in App. */
  onExportItems?: (items: Partial<Record<import('./ExportModal').ExportItemKind, string[]>>) => void
}

export default function FileExplorer({ onImportFile, onOpenProperties, onOpenInfo, onAlignToRef, onQuickAlign, onExportItems }: FileExplorerProps) {
  const tabs = useEditorStore(s => s.tabs)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const setActiveTab = useEditorStore(s => s.setActiveTab)
  const closeTab = useEditorStore(s => s.closeTab)
  const renameTab = useEditorStore(s => s.renameTab)
  const folders = useEditorStore(s => s.folders)
  const renameFolder = useEditorStore(s => s.renameFolder)
  const deleteFolder = useEditorStore(s => s.deleteFolder)
  const toggleFolder = useEditorStore(s => s.toggleFolder)
  const moveTabToFolder = useEditorStore(s => s.moveTabToFolder)

  const [search, setSearch] = useState('')
  const duplicateTab = useEditorStore(s => s.duplicateTab)
  const deleteFolderWithContents = useEditorStore(s => s.deleteFolderWithContents)

  // Sequencing reads
  const sequencingReads = useEditorStore(s => s.sequencingReads)
  const activeSequencingReadIds = useEditorStore(s => s.activeSequencingReadIds)
  const setActiveSequencingRead = useEditorStore(s => s.setActiveSequencingRead)
  const toggleSequencingRead = useEditorStore(s => s.toggleSequencingRead)
  const removeSequencingRead = useEditorStore(s => s.removeSequencingRead)
  const renameSequencingRead = useEditorStore(s => s.renameSequencingRead)
  const [seqSectionCollapsed, setSeqSectionCollapsed] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('seqnexus:fe-sections') ?? '{}').seq ?? false } catch { return false }
  })

  // Alignments
  const alignments = useEditorStore(s => s.alignments)
  const activeAlignmentId = useEditorStore(s => s.activeAlignmentId)
  const setActiveAlignment = useEditorStore(s => s.setActiveAlignment)
  const removeAlignment = useEditorStore(s => s.removeAlignment)
  const renameAlignment = useEditorStore(s => s.renameAlignment)
  const [alignSectionCollapsed, setAlignSectionCollapsed] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('seqnexus:fe-sections') ?? '{}').align ?? false } catch { return false }
  })

  // Read alignments
  const readAlignments = useEditorStore(s => s.readAlignments)
  const activeReadAlignmentId = useEditorStore(s => s.activeReadAlignmentId)
  const setActiveReadAlignment = useEditorStore(s => s.setActiveReadAlignment)
  const removeReadAlignment = useEditorStore(s => s.removeReadAlignment)
  const renameReadAlignment = useEditorStore(s => s.renameReadAlignment)
  const [readAlignSectionCollapsed, setReadAlignSectionCollapsed] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('seqnexus:fe-sections') ?? '{}').readAlign ?? false } catch { return false }
  })

  // Contigs
  const contigs = useEditorStore(s => s.contigs)
  const activeContigId = useEditorStore(s => s.activeContigId)
  const setActiveContig = useEditorStore(s => s.setActiveContig)
  const removeContig = useEditorStore(s => s.removeContig)
  const renameContig = useEditorStore(s => s.renameContig)
  const addContig = useEditorStore(s => s.addContig)
  const [contigSectionCollapsed, setContigSectionCollapsed] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('seqnexus:fe-sections') ?? '{}').contig ?? false } catch { return false }
  })

  // Persist section collapse states
  useEffect(() => {
    try {
      localStorage.setItem('seqnexus:fe-sections', JSON.stringify({
        seq: seqSectionCollapsed, align: alignSectionCollapsed,
        readAlign: readAlignSectionCollapsed, contig: contigSectionCollapsed,
      }))
    } catch { /* quota */ }
  }, [seqSectionCollapsed, alignSectionCollapsed, readAlignSectionCollapsed, contigSectionCollapsed])

  // Read alignment IDs owned by contigs (hidden from standalone list)
  const contigOwnedRaIds = useMemo(() => {
    const ids = new Set<string>()
    for (const c of contigs) {
      for (const raId of c.readAlignmentIds) ids.add(raId)
    }
    return ids
  }, [contigs])

  // Standalone read alignments (not owned by any contig)
  const standaloneReadAlignments = useMemo(
    () => readAlignments.filter(ra => !contigOwnedRaIds.has(ra.id)),
    [readAlignments, contigOwnedRaIds]
  )

  const seqFileInputRef = useRef<HTMLInputElement>(null)

  // Multi-selection state (shared via store so toolbar can read it)
  const selectedIds = useEditorStore(s => s.explorerSelectedIds)
  const setSelectedIds = useEditorStore(s => s.setExplorerSelectedIds)
  const lastClickedId = useRef<string | null>(null)

  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [dragTabId, setDragTabId] = useState<string | null>(null)
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const autoScrollRaf = useRef<number>(0)

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{
    type: 'file' | 'folder'
    id: string
    name: string
    x: number
    y: number
  } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  // Confirm dialog state
  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    buttons: ConfirmButton[]
    onResult: (value: string | null) => void
  } | null>(null)

  // Close context menu on outside click or scroll
  useEffect(() => {
    if (!ctxMenu) return
    let downOutside = false
    const handleDown = (e: MouseEvent) => {
      downOutside = !ctxMenuRef.current?.contains(e.target as Node)
    }
    const handleUp = (e: MouseEvent) => {
      if (downOutside && !ctxMenuRef.current?.contains(e.target as Node)) {
        setCtxMenu(null)
      }
      downOutside = false
    }
    const closeScroll = () => setCtxMenu(null)
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('mouseup', handleUp)
    document.addEventListener('scroll', closeScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('mouseup', handleUp)
      document.removeEventListener('scroll', closeScroll, true)
    }
  }, [ctxMenu])

  // Clamp context menu to viewport after it renders
  useEffect(() => {
    if (!ctxMenu || !ctxMenuRef.current) return
    const el = ctxMenuRef.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let { x, y } = ctxMenu
    if (rect.bottom > vh) y = Math.max(4, vh - rect.height - 4)
    if (rect.right > vw) x = Math.max(4, vw - rect.width - 4)
    if (x !== ctxMenu.x || y !== ctxMenu.y) {
      el.style.left = `${x}px`
      el.style.top = `${y}px`
    }
  }, [ctxMenu])

  // Tabs that belong to a folder
  const assignedTabIds = useMemo(() => {
    const ids = new Set<string>()
    for (const f of folders) {
      for (const id of f.tabIds) ids.add(id)
    }
    return ids
  }, [folders])

  // Tabs not in any folder
  const rootTabs = useMemo(
    () => tabs.filter(t => !assignedTabIds.has(t.id))
      .sort((a, b) => a.doc.name.localeCompare(b.doc.name)),
    [tabs, assignedTabIds],
  )

  // Search filter
  const query = search.toLowerCase().trim()
  const matchesSearch = useCallback(
    (name: string) => !query || name.toLowerCase().includes(query),
    [query],
  )

  // When searching: include files whose name matches OR that belong to a
  // folder whose name matches. Also track which folders matched by name
  // so we can show them with all their children.
  const { filteredTabs, matchedFolderIds } = useMemo(() => {
    if (!query) return { filteredTabs: null, matchedFolderIds: new Set<string>() }
    const folderMatches = new Set<string>()
    for (const f of folders) {
      if (f.name.toLowerCase().includes(query)) folderMatches.add(f.id)
    }
    // Tabs in a matched folder are included regardless of their own name
    const tabsInMatchedFolders = new Set<string>()
    for (const f of folders) {
      if (folderMatches.has(f.id)) {
        for (const id of f.tabIds) tabsInMatchedFolders.add(id)
      }
    }
    const result = tabs.filter(t =>
      matchesSearch(t.doc.name) || tabsInMatchedFolders.has(t.id)
    )
    return { filteredTabs: result, matchedFolderIds: folderMatches }
  }, [tabs, query, matchesSearch, folders])

  // Flat ordered list of all selectable item IDs (for shift-click range selection)
  const flatItemIds = useMemo(() => {
    const ids: string[] = []
    // Folders and their children
    for (const f of folders) {
      for (const tabId of f.tabIds) {
        if (tabs.some(t => t.id === tabId)) ids.push(tabId)
      }
    }
    // Root tabs
    for (const t of rootTabs) ids.push(t.id)
    // Sequencing reads
    for (const r of sequencingReads) ids.push(`seq_${r.id}`)
    // Alignments
    for (const a of alignments) ids.push(a.id)
    // Read alignments (standalone only)
    for (const ra of standaloneReadAlignments) ids.push(ra.id)
    // Contigs
    for (const c of contigs) ids.push(c.id)
    return ids
  }, [folders, tabs, rootTabs, sequencingReads, alignments, standaloneReadAlignments, contigs])

  // Clear selection when items are removed
  useEffect(() => {
    if (selectedIds.size === 0) return
    const validIds = new Set(flatItemIds)
    const pruned = new Set([...selectedIds].filter(id => validIds.has(id)))
    if (pruned.size !== selectedIds.size) setSelectedIds(pruned)
  }, [flatItemIds, selectedIds])

  /** Handle click with multi-select modifiers (Ctrl/Cmd, Shift). */
  const handleItemClick = useCallback((e: React.MouseEvent, itemId: string, activateFn: () => void) => {
    if (e.ctrlKey || e.metaKey) {
      // Toggle individual item in selection, auto-include the currently active item from the same section
      setSelectedIds(prev => {
        const next = new Set(prev)
        if (next.has(itemId)) next.delete(itemId)
        else next.add(itemId)
        // If this is the first ctrl-click, also include the currently active item
        if (prev.size === 0) {
          let currentId: string | null = null
          if (itemId.startsWith('seq_')) {
            // Sequencing section — include the last active read
            if (activeSequencingReadIds.length > 0) currentId = `seq_${activeSequencingReadIds[activeSequencingReadIds.length - 1]}`
          } else if (itemId.startsWith('align_')) {
            if (activeAlignmentId) currentId = activeAlignmentId
          } else if (itemId.startsWith('readalign_')) {
            if (activeReadAlignmentId) currentId = activeReadAlignmentId
          } else if (itemId.startsWith('contig_')) {
            if (activeContigId) currentId = activeContigId
          } else {
            currentId = activeTabId || null
          }
          if (currentId && currentId !== itemId) next.add(currentId)
        }
        return next
      })
      lastClickedId.current = itemId
    } else if (e.shiftKey && lastClickedId.current) {
      // Range select from last clicked to current
      const startIdx = flatItemIds.indexOf(lastClickedId.current)
      const endIdx = flatItemIds.indexOf(itemId)
      if (startIdx !== -1 && endIdx !== -1) {
        const lo = Math.min(startIdx, endIdx)
        const hi = Math.max(startIdx, endIdx)
        setSelectedIds(prev => {
          const next = new Set(prev)
          for (let i = lo; i <= hi; i++) next.add(flatItemIds[i])
          return next
        })
      }
    } else {
      // Plain click – clear selection, activate item
      setSelectedIds(new Set())
      lastClickedId.current = itemId
      activateFn()
    }
  }, [flatItemIds, activeTabId, activeSequencingReadIds, activeAlignmentId, activeReadAlignmentId, activeContigId])

  /** Delete all selected items after confirmation. */
  const handleBulkDelete = useCallback(() => {
    const count = selectedIds.size
    if (count === 0) return
    setCtxMenu(null)
    setConfirmState({
      title: 'Delete Selected',
      message: `Are you sure you want to delete ${count} selected item${count > 1 ? 's' : ''}?`,
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Delete', value: 'delete', variant: 'danger' },
      ],
      onResult: (value) => {
        if (value === 'delete') {
          for (const id of selectedIds) {
            if (id.startsWith('seq_')) removeSequencingRead(id.slice(4))
            else if (id.startsWith('align_')) removeAlignment(id)
            else if (id.startsWith('readalign_')) removeReadAlignment(id)
            else if (id.startsWith('contig_')) removeContig(id)
            else closeTab(id)
          }
          setSelectedIds(new Set())
        }
        setConfirmState(null)
      },
    })
  }, [selectedIds, closeTab, removeSequencingRead, removeAlignment, removeReadAlignment, removeContig])

  /** Export all selected items, grouped by kind. */
  const handleBulkExport = useCallback(() => {
    setCtxMenu(null)
    const items: Partial<Record<import('./ExportModal').ExportItemKind, string[]>> = {}
    const seqIds = tabs.filter(t => selectedIds.has(t.id)).map(t => t.id)
    if (seqIds.length > 0) items.sequence = seqIds
    const readIds = [...selectedIds].filter(id => id.startsWith('seq_'))
    if (readIds.length > 0) items.read = readIds
    const alignIds = [...selectedIds].filter(id => id.startsWith('align_'))
    if (alignIds.length > 0) items.alignment = alignIds
    const raIds = [...selectedIds].filter(id => id.startsWith('readalign_'))
    if (raIds.length > 0) items['read-alignment'] = raIds
    const cIds = [...selectedIds].filter(id => id.startsWith('contig_'))
    if (cIds.length > 0) items.contig = cIds
    if (Object.keys(items).length === 0) return
    onExportItems?.(items)
  }, [selectedIds, tabs, onExportItems])

  const handleImportFiles = useCallback((files: FileList | null) => {
    if (!files || !onImportFile) return
    for (const f of Array.from(files)) {
      onImportFile(f)
    }
  }, [onImportFile])

  const handleFolderRenameSubmit = useCallback((folderId: string) => {
    const name = editingName.trim()
    if (name) renameFolder(folderId, name)
    setEditingFolderId(null)
  }, [editingName, renameFolder])

  const handleTabRenameSubmit = useCallback((tabId: string) => {
    const name = editingName.trim()
    if (name) renameTab(tabId, name)
    setEditingTabId(null)
  }, [editingName, renameTab])

  // Refs so drop handlers always see the latest drag state without
  // needing it as a dependency (which would recreate handlers and break
  // memoisation).
  const dragTabIdsRef = useRef<string[]>([])

  const handleDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    // If the dragged tab is part of a multi-selection, drag all selected tabs
    const sel = useEditorStore.getState().explorerSelectedIds
    const tabIds = sel.size > 1 && sel.has(tabId)
      ? tabs.filter(t => sel.has(t.id)).map(t => t.id)
      : [tabId]
    setDragTabId(tabId)
    dragTabIdsRef.current = tabIds
    e.dataTransfer.setData('application/x-seqnexus-tab', tabIds.join(','))
    e.dataTransfer.effectAllowed = 'move'
  }, [tabs])

  const isInternalDrag = useCallback((e: React.DragEvent) => {
    return e.dataTransfer.types.includes('application/x-seqnexus-tab')
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    if (!isInternalDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverTarget(targetId)
  }, [isInternalDrag])

  const handleDragLeave = useCallback(() => {
    setDragOverTarget(null)
  }, [])

  const handleDropOnFolder = useCallback((e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    e.stopPropagation()
    for (const id of dragTabIdsRef.current) {
      moveTabToFolder(id, folderId)
    }
    setDragTabId(null)
    dragTabIdsRef.current = []
    setDragOverTarget(null)
  }, [moveTabToFolder])

  const handleDragEnd = useCallback(() => {
    setDragTabId(null)
    dragTabIdsRef.current = []
    setDragOverTarget(null)
  }, [])

  const handleDropOnRoot = useCallback((e: React.DragEvent) => {
    if (!isInternalDrag(e)) return
    e.preventDefault()
    for (const id of dragTabIdsRef.current) {
      moveTabToFolder(id, null)
    }
    setDragTabId(null)
    dragTabIdsRef.current = []
    setDragOverTarget(null)
  }, [moveTabToFolder, isInternalDrag])

  // Auto-scroll the tree container when dragging near its edges
  useEffect(() => {
    const tree = treeRef.current
    if (!tree || !dragTabId) return

    const EDGE = 40   // px from edge to start scrolling
    const SPEED = 8   // px per frame
    let scrollDir = 0 // -1 up, 0 none, 1 down

    const onDragOver = (e: DragEvent) => {
      const rect = tree.getBoundingClientRect()
      const y = e.clientY - rect.top
      if (y < EDGE) scrollDir = -1
      else if (y > rect.height - EDGE) scrollDir = 1
      else scrollDir = 0
    }

    const tick = () => {
      if (scrollDir !== 0 && tree) {
        tree.scrollTop += scrollDir * SPEED
      }
      autoScrollRaf.current = requestAnimationFrame(tick)
    }

    tree.addEventListener('dragover', onDragOver)
    autoScrollRaf.current = requestAnimationFrame(tick)

    return () => {
      tree.removeEventListener('dragover', onDragOver)
      cancelAnimationFrame(autoScrollRaf.current)
    }
  }, [dragTabId])

  // --- Context menu handlers ---
  const handleFileContextMenu = useCallback((e: React.MouseEvent, tabId: string, name: string) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ type: 'file', id: tabId, name, x: e.clientX, y: e.clientY })
  }, [])

  const handleFolderContextMenu = useCallback((e: React.MouseEvent, folderId: string, name: string) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ type: 'folder', id: folderId, name, x: e.clientX, y: e.clientY })
  }, [])

  const isSeqCtx = ctxMenu?.id.startsWith('seq_') ?? false
  const isAlignCtx = ctxMenu?.id.startsWith('align_') ?? false
  const isReadAlignCtx = ctxMenu?.id.startsWith('readalign_') ?? false
  const isContigCtx = ctxMenu?.id.startsWith('contig_') ?? false

  const handleCtxRename = useCallback(() => {
    if (!ctxMenu) return
    if (ctxMenu.type === 'file') {
      setEditingTabId(ctxMenu.id)
      setEditingName(ctxMenu.name)
    } else {
      setEditingFolderId(ctxMenu.id)
      setEditingName(ctxMenu.name)
    }
    setCtxMenu(null)
  }, [ctxMenu])

  const handleCtxDuplicate = useCallback(() => {
    if (!ctxMenu || ctxMenu.type !== 'file') return
    if (isSeqCtx || isAlignCtx || isReadAlignCtx || isContigCtx) { setCtxMenu(null); return } // no duplicate for sequencing reads, alignments, or contigs
    duplicateTab(ctxMenu.id)
    setCtxMenu(null)
  }, [ctxMenu, duplicateTab, isSeqCtx, isAlignCtx, isReadAlignCtx, isContigCtx])

  const handleCtxExport = useCallback(() => {
    if (!ctxMenu || ctxMenu.type !== 'file') return
    const id = ctxMenu.id
    let kind: import('./ExportModal').ExportItemKind
    if (id.startsWith('seq_')) kind = 'read'
    else if (id.startsWith('align_')) kind = 'alignment'
    else if (id.startsWith('readalign_')) kind = 'read-alignment'
    else if (id.startsWith('contig_')) kind = 'contig'
    else kind = 'sequence'
    setCtxMenu(null)
    onExportItems?.({ [kind]: [id] })
  }, [ctxMenu, onExportItems])

  const confirmDeleteFile = useCallback((tabId: string, name: string) => {
    setCtxMenu(null)
    setConfirmState({
      title: 'Delete Sequence',
      message: `Are you sure you want to delete "${name}"?`,
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Delete', value: 'delete', variant: 'danger' },
      ],
      onResult: (value) => {
        if (value === 'delete') closeTab(tabId)
        setConfirmState(null)
      },
    })
  }, [closeTab])

  const handleCtxDeleteFile = useCallback(() => {
    if (!ctxMenu || ctxMenu.type !== 'file') return
    if (ctxMenu.id.startsWith('seq_')) {
      const readId = ctxMenu.id.slice(4)
      setCtxMenu(null)
      setConfirmState({
        title: 'Delete Sequencing Read',
        message: `Are you sure you want to delete "${ctxMenu.name}"?`,
        buttons: [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Delete', value: 'delete', variant: 'danger' },
        ],
        onResult: (value) => {
          if (value === 'delete') removeSequencingRead(readId)
          setConfirmState(null)
        },
      })
      return
    }
    if (ctxMenu.id.startsWith('align_')) {
      const alignId = ctxMenu.id
      setCtxMenu(null)
      setConfirmState({
        title: 'Delete Alignment',
        message: `Are you sure you want to delete "${ctxMenu.name}"?`,
        buttons: [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Delete', value: 'delete', variant: 'danger' },
        ],
        onResult: (value) => {
          if (value === 'delete') removeAlignment(alignId)
          setConfirmState(null)
        },
      })
      return
    }
    if (ctxMenu.id.startsWith('readalign_')) {
      const raId = ctxMenu.id
      setCtxMenu(null)
      setConfirmState({
        title: 'Delete Read Alignment',
        message: `Are you sure you want to delete "${ctxMenu.name}"?`,
        buttons: [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Delete', value: 'delete', variant: 'danger' },
        ],
        onResult: (value) => {
          if (value === 'delete') removeReadAlignment(raId)
          setConfirmState(null)
        },
      })
      return
    }
    if (ctxMenu.id.startsWith('contig_')) {
      const contigId = ctxMenu.id
      setCtxMenu(null)
      setConfirmState({
        title: 'Delete Contig',
        message: `Are you sure you want to delete "${ctxMenu.name}"? The individual read alignments will be kept.`,
        buttons: [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Delete', value: 'delete', variant: 'danger' },
        ],
        onResult: (value) => {
          if (value === 'delete') removeContig(contigId)
          setConfirmState(null)
        },
      })
      return
    }
    confirmDeleteFile(ctxMenu.id, ctxMenu.name)
  }, [ctxMenu, confirmDeleteFile, removeSequencingRead, removeAlignment, removeReadAlignment, removeContig])

  const confirmDeleteFolder = useCallback((folderId: string, name: string, count: number) => {
    setCtxMenu(null)
    setConfirmState({
      title: 'Delete Folder',
      message: count > 0
        ? `"${name}" contains ${count} sequence${count > 1 ? 's' : ''}. What would you like to do?`
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
      onResult: (value) => {
        if (value === 'keep') deleteFolder(folderId)
        else if (value === 'delete-all') deleteFolderWithContents(folderId)
        setConfirmState(null)
      },
    })
  }, [deleteFolder, deleteFolderWithContents])

  const handleCtxDeleteFolder = useCallback(() => {
    if (!ctxMenu || ctxMenu.type !== 'folder') return
    const folder = folders.find(f => f.id === ctxMenu.id)
    confirmDeleteFolder(ctxMenu.id, ctxMenu.name, folder?.tabIds.length ?? 0)
  }, [ctxMenu, folders, confirmDeleteFolder])

  const renderFileItem = (tabId: string, indent: boolean = false) => {
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return null
    const isEditingThis = editingTabId === tab.id
    const isSelected = selectedIds.has(tab.id)
    return (
      <li
        key={tab.id}
        className={`fe-item ${tab.id === activeTabId ? 'active' : ''} ${isSelected ? 'selected' : ''} ${indent ? 'indented' : ''} ${dragTabId && dragTabIdsRef.current.includes(tab.id) ? 'dragging' : ''}`}
        onClick={e => handleItemClick(e, tab.id, () => setActiveTab(tab.id))}
        onContextMenu={e => handleFileContextMenu(e, tab.id, tab.doc.name)}
        draggable={!isEditingThis}
        onDragStart={e => handleDragStart(e, tab.id)}
        onDragEnd={handleDragEnd}
      >
        <span className="fe-icon">
          {tab.doc.sequence.topology === 'circular' ? <Circle size={12} /> : <Ruler size={12} />}
        </span>
        {isEditingThis ? (
          <input
            className="fe-rename-input"
            value={editingName}
            onChange={e => setEditingName(e.target.value)}
            onBlur={() => handleTabRenameSubmit(tab.id)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleTabRenameSubmit(tab.id)
              if (e.key === 'Escape') setEditingTabId(null)
            }}
            onClick={e => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span
            className="fe-name"
            title={tab.doc.name}
            onDoubleClick={e => {
              e.stopPropagation()
              setEditingTabId(tab.id)
              setEditingName(tab.doc.name)
            }}
          >
            {tab.doc.name}
          </span>
        )}
        <button
          className="fe-close"
          onClick={e => { e.stopPropagation(); confirmDeleteFile(tab.id, tab.doc.name) }}
          title="Delete"
        >
          <X size={12} />
        </button>
      </li>
    )
  }

  const renderFolder = (folder: ExplorerFolder) => {
    const folderTabs = folder.tabIds
      .map(id => tabs.find(t => t.id === id))
      .filter(Boolean)
      .sort((a, b) => a!.doc.name.localeCompare(b!.doc.name))
    const folderNameMatches = matchedFolderIds.has(folder.id)
    const visibleTabs = query
      ? folderNameMatches
        ? folderTabs // folder name matched - show all its files
        : folderTabs.filter(t => t && matchesSearch(t.doc.name))
      : folderTabs
    // Hide folders with no visible content during search (unless folder name matched)
    if (query && visibleTabs.length === 0 && !folderNameMatches) return null

    const isEditing = editingFolderId === folder.id
    const isDragOver = dragOverTarget === folder.id

    return (
      <div key={folder.id} className="fe-folder">
        <div
          className={`fe-folder-header ${isDragOver ? 'drag-over' : ''}`}
          onClick={() => toggleFolder(folder.id)}
          onContextMenu={e => handleFolderContextMenu(e, folder.id, folder.name)}
          onDragOver={e => handleDragOver(e, folder.id)}
          onDragLeave={handleDragLeave}
          onDrop={e => handleDropOnFolder(e, folder.id)}
        >
          <span className="fe-chevron">{folder.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</span>
          <span className="fe-folder-icon"><Folder size={12} /></span>
          {isEditing ? (
            <input
              className="fe-rename-input"
              value={editingName}
              onChange={e => setEditingName(e.target.value)}
              onBlur={() => handleFolderRenameSubmit(folder.id)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleFolderRenameSubmit(folder.id)
                if (e.key === 'Escape') setEditingFolderId(null)
              }}
              onClick={e => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <span
              className="fe-folder-name"
              title={folder.name}
              onDoubleClick={e => {
                e.stopPropagation()
                setEditingFolderId(folder.id)
                setEditingName(folder.name)
              }}
            >
              {folder.name}
            </span>
          )}
          <span className="fe-folder-count">{folderTabs.length}</span>
          <button
            className="fe-close"
            onClick={e => {
              e.stopPropagation()
              confirmDeleteFolder(folder.id, folder.name, folderTabs.length)
            }}
            title="Delete folder"
          >
            <X size={12} />
          </button>
        </div>
        {!folder.collapsed && (
          <ul className="fe-folder-items">
            {visibleTabs.map(t => t && renderFileItem(t.id, true))}
            {visibleTabs.length === 0 && !query && (
              <li className="fe-folder-empty">Drag files here</li>
            )}
          </ul>
        )}
      </div>
    )
  }

  // Visible root tabs during search
  const visibleRootTabs = useMemo(() => {
    if (!query) return rootTabs
    return rootTabs.filter(t => matchesSearch(t.doc.name))
  }, [query, rootTabs, matchesSearch])

  const hasAnyResults = filteredTabs ? filteredTabs.length > 0 : true

  return (
    <div
      className="file-explorer"
      onDragOver={e => { if (isInternalDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverTarget('root') } }}
      onDragLeave={handleDragLeave}
      onDrop={handleDropOnRoot}
    >
      <div className="fe-search-wrap">
        <input
          className="fe-search"
          type="text"
          placeholder="Search files &amp; folders..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button className="fe-search-clear" onClick={() => setSearch('')}><X size={12} /></button>
        )}
      </div>

      {/* Hidden file inputs for import (triggered from main File menu) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".gb,.gbk,.genbank,.fasta,.fa,.fna,.txt,.dna,.geneious"
        multiple
        style={{ display: 'none' }}
        onChange={e => { handleImportFiles(e.target.files); e.target.value = '' }}
      />
      <input
        ref={folderInputRef}
        type="file"
        /* @ts-expect-error webkitdirectory is non-standard but widely supported */
        webkitdirectory=""
        multiple
        style={{ display: 'none' }}
        onChange={e => { handleImportFiles(e.target.files); e.target.value = '' }}
      />



      {tabs.length === 0 && !query ? (
        <div className="fe-empty">
          No files open.<br />
          Drag &amp; drop or use Open.
        </div>
      ) : !hasAnyResults ? (
        <div className="fe-empty">No matches</div>
      ) : (
        <div className="fe-tree" ref={treeRef}>
          {/* Folders */}
          {folders.map(f => renderFolder(f))}

          {/* Root-level (ungrouped) files */}
          {visibleRootTabs.length > 0 && (
            <ul className="fe-list">
              {visibleRootTabs.map(t => renderFileItem(t.id))}
            </ul>
          )}
        </div>
      )}

      {/* Bottom sections wrapper – scrollable, capped at 50% of sidebar */}
      <div className="fe-bottom-sections">

      {/* Sequencing section */}
      <div className="fe-seq-section">
        <div
          className="fe-seq-header"
          onClick={e => {
            // Don't toggle if the click came from the + button
            if ((e.target as Element).closest?.('.fe-seq-add')) return
            setSeqSectionCollapsed(c => !c)
          }}
        >
          <span className="fe-seq-chevron">
            {seqSectionCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </span>
          <Activity size={13} className="fe-seq-icon" />
          <span className="fe-seq-title">Sequencing</span>
          <span className="fe-seq-count">{sequencingReads.length}</span>
          <button
            className="fe-seq-add"
            title="Import .ab1 files"
            onClick={e => { e.stopPropagation(); seqFileInputRef.current?.click() }}
          >
            <Plus size={13} />
          </button>
          <input
            ref={seqFileInputRef}
            type="file"
            accept=".ab1,.abi,.abif,.scf"
            multiple
            style={{ display: 'none' }}
            onClick={e => e.stopPropagation()}
            onChange={e => {
              if (e.target.files) {
                for (const f of Array.from(e.target.files)) {
                  onImportFile?.(f)
                }
              }
              e.target.value = ''
            }}
          />
        </div>
        {!seqSectionCollapsed && (
          <ul className="fe-list fe-seq-list">
            {sequencingReads.length === 0 ? (
              <li className="fe-seq-empty">No sequencing reads imported</li>
            ) : (
              [...sequencingReads].sort((a, b) => a.data.name.localeCompare(b.data.name)).map(read => {
                const isActive = activeSequencingReadIds.includes(read.id)
                const isEditing = editingTabId === `seq_${read.id}`
                const seqItemId = `seq_${read.id}`
                const isSelected = selectedIds.has(seqItemId)
                return (
                  <li
                    key={read.id}
                    className={`fe-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
                    onClick={e => {
                      if (e.ctrlKey || e.metaKey) {
                        // Ctrl-click: toggle this read in the multi-trace view
                        toggleSequencingRead(read.id)
                        e.preventDefault()
                        return
                      }
                      handleItemClick(e, seqItemId, () => {
                        setActiveSequencingRead(read.id)
                      })
                    }}
                    onContextMenu={e => {
                      e.preventDefault()
                      setCtxMenu({ type: 'file', id: `seq_${read.id}`, name: read.data.name, x: e.clientX, y: e.clientY })
                    }}
                  >
                    <Activity size={13} className="fe-seq-file-icon" />
                    {isEditing ? (
                      <input
                        className="fe-rename-input"
                        value={editingName}
                        autoFocus
                        onChange={e => setEditingName(e.target.value)}
                        onBlur={() => {
                          if (editingName.trim()) renameSequencingRead(read.id, editingName.trim())
                          setEditingTabId(null)
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            if (editingName.trim()) renameSequencingRead(read.id, editingName.trim())
                            setEditingTabId(null)
                          } else if (e.key === 'Escape') {
                            setEditingTabId(null)
                          }
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span className="fe-name" title={read.data.name} onDoubleClick={e => {
                        e.stopPropagation()
                        setEditingTabId(`seq_${read.id}`)
                        setEditingName(read.data.name)
                      }}>{read.data.name}</span>
                    )}
                    <button
                      className="fe-close"
                      title="Remove"
                      onClick={e => {
                        e.stopPropagation()
                        setConfirmState({
                          title: 'Delete Sequencing Read',
                          message: `Are you sure you want to delete "${read.data.name}"?`,
                          buttons: [
                            { label: 'Cancel', value: 'cancel' },
                            { label: 'Delete', value: 'delete', variant: 'danger' },
                          ],
                          onResult: (value) => {
                            if (value === 'delete') removeSequencingRead(read.id)
                            setConfirmState(null)
                          },
                        })
                      }}
                    >
                      <X size={12} />
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        )}
      </div>

      {/* Alignments section */}
      {alignments.length > 0 && (
        <div className="fe-seq-section">
          <div
            className="fe-seq-header"
            onClick={() => setAlignSectionCollapsed(c => !c)}
          >
            <span className="fe-seq-chevron">
              {alignSectionCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
            <AlignLeft size={13} className="fe-seq-icon" />
            <span className="fe-seq-title">Alignments</span>
            <span className="fe-seq-count">{alignments.length}</span>
          </div>
          {!alignSectionCollapsed && (
            <ul className="fe-list fe-seq-list">
              {[...alignments].sort((a, b) => a.name.localeCompare(b.name)).map(align => {
                const isActive = activeAlignmentId === align.id
                const isEditing = editingTabId === align.id
                const isSelected = selectedIds.has(align.id)
                return (
                  <li
                    key={align.id}
                    className={`fe-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
                    onClick={e => handleItemClick(e, align.id, () => setActiveAlignment(align.id))}
                    onContextMenu={e => {
                      e.preventDefault()
                      setCtxMenu({ type: 'file', id: align.id, name: align.name, x: e.clientX, y: e.clientY })
                    }}
                  >
                    <AlignLeft size={13} className="fe-seq-file-icon" />
                    {isEditing ? (
                      <input
                        className="fe-rename-input"
                        value={editingName}
                        autoFocus
                        onChange={e => setEditingName(e.target.value)}
                        onBlur={() => {
                          if (editingName.trim()) renameAlignment(align.id, editingName.trim())
                          setEditingTabId(null)
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            if (editingName.trim()) renameAlignment(align.id, editingName.trim())
                            setEditingTabId(null)
                          } else if (e.key === 'Escape') {
                            setEditingTabId(null)
                          }
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span className="fe-name" title={align.name} onDoubleClick={e => {
                        e.stopPropagation()
                        setEditingTabId(align.id)
                        setEditingName(align.name)
                      }}>{align.name}</span>
                    )}
                    <button
                      className="fe-close"
                      title="Remove"
                      onClick={e => {
                        e.stopPropagation()
                        setConfirmState({
                          title: 'Delete Alignment',
                          message: `Are you sure you want to delete "${align.name}"?`,
                          buttons: [
                            { label: 'Cancel', value: 'cancel' },
                            { label: 'Delete', value: 'delete', variant: 'danger' },
                          ],
                          onResult: (value) => {
                            if (value === 'delete') removeAlignment(align.id)
                            setConfirmState(null)
                          },
                        })
                      }}
                    >
                      <X size={12} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Read Alignments section (standalone only – contig-owned are hidden) */}
      {standaloneReadAlignments.length > 0 && (
        <div className="fe-seq-section">
          <div
            className="fe-seq-header"
            onClick={() => setReadAlignSectionCollapsed(c => !c)}
          >
            <span className="fe-seq-chevron">
              {readAlignSectionCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
            <ArrowRightLeft size={13} className="fe-seq-icon" />
            <span className="fe-seq-title">Read Alignments</span>
            <span className="fe-seq-count">{standaloneReadAlignments.length}</span>
          </div>
          {!readAlignSectionCollapsed && (
            <ul className="fe-list fe-seq-list">
              {[...standaloneReadAlignments].sort((a, b) => a.name.localeCompare(b.name)).map(ra => {
                const isActive = activeReadAlignmentId === ra.id
                const isEditing = editingTabId === ra.id
                const isSelected = selectedIds.has(ra.id)
                return (
                  <li
                    key={ra.id}
                    className={`fe-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
                    onClick={e => handleItemClick(e, ra.id, () => setActiveReadAlignment(ra.id))}
                    onContextMenu={e => {
                      e.preventDefault()
                      setCtxMenu({ type: 'file', id: ra.id, name: ra.name, x: e.clientX, y: e.clientY })
                    }}
                  >
                    <ArrowRightLeft size={13} className="fe-seq-file-icon" />
                    {isEditing ? (
                      <input
                        className="fe-rename-input"
                        value={editingName}
                        autoFocus
                        onChange={e => setEditingName(e.target.value)}
                        onBlur={() => {
                          if (editingName.trim()) renameReadAlignment(ra.id, editingName.trim())
                          setEditingTabId(null)
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            if (editingName.trim()) renameReadAlignment(ra.id, editingName.trim())
                            setEditingTabId(null)
                          } else if (e.key === 'Escape') {
                            setEditingTabId(null)
                          }
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span className="fe-name" title={ra.name} onDoubleClick={e => {
                        e.stopPropagation()
                        setEditingTabId(ra.id)
                        setEditingName(ra.name)
                      }}>{ra.name}</span>
                    )}
                    <button
                      className="fe-close"
                      title="Remove"
                      onClick={e => {
                        e.stopPropagation()
                        setConfirmState({
                          title: 'Delete Read Alignment',
                          message: `Are you sure you want to delete "${ra.name}"?`,
                          buttons: [
                            { label: 'Cancel', value: 'cancel' },
                            { label: 'Delete', value: 'delete', variant: 'danger' },
                          ],
                          onResult: (value) => {
                            if (value === 'delete') removeReadAlignment(ra.id)
                            setConfirmState(null)
                          },
                        })
                      }}
                    >
                      <X size={12} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Contigs section */}
      {contigs.length > 0 && (
        <div className="fe-seq-section">
          <div
            className="fe-seq-header"
            onClick={() => setContigSectionCollapsed(c => !c)}
          >
            <span className="fe-seq-chevron">
              {contigSectionCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
            <Layers size={13} className="fe-seq-icon" />
            <span className="fe-seq-title">Contigs</span>
            <span className="fe-seq-count">{contigs.length}</span>
          </div>
          {!contigSectionCollapsed && (
            <ul className="fe-list fe-seq-list">
              {[...contigs].sort((a, b) => a.name.localeCompare(b.name)).map(contig => {
                const isActive = activeContigId === contig.id
                const isEditing = editingTabId === contig.id
                const isSelected = selectedIds.has(contig.id)
                return (
                  <li
                    key={contig.id}
                    className={`fe-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
                    onClick={e => handleItemClick(e, contig.id, () => setActiveContig(contig.id))}
                    onContextMenu={e => {
                      e.preventDefault()
                      setCtxMenu({ type: 'file', id: contig.id, name: contig.name, x: e.clientX, y: e.clientY })
                    }}
                  >
                    <Layers size={13} className="fe-seq-file-icon" />
                    {isEditing ? (
                      <input
                        className="fe-rename-input"
                        value={editingName}
                        autoFocus
                        onChange={e => setEditingName(e.target.value)}
                        onBlur={() => {
                          if (editingName.trim()) renameContig(contig.id, editingName.trim())
                          setEditingTabId(null)
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            if (editingName.trim()) renameContig(contig.id, editingName.trim())
                            setEditingTabId(null)
                          } else if (e.key === 'Escape') {
                            setEditingTabId(null)
                          }
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span className="fe-name" title={contig.name} onDoubleClick={e => {
                        e.stopPropagation()
                        setEditingTabId(contig.id)
                        setEditingName(contig.name)
                      }}>{contig.name}</span>
                    )}
                    <button
                      className="fe-close"
                      title="Remove"
                      onClick={e => {
                        e.stopPropagation()
                        setConfirmState({
                          title: 'Delete Contig',
                          message: `Are you sure you want to delete "${contig.name}"? The individual read alignments will be kept.`,
                          buttons: [
                            { label: 'Cancel', value: 'cancel' },
                            { label: 'Delete', value: 'delete', variant: 'danger' },
                          ],
                          onResult: (value) => {
                            if (value === 'delete') removeContig(contig.id)
                            setConfirmState(null)
                          },
                        })
                      }}
                    >
                      <X size={12} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      </div>{/* end fe-bottom-sections */}

      {/* Footer */}
      <div className="fe-footer">
        <span className="fe-footer-license">MIT License</span>
        <button className="fe-footer-cite" onClick={onOpenInfo}>Cite this tool</button>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="ctx-menu"
          ref={ctxMenuRef}
          style={{ left: ctxMenu.x, top: ctxMenu.y, position: 'fixed' }}
        >
          {selectedIds.size > 1 ? (
            <>
              <div className="ctx-menu-header">{selectedIds.size} selected</div>
              {/* Align selected – when ≥2 sequences (tabs + reads) are selected */}
              {onQuickAlign && (() => {
                const selTabIds = tabs.filter(t => selectedIds.has(t.id)).map(t => t.id)
                const selReadIds = [...selectedIds].filter(id => id.startsWith('seq_')).map(id => id.slice(4))
                return (selTabIds.length + selReadIds.length) >= 2 ? (
                  <button className="ctx-menu-item" onClick={() => {
                    setCtxMenu(null)
                    onQuickAlign(selTabIds, selReadIds.length > 0 ? selReadIds : undefined)
                  }}>
                    <AlignLeft size={13} /> Align Selected
                  </button>
                ) : null
              })()}
              {/* Align reads to reference – when ≥1 sequencing read is selected */}
              {onAlignToRef && [...selectedIds].some(id => id.startsWith('seq_')) && (
                <button className="ctx-menu-item" onClick={() => {
                  const readIds = [...selectedIds].filter(id => id.startsWith('seq_')).map(id => id.slice(4))
                  setCtxMenu(null)
                  onAlignToRef(readIds)
                }}>
                  <AlignLeft size={13} /> Align to Reference…
                </button>
              )}
              {/* Create Contig – when 2+ standalone read alignments sharing the same reference are selected */}
              {(() => {
                const selRaIds = [...selectedIds].filter(id => id.startsWith('readalign_'))
                const selRas = standaloneReadAlignments.filter(ra => selRaIds.includes(ra.id))
                if (selRas.length >= 2) {
                  const tabIds = new Set(selRas.map(ra => ra.tabId))
                  if (tabIds.size === 1) {
                    return (
                      <button className="ctx-menu-item" onClick={() => {
                        setCtxMenu(null)
                        addContig([...tabIds][0], selRas.map(ra => ra.id))
                        setSelectedIds(new Set())
                      }}>
                        <Layers size={13} /> Create Contig
                      </button>
                    )
                  }
                }
                return null
              })()}
              {onExportItems && (
                <button className="ctx-menu-item" onClick={handleBulkExport}>
                  <Download size={13} /> Export Selected…
                </button>
              )}
              <button className="ctx-menu-item ctx-menu-danger" onClick={handleBulkDelete}>
                <Trash2 size={13} /> Delete Selected
              </button>
            </>
          ) : (
            <>
              <button className="ctx-menu-item" onClick={handleCtxRename}>
                <Pencil size={13} /> Rename
              </button>
              {ctxMenu.type === 'file' && !isSeqCtx && !isAlignCtx && !isReadAlignCtx && !isContigCtx && (
                <button className="ctx-menu-item" onClick={handleCtxDuplicate}>
                  <Copy size={13} /> Duplicate
                </button>
              )}
              {ctxMenu.type === 'file' && !isSeqCtx && !isAlignCtx && !isReadAlignCtx && !isContigCtx && onOpenProperties && (
                <button className="ctx-menu-item" onClick={() => {
                  setActiveTab(ctxMenu.id)
                  setCtxMenu(null)
                  onOpenProperties()
                }}>
                  <Dna size={13} /> Properties
                </button>
              )}
              {isSeqCtx && onAlignToRef && (
                <button className="ctx-menu-item" onClick={() => {
                  const readId = ctxMenu.id.slice(4) // strip 'seq_' prefix
                  setCtxMenu(null)
                  onAlignToRef(readId)
                }}>
                  <AlignLeft size={13} /> Align to Reference…
                </button>
              )}
              {ctxMenu.type === 'file' && onExportItems && (
                <button className="ctx-menu-item" onClick={handleCtxExport}>
                  <Download size={13} /> Export…
                </button>
              )}
              <div className="ctx-menu-sep" />
              <button
                className="ctx-menu-item ctx-menu-danger"
                onClick={ctxMenu.type === 'file' ? handleCtxDeleteFile : handleCtxDeleteFolder}
              >
                <Trash2 size={13} /> Delete
              </button>
            </>
          )}
        </div>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        buttons={confirmState?.buttons ?? []}
        onResult={confirmState?.onResult ?? (() => {})}
      />
    </div>
  )
}
