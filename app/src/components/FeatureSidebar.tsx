/**
 * Right sidebar for annotation/feature management.
 *
 * Groups annotations by type, supports visibility toggling (eye icons),
 * and includes a search/filter input.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useEditorStore } from '../store'
import type { Annotation } from '../models/Annotation'
import type { Strand } from '../models/Annotation'
import { defaultColorForType } from '../models/Annotation'
import AnnotationTooltip from './AnnotationTooltip'
import { Plus, X, ChevronRight, ChevronDown, Eye, EyeOff, Search, PanelRightClose, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import './FeatureSidebar.css'
import './ContextMenuPopup.css'

import { FEATURE_TYPES, PRESET_COLORS } from '../utils/annotation-constants'

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 500
const SIDEBAR_DEFAULT = 280
const STORAGE_KEY_WIDTH = 'seqnexus_feature_sidebar_width'

// --- Qualifiers sub-editor ---

const COMMON_QUALIFIERS = [
  'note', 'product', 'gene', 'locus_tag', 'label',
  'translation', 'codon_start', 'transl_table',
  'db_xref', 'protein_id', 'organism', 'mol_type',
]

function QualifiersEditor({
  annotation,
  updateAnnotation,
}: {
  annotation: Annotation
  updateAnnotation: (id: string, patch: Partial<Omit<import('../models/Annotation').AnnotationData, 'id'>>) => void
}) {
  const [open, setOpen] = useState(false)
  const [addingKey, setAddingKey] = useState('')
  const [addingVal, setAddingVal] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)

  const quals = annotation.qualifiers
  const entries = Object.entries(quals)
  const hasQualifiers = entries.length > 0

  const setQualifier = useCallback((key: string, values: string[]) => {
    const newQuals = { ...annotation.qualifiers }
    if (values.length === 0) {
      delete newQuals[key]
    } else {
      newQuals[key] = values
    }
    updateAnnotation(annotation.id, { qualifiers: newQuals })
  }, [annotation, updateAnnotation])

  const handleAdd = useCallback(() => {
    const key = addingKey.trim().replace(/^\//, '')
    const val = addingVal.trim()
    if (!key) return
    const existing = annotation.qualifiers[key] || []
    setQualifier(key, [...existing, val])
    setAddingKey('')
    setAddingVal('')
    setShowAddForm(false)
  }, [addingKey, addingVal, annotation.qualifiers, setQualifier])

  return (
    <div className="ft-quals" onClick={e => e.stopPropagation()}>
      <button className="ft-quals-toggle" onClick={() => setOpen(v => !v)}>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span>Qualifiers</span>
        {hasQualifiers && <span className="ft-quals-count">{entries.reduce((n, [, v]) => n + v.length, 0)}</span>}
      </button>

      {open && (
        <div className="ft-quals-body">
          {entries.length === 0 && !showAddForm && (
            <div className="ft-quals-empty">No qualifiers</div>
          )}

          {entries.map(([key, values]) => (
            <div key={key} className="ft-qual-group">
              <div className="ft-qual-key">/{key}</div>
              {values.map((val, vi) => (
                <div key={vi} className="ft-qual-val-row">
                  <input
                    className="input ft-input ft-qual-val-input"
                    value={val}
                    onChange={e => {
                      const newVals = [...values]
                      newVals[vi] = e.target.value
                      setQualifier(key, newVals)
                    }}
                    spellCheck={false}
                  />
                  <button
                    className="ft-qual-del"
                    title="Remove value"
                    onClick={() => {
                      const newVals = values.filter((_, i) => i !== vi)
                      setQualifier(key, newVals)
                    }}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          ))}

          {showAddForm ? (
            <div className="ft-qual-add-form">
              <div className="ft-qual-add-row">
                <select
                  className="select ft-select ft-qual-key-select"
                  value={addingKey}
                  onChange={e => setAddingKey(e.target.value)}
                >
                  <option value="">Key…</option>
                  {COMMON_QUALIFIERS.filter(q => !quals[q]).map(q => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
                <input
                  className="input ft-input"
                  placeholder="or type key"
                  value={addingKey}
                  onChange={e => setAddingKey(e.target.value)}
                  spellCheck={false}
                  style={{ flex: 1 }}
                />
              </div>
              <input
                className="input ft-input"
                placeholder="Value"
                value={addingVal}
                onChange={e => setAddingVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
                spellCheck={false}
              />
              <div className="ft-qual-add-actions">
                <button className="btn btn-sm btn-primary" onClick={handleAdd} disabled={!addingKey.trim()}>Add</button>
                <button className="btn btn-sm" onClick={() => { setShowAddForm(false); setAddingKey(''); setAddingVal('') }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="ft-qual-add-btn" onClick={() => setShowAddForm(true)}>
              <Plus size={11} /> Add qualifier
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// --- Main sidebar component ---

interface FeatureSidebarProps {
  open: boolean
  onClose: () => void
}

export default function FeatureSidebar({ open, onClose }: FeatureSidebarProps) {
  const annotations = useEditorStore(s => s.doc.annotations)
  const sequence = useEditorStore(s => s.doc.sequence)
  const seqLength = sequence.length
  const setSelection = useEditorStore(s => s.setSelection)
  const removeAnnotation = useEditorStore(s => s.removeAnnotation)
  const updateAnnotation = useEditorStore(s => s.updateAnnotation)
  const addAnnotation = useEditorStore(s => s.addAnnotation)
  const editAnnotationId = useEditorStore(s => s.editAnnotationId)
  const setEditAnnotation = useEditorStore(s => s.setEditAnnotation)
  const hiddenAnnotationIds = useEditorStore(s => s.hiddenAnnotationIds)
  const toggleAnnotationVisibility = useEditorStore(s => s.toggleAnnotationVisibility)
  const setTypeVisibility = useEditorStore(s => s.setTypeVisibility)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set())

  // Sidebar width with persistence
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_WIDTH)
    return saved ? Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, parseInt(saved, 10) || SIDEBAR_DEFAULT)) : SIDEBAR_DEFAULT
  })

  // Resize drag state
  const resizing = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    resizing.current = true
    startX.current = e.clientX
    startWidth.current = width
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [width])

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return
    // Dragging left increases width (sidebar is on the right)
    const delta = startX.current - e.clientX
    const newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startWidth.current + delta))
    setWidth(newWidth)
  }, [])

  const handleResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return
    resizing.current = false
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    const delta = startX.current - e.clientX
    const finalWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startWidth.current + delta))
    localStorage.setItem(STORAGE_KEY_WIDTH, String(finalWidth))
  }, [])

  // When editAnnotationId is set from outside, expand that annotation
  useEffect(() => {
    if (editAnnotationId) {
      setExpandedId(editAnnotationId)
      setEditAnnotation(null)
    }
  }, [editAnnotationId, setEditAnnotation])

  // Tooltip state
  const [tooltip, setTooltip] = useState<{ ann: Annotation; x: number; y: number } | null>(null)
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = useCallback((e: React.MouseEvent, ann: Annotation) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    tooltipTimer.current = setTimeout(() => {
      setTooltip({ ann, x: rect.left, y: rect.bottom + 4 })
    }, 400)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (tooltipTimer.current) { clearTimeout(tooltipTimer.current); tooltipTimer.current = null }
    setTooltip(null)
  }, [])

  // Add new annotation state
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('New Feature')
  const [newType, setNewType] = useState('misc_feature')
  const [newStart, setNewStart] = useState(1)
  const [newEnd, setNewEnd] = useState(100)
  const [newStrand, setNewStrand] = useState<Strand>(1)
  const [newColor, setNewColor] = useState(() => defaultColorForType('misc_feature'))
  // Update color when type changes (only if user hasn't manually picked a color)
  const [colorManuallySet, setColorManuallySet] = useState(false)
  const handleNewTypeChange = useCallback((type: string) => {
    setNewType(type)
    if (!colorManuallySet) setNewColor(defaultColorForType(type))
  }, [colorManuallySet])

  // Watch for external "add annotation" requests (e.g. from context menu)
  const requestAddAnnotation = useEditorStore(s => s.requestAddAnnotation)
  const setRequestAddAnnotation = useEditorStore(s => s.setRequestAddAnnotation)
  useEffect(() => {
    if (requestAddAnnotation && open) {
      const sel = useEditorStore.getState().selection
      const a = Math.min(sel.anchor, sel.caret)
      const b = Math.max(sel.anchor, sel.caret)
      if (b > a) {
        setNewStart(a + 1)
        setNewEnd(b)
      }
      setAdding(true)
      setRequestAddAnnotation(false)
    }
  }, [requestAddAnnotation, open, setRequestAddAnnotation])

  const handleToggle = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id)
  }, [])

  const handleSelect = useCallback((start: number, end: number) => {
    useEditorStore.getState().smoothScrollRequested = true
    setSelection({ anchor: start, caret: end })
  }, [setSelection])

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; ann: Annotation } | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, ann: Annotation) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, ann })
  }, [])

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [ctxMenu])

  const handleAdd = useCallback(() => {
    const id = `ann_${Date.now()}`
    const start = Math.max(0, Math.min(newStart - 1, seqLength - 1))
    const end = Math.max(1, Math.min(newEnd, seqLength))
    addAnnotation({
      id,
      name: newName.trim() || 'Untitled',
      type: newType,
      start,
      end,
      strand: newStrand,
      color: newColor,
    })
    setAdding(false)
    setColorManuallySet(false)
    setExpandedId(id)
  }, [newName, newType, newStart, newEnd, newStrand, newColor, seqLength, addAnnotation])

  const toggleTypeCollapse = useCallback((type: string) => {
    setCollapsedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  // Filter annotations (exclude ORF and primer display pseudo-annotations)
  const userAnnotations = useMemo(() =>
    annotations.filter(a => !a.id.startsWith('_orf_') && !a.id.startsWith('_primer_')),
    [annotations]
  )

  // Apply search filter
  const filteredAnnotations = useMemo(() => {
    if (!filter.trim()) return userAnnotations
    const q = filter.toLowerCase()
    return userAnnotations.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.type.toLowerCase().includes(q) ||
      Object.values(a.qualifiers).some(vals =>
        vals.some(v => v.toLowerCase().includes(q))
      )
    )
  }, [userAnnotations, filter])

  // Group by type, sorted by type name with counts
  const grouped = useMemo(() => {
    const map = new Map<string, Annotation[]>()
    for (const a of filteredAnnotations) {
      const list = map.get(a.type)
      if (list) list.push(a)
      else map.set(a.type, [a])
    }
    // Sort groups: types with more annotations first, then alphabetically
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  }, [filteredAnnotations])

  const hiddenSet = useMemo(() => new Set(hiddenAnnotationIds), [hiddenAnnotationIds])

  if (!open) return null

  return (
    <>
      {/* Resize handle */}
      <div
        className="fs-resize-handle"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
      />
      <aside className="feature-sidebar" style={{ width }}>
        {/* Header */}
        <div className="fs-header">
          <span className="fs-title">Features</span>
          <span className="fs-count">{userAnnotations.length}</span>
          <div className="fs-header-actions">
            <button
              className="fs-icon-btn"
              onClick={() => {
                const allTypes = grouped.map(([type]) => type)
                const allCollapsed = allTypes.length > 0 && allTypes.every(t => collapsedTypes.has(t))
                setCollapsedTypes(allCollapsed ? new Set() : new Set(allTypes))
              }}
              title={grouped.length > 0 && grouped.every(([t]) => collapsedTypes.has(t)) ? 'Expand all groups' : 'Collapse all groups'}
            >
              {grouped.length > 0 && grouped.every(([t]) => collapsedTypes.has(t))
                ? <ChevronsUpDown size={14} />
                : <ChevronsDownUp size={14} />}
            </button>
            <button
              className="fs-icon-btn"
              onClick={() => setAdding(v => !v)}
              title={adding ? 'Cancel' : 'Add feature'}
            >
              {adding ? <X size={14} /> : <Plus size={14} />}
            </button>
            <button
              className="fs-icon-btn"
              onClick={onClose}
              title="Close sidebar"
            >
              <PanelRightClose size={14} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="fs-search">
          <Search size={12} className="fs-search-icon" />
          <input
            className="fs-search-input"
            placeholder="Filter features…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            spellCheck={false}
          />
          {filter && (
            <button className="fs-search-clear" onClick={() => setFilter('')}>
              <X size={11} />
            </button>
          )}
        </div>

        {/* Add new annotation form */}
        {adding && (
          <div className="ft-editor ft-add-form fs-add-form">
            <div className="ft-row">
              <label>Name</label>
              <input
                className="input ft-input"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                autoFocus
              />
            </div>
            <div className="ft-row">
              <label>Type</label>
              <select className="select ft-select" value={newType} onChange={e => handleNewTypeChange(e.target.value)}>
                {FEATURE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="ft-row">
              <label>Range</label>
              <div className="ft-range-inputs">
                <input
                  className="input ft-input ft-num"
                  type="number"
                  min={1}
                  max={seqLength}
                  value={newStart}
                  onChange={e => setNewStart(parseInt(e.target.value) || 1)}
                />
                <span>..</span>
                <input
                  className="input ft-input ft-num"
                  type="number"
                  min={1}
                  max={seqLength}
                  value={newEnd}
                  onChange={e => setNewEnd(parseInt(e.target.value) || 1)}
                />
              </div>
            </div>
            <div className="ft-row">
              <label>Strand</label>
              <select
                className="select ft-select"
                value={newStrand}
                onChange={e => setNewStrand(parseInt(e.target.value) as Strand)}
              >
                <option value={1}>Forward (+)</option>
                <option value={-1}>Reverse (−)</option>
                <option value={0}>None</option>
              </select>
            </div>
            <div className="ft-row">
              <label>Color</label>
              <div className="ft-color-row">
                <div className="ft-color-presets">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      className={`ft-color-dot ${c === newColor ? 'active' : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => { setNewColor(c); setColorManuallySet(true) }}
                    />
                  ))}
                  <label className="ft-color-dot ft-color-custom" style={{ backgroundColor: newColor }} title="Custom color">
                    <input
                      type="color"
                      value={newColor}
                      onChange={e => { setNewColor(e.target.value); setColorManuallySet(true) }}
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="ft-actions">
              <button className="btn btn-primary btn-sm" onClick={handleAdd}>Add Feature</button>
              <button className="btn btn-sm" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Grouped annotation list */}
        <div className="fs-list">
          {grouped.map(([type, anns]) => {
            const isCollapsed = collapsedTypes.has(type)
            const allHidden = anns.every(a => hiddenSet.has(a.id))
            const someHidden = anns.some(a => hiddenSet.has(a.id))

            // Representative color for the group (use first annotation's color)
            const groupColor = anns[0]?.color ?? '#adb5bd'

            return (
              <div key={type} className="fs-group">
                {/* Group header */}
                <div className="fs-group-header">
                  <label className="fs-group-color-wrap" title={`Change color for all ${type} features`}>
                    <span className="fs-group-swatch" style={{ backgroundColor: groupColor }} />
                    <input
                      type="color"
                      className="fs-group-color-input"
                      value={groupColor}
                      onChange={e => {
                        const color = e.target.value
                        for (const a of anns) updateAnnotation(a.id, { color })
                      }}
                    />
                  </label>
                  <button
                    className="fs-group-toggle"
                    onClick={() => toggleTypeCollapse(type)}
                  >
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <span className="fs-group-name">{type}</span>
                    <span className="fs-group-count">{anns.length}</span>
                  </button>
                  <button
                    className={`fs-eye-btn ${allHidden ? 'hidden' : someHidden ? 'partial' : ''}`}
                    onClick={() => setTypeVisibility(type, allHidden)}
                    title={allHidden ? `Show all ${type}` : `Hide all ${type}`}
                  >
                    {allHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>

                {/* Annotation rows */}
                {!isCollapsed && anns.map(a => {
                  const isExpanded = expandedId === a.id
                  const isHidden = hiddenSet.has(a.id)

                  return (
                    <div key={a.id} className={`fs-item ${isExpanded ? 'expanded' : ''} ${isHidden ? 'dimmed' : ''}`}>
                      {/* Summary row */}
                      <div
                        className="ft-summary"
                        onClick={() => handleSelect(a.start, a.end)}
                        onDoubleClick={() => handleToggle(a.id)}
                        onContextMenu={e => handleContextMenu(e, a)}
                        onMouseEnter={e => handleMouseEnter(e, a)}
                        onMouseLeave={handleMouseLeave}
                      >
                        <span className="ann-swatch" style={{ backgroundColor: a.color }} />
                        <span className="ft-name">{a.name}</span>
                        <span className="ann-range">{a.start + 1}..{a.end}</span>
                        <span className="ft-strand-badge">
                          {a.strand === 1 ? '→' : a.strand === -1 ? '←' : '·'}
                        </span>
                        <button
                          className={`fs-eye-btn fs-eye-inline ${isHidden ? 'hidden' : ''}`}
                          onClick={e => { e.stopPropagation(); toggleAnnotationVisibility(a.id) }}
                          title={isHidden ? 'Show annotation' : 'Hide annotation'}
                        >
                          {isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </div>

                      {/* Expanded editor */}
                      {isExpanded && (
                        <div className="ft-editor">
                          <div className="ft-row">
                            <label>Name</label>
                            <input
                              className="input ft-input"
                              value={a.name}
                              onChange={e => updateAnnotation(a.id, { name: e.target.value })}
                              onClick={e => e.stopPropagation()}
                            />
                          </div>
                          <div className="ft-row">
                            <label>Type</label>
                            <select
                              className="select ft-select"
                              value={a.type}
                              onChange={e => updateAnnotation(a.id, { type: e.target.value })}
                              onClick={e => e.stopPropagation()}
                            >
                              {FEATURE_TYPES.includes(a.type) ? null : (
                                <option value={a.type}>{a.type}</option>
                              )}
                              {FEATURE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div className="ft-row">
                            <label>Range</label>
                            <div className="ft-range-inputs">
                              <input
                                className="input ft-input ft-num"
                                type="number"
                                min={0}
                                max={seqLength}
                                value={a.start + 1}
                                onChange={e => {
                                  const v = Math.max(0, (parseInt(e.target.value) || 1) - 1)
                                  updateAnnotation(a.id, { start: v })
                                }}
                                onClick={e => e.stopPropagation()}
                              />
                              <span>..</span>
                              <input
                                className="input ft-input ft-num"
                                type="number"
                                min={1}
                                max={seqLength}
                                value={a.end}
                                onChange={e => {
                                  const v = Math.max(1, parseInt(e.target.value) || 1)
                                  updateAnnotation(a.id, { end: v })
                                }}
                                onClick={e => e.stopPropagation()}
                              />
                            </div>
                          </div>
                          <div className="ft-row">
                            <label>Strand</label>
                            <select
                              className="select ft-select"
                              value={a.strand}
                              onChange={e => updateAnnotation(a.id, { strand: parseInt(e.target.value) as Strand })}
                              onClick={e => e.stopPropagation()}
                            >
                              <option value={1}>Forward (+)</option>
                              <option value={-1}>Reverse (−)</option>
                              <option value={0}>None</option>
                            </select>
                          </div>
                          <div className="ft-row">
                            <label>Color</label>
                            <div className="ft-color-row">
                              <div className="ft-color-presets">
                                {PRESET_COLORS.map(c => (
                                  <button
                                    key={c}
                                    className={`ft-color-dot ${c === a.color ? 'active' : ''}`}
                                    style={{ backgroundColor: c }}
                                    onClick={e => { e.stopPropagation(); updateAnnotation(a.id, { color: c }) }}
                                  />
                                ))}
                                <label className="ft-color-dot ft-color-custom" style={{ backgroundColor: a.color }} title="Custom color" onClick={e => e.stopPropagation()}>
                                  <input
                                    type="color"
                                    value={a.color}
                                    onChange={e => updateAnnotation(a.id, { color: e.target.value })}
                                  />
                                </label>
                              </div>
                            </div>
                          </div>
                          <QualifiersEditor annotation={a} updateAnnotation={updateAnnotation} />
                          <div className="ft-actions">
                            <button
                              className="btn btn-sm"
                              onClick={e => { e.stopPropagation(); setExpandedId(null) }}
                            >
                              Done
                            </button>
                            <button
                              className="btn btn-sm ft-del-btn"
                              onClick={e => { e.stopPropagation(); removeAnnotation(a.id); setExpandedId(null) }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}

          {filteredAnnotations.length === 0 && !adding && (
            <div className="ft-empty">
              {filter ? 'No matching features.' : 'No features. Click + to add one.'}
            </div>
          )}
        </div>

        {/* Hover tooltip */}
        {tooltip && (
          <AnnotationTooltip
            ann={tooltip.ann}
            sequence={sequence}
            x={tooltip.x}
            y={tooltip.y}
          />
        )}

        {/* Context menu */}
        {ctxMenu && (
          <div
            className="ctx-menu"
            style={{ left: ctxMenu.x, top: ctxMenu.y, position: 'fixed' }}
            onMouseDown={e => e.stopPropagation()}
          >
            <button className="ctx-menu-item" onClick={() => { handleToggle(ctxMenu.ann.id); handleSelect(ctxMenu.ann.start, ctxMenu.ann.end); setCtxMenu(null) }}>
              Edit
            </button>
            <button className="ctx-menu-item" onClick={() => { navigator.clipboard.writeText(ctxMenu.ann.name); setCtxMenu(null) }}>
              Copy Name
            </button>
            <div className="ctx-menu-sep" />
            <button className="ctx-menu-item ctx-menu-danger" onClick={() => { removeAnnotation(ctxMenu.ann.id); setCtxMenu(null) }}>
              Delete
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
