/**
 * The alignment itself: names on the left, header tracks on top, residues in
 * a scrolling canvas, with a separate overlay canvas for selection, caret,
 * hover and search hits.
 *
 * The residue canvas sits in a sticky stage inside a sizer as big as the
 * whole alignment, so the browser does the scrolling (scrollbars, touchpads,
 * keyboard) and only the visible cells are painted.
 *
 * Gestures: drag across cells to select a block; drag along the ruler to
 * select columns; click a name to select its row (Ctrl adds, Shift extends)
 * and drag names to reorder; double-click a name to rename. In edit mode,
 * dragging inside the selection slides it along its row, trading places
 * with the gaps beside it (and pushing new gaps in when it runs out moving
 * right). Ctrl+wheel zooms around the pointer.
 */

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AlnRow } from '../../msa/model'
import type { PaintModel } from './layout'
import { paintBody, paintHead, paintOverlay, type Caret, type OverlayState, type Selection, type View } from './paint'
import { readAlnTheme, useThemeVersion, type AlnTheme } from './theme'
import { createSignal, useSignal, type Signal } from './signal'
import { MAX_NAME_WIDTH, MIN_NAME_WIDTH } from '../../msa/view'

export interface HoverInfo {
  rowId: string
  col: number
}

export interface GridContextTarget {
  area: 'cell' | 'name' | 'ruler'
  x: number
  y: number
  rowId?: string
  col?: number
}

export interface GridHandle {
  /** Scroll so a cell (or just a column, without a row) is in view. */
  reveal: (rowId: string | null, col: number, c1?: number) => void
  focus: () => void
  /** Columns in view, half-open. */
  visibleColumns: () => [number, number]
  /** Scroll so column `col` is at the left edge. */
  scrollToColumn: (col: number) => void
  /** Index (in the body) of the first row in view. */
  firstVisibleRow: () => number
}

interface Props {
  pm: PaintModel
  selection: Selection | null
  caret: Caret | null
  editing: boolean
  insertMode: boolean
  hits: readonly { rowId: string; c0: number; c1: number }[]
  currentHit: number
  hover: Signal<HoverInfo | null>
  /** Scroll position in columns, published for the minimap. */
  onViewport: (start: number, end: number) => void
  onSelect: (sel: Selection | null, caret: Caret | null) => void
  /** Slide a block; returns how far it actually moved. */
  onSlide: (rowIds: readonly string[], c0: number, c1: number, delta: number, dragId: number) => number
  onMoveRows: (ids: readonly string[], before: number) => void
  onRenameRow: (id: string, name: string) => void
  onContextMenu: (t: GridContextTarget) => void
  onZoom: (step: number, anchorCol: number, pointerX: number) => void
  onNameWidth: (w: number) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

type Drag =
  | { kind: 'select'; anchorRow: number; anchorCol: number; moved: boolean }
  | { kind: 'columns'; anchorCol: number }
  | { kind: 'slide'; rowIds: readonly string[]; c0: number; c1: number; startCol: number; applied: number; id: number }

let dragCounter = 0

const AlignmentGrid = forwardRef<GridHandle, Props>(function AlignmentGrid(props, ref) {
  const { pm } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const headRef = useRef<HTMLCanvasElement>(null)
  const themeVersion = useThemeVersion(rootRef)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const scrollSignal = useMemo(() => createSignal({ x: 0, y: 0 }, (a, b) => a.x === b.x && a.y === b.y), [])
  const theme = useRef<AlnTheme | null>(null)
  const drag = useRef<Drag | null>(null)
  // The column under the pointer when a wheel zoom started, kept still across the zoom.
  const zoomAnchor = useRef<{ col: number; px: number } | null>(null)

  // Latest props for the paint loop, which runs outside React.
  const live = useRef(props)
  live.current = props

  const { cellW, pitch } = pm.m
  const totalW = pm.width * cellW + 48
  const totalH = pm.bodyRows.length * pitch + 12

  // ---- Size ----
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- Painting ----
  const frame = useRef(0)
  const dirty = useRef({ body: true, head: true, overlay: true })

  const view = useCallback((): View => {
    const el = scrollerRef.current
    return { x: el?.scrollLeft ?? 0, y: el?.scrollTop ?? 0, w: size.w, h: size.h }
  }, [size])

  const paint = useCallback(() => {
    frame.current = 0
    const p = live.current
    const t = theme.current
    if (!t || size.w === 0) return
    const v = view()
    const dpr = window.devicePixelRatio || 1
    const prep = (c: HTMLCanvasElement | null, w: number, h: number) => {
      if (!c) return null
      const W = Math.max(1, Math.round(w * dpr))
      const H = Math.max(1, Math.round(h * dpr))
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
      const ctx = c.getContext('2d')
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
      return ctx
    }
    const hover = p.hover.get()
    const hoverRow = hover ? p.pm.bodyRows.findIndex(r => r.id === hover.rowId) : -1
    const d = dirty.current
    if (d.body) {
      const ctx = prep(bodyRef.current, v.w, v.h)
      if (ctx) paintBody(ctx, p.pm, t, v)
    }
    if (d.head) {
      const ctx = prep(headRef.current, v.w, p.pm.headH)
      if (ctx) paintHead(ctx, p.pm, t, v, { hoverCol: hover?.col ?? null, selection: p.selection })
    }
    if (d.overlay) {
      const ctx = prep(overlayRef.current, v.w, v.h)
      const state: OverlayState = {
        selection: p.selection, caret: p.caret, editing: p.editing, insertMode: p.insertMode,
        hover: hover && hoverRow >= 0 ? { row: hoverRow, col: hover.col } : null,
        hits: p.hits, currentHit: p.currentHit,
      }
      if (ctx) paintOverlay(ctx, p.pm, t, v, state)
    }
    dirty.current = { body: false, head: false, overlay: false }
  }, [size, view])

  const schedule = useCallback((what: Partial<{ body: boolean; head: boolean; overlay: boolean }>) => {
    const d = dirty.current
    if (what.body) d.body = true
    if (what.head) d.head = true
    if (what.overlay) d.overlay = true
    if (!frame.current) frame.current = requestAnimationFrame(paint)
  }, [paint])

  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current) }, [])

  // Theme changes re-read the colours.
  useLayoutEffect(() => {
    if (rootRef.current) theme.current = readAlnTheme(rootRef.current)
    schedule({ body: true, head: true, overlay: true })
  }, [themeVersion, schedule])

  // Content or view changed.
  useLayoutEffect(() => { schedule({ body: true, head: true, overlay: true }) }, [pm, size, schedule])
  // Marks changed.
  useLayoutEffect(() => {
    schedule({ overlay: true, head: true })
  }, [props.selection, props.caret, props.editing, props.insertMode, props.hits, props.currentHit, schedule])

  useEffect(() => props.hover.subscribe(() => schedule({ overlay: true, head: true })), [props.hover, schedule])

  const publishViewport = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    live.current.onViewport(el.scrollLeft / cellW, (el.scrollLeft + el.clientWidth) / cellW)
  }, [cellW])

  useLayoutEffect(() => { publishViewport() }, [publishViewport, size, pm])

  const onScroll = () => {
    const el = scrollerRef.current!
    scrollSignal.set({ x: el.scrollLeft, y: el.scrollTop })
    schedule({ body: true, head: true, overlay: true })
    publishViewport()
  }

  // ---- Hit testing ----
  const cellAt = useCallback((clientX: number, clientY: number, clamp = true) => {
    const el = scrollerRef.current!
    const r = el.getBoundingClientRect()
    const x = clientX - r.left + el.scrollLeft
    const y = clientY - r.top + el.scrollTop
    const p = live.current.pm
    let row = Math.floor(y / p.m.pitch)
    let col = Math.floor(x / p.m.cellW)
    if (clamp) {
      row = Math.max(0, Math.min(p.bodyRows.length - 1, row))
      col = Math.max(0, Math.min(p.width - 1, col))
    }
    return { row, col, inside: x >= 0 && y >= 0 && row < p.bodyRows.length && col < p.width }
  }, [])

  const rectSelection = useCallback((r0: number, c0: number, r1: number, c1: number): Selection => {
    const p = live.current.pm
    const a = Math.min(r0, r1)
    const b = Math.max(r0, r1)
    return {
      rowIds: p.bodyRows.slice(a, b + 1).map(r => r.id),
      c0: Math.min(c0, c1),
      c1: Math.max(c0, c1) + 1,
    }
  }, [])

  const inSelection = (rowId: string, col: number) => {
    const s = live.current.selection
    return !!s && col >= s.c0 && col < s.c1 && s.rowIds.includes(rowId)
  }

  // Keep scrolling while a drag holds the pointer past an edge.
  const autoScroll = (clientX: number, clientY: number) => {
    const el = scrollerRef.current!
    const r = el.getBoundingClientRect()
    const edge = 24
    if (clientX > r.right - edge) el.scrollLeft += Math.min(40, clientX - (r.right - edge))
    else if (clientX < r.left + edge) el.scrollLeft -= Math.min(40, r.left + edge - clientX)
    if (clientY > r.bottom - edge) el.scrollTop += Math.min(40, clientY - (r.bottom - edge))
    else if (clientY < r.top + edge) el.scrollTop -= Math.min(40, r.top + edge - clientY)
  }

  // ---- Body pointer ----
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = scrollerRef.current!
    // Leave the scrollbars alone.
    const r = el.getBoundingClientRect()
    if (e.clientX - r.left >= el.clientWidth || e.clientY - r.top >= el.clientHeight) return
    el.focus({ preventScroll: true })
    const hit = cellAt(e.clientX, e.clientY)
    const p = live.current
    const row = p.pm.bodyRows[hit.row]
    if (!row) return
    el.setPointerCapture(e.pointerId)
    if (p.editing && p.selection && inSelection(row.id, hit.col) && !e.shiftKey) {
      drag.current = { kind: 'slide', rowIds: p.selection.rowIds, c0: p.selection.c0, c1: p.selection.c1, startCol: hit.col, applied: 0, id: ++dragCounter }
      return
    }
    if (e.shiftKey && p.caret) {
      const ai = p.pm.bodyRows.findIndex(x => x.id === p.caret!.rowId)
      if (ai >= 0) {
        p.onSelect(rectSelection(ai, p.caret.col, hit.row, hit.col), p.caret)
        drag.current = { kind: 'select', anchorRow: ai, anchorCol: p.caret.col, moved: true }
        return
      }
    }
    drag.current = { kind: 'select', anchorRow: hit.row, anchorCol: hit.col, moved: false }
    p.onSelect(null, { rowId: row.id, col: hit.col })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const p = live.current
    if (!d) {
      const hit = cellAt(e.clientX, e.clientY, false)
      const row = hit.inside ? p.pm.bodyRows[hit.row] : undefined
      p.hover.set(row ? { rowId: row.id, col: hit.col } : null)
      return
    }
    autoScroll(e.clientX, e.clientY)
    const hit = cellAt(e.clientX, e.clientY)
    if (d.kind === 'select') {
      if (!d.moved && hit.row === d.anchorRow && hit.col === d.anchorCol) return
      d.moved = true
      const anchorRow = p.pm.bodyRows[d.anchorRow]
      p.onSelect(rectSelection(d.anchorRow, d.anchorCol, hit.row, hit.col), anchorRow ? { rowId: anchorRow.id, col: d.anchorCol } : null)
    } else if (d.kind === 'slide') {
      const want = hit.col - d.startCol
      const step = want - d.applied
      if (step === 0) return
      const moved = p.onSlide(d.rowIds, d.c0 + d.applied, d.c1 + d.applied, step, d.id)
      d.applied += moved
    }
  }

  const endDrag = (e: React.PointerEvent) => {
    const el = scrollerRef.current
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    drag.current = null
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const hit = cellAt(e.clientX, e.clientY)
    const row = live.current.pm.bodyRows[hit.row]
    if (!row) return
    if (!inSelection(row.id, hit.col)) live.current.onSelect(null, { rowId: row.id, col: hit.col })
    live.current.onContextMenu({ area: 'cell', x: e.clientX, y: e.clientY, rowId: row.id, col: hit.col })
  }

  // Ctrl+wheel zooms; it has to be a non-passive listener to stop the page zooming.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left
      const col = (el.scrollLeft + px) / live.current.pm.m.cellW
      zoomAnchor.current = { col, px }
      live.current.onZoom(e.deltaY < 0 ? 1 : -1, col, px)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---- Header pointer (ruler: column selection) ----
  const headCol = (clientX: number) => {
    const el = scrollerRef.current!
    const r = headRef.current!.getBoundingClientRect()
    const p = live.current.pm
    return Math.max(0, Math.min(p.width - 1, Math.floor((clientX - r.left + el.scrollLeft) / p.m.cellW)))
  }
  const allRowIds = () => live.current.pm.doc.rows.map(r => r.id)

  const onHeadDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const col = headCol(e.clientX)
    const p = live.current
    const anchor = e.shiftKey && p.selection ? p.selection.c0 : col
    headRef.current!.setPointerCapture(e.pointerId)
    drag.current = { kind: 'columns', anchorCol: anchor }
    p.onSelect({ rowIds: allRowIds(), c0: Math.min(anchor, col), c1: Math.max(anchor, col) + 1 }, null)
    scrollerRef.current?.focus({ preventScroll: true })
  }
  const onHeadMove = (e: React.PointerEvent) => {
    const d = drag.current
    const col = headCol(e.clientX)
    if (d?.kind === 'columns') {
      autoScroll(e.clientX, (scrollerRef.current?.getBoundingClientRect().top ?? 0) + 30)
      live.current.onSelect({ rowIds: allRowIds(), c0: Math.min(d.anchorCol, col), c1: Math.max(d.anchorCol, col) + 1 }, null)
    } else {
      const ref = live.current.pm.pinned
      live.current.hover.set(ref ? { rowId: ref.id, col } : { rowId: '', col })
    }
  }
  const onHeadUp = (e: React.PointerEvent) => {
    if (headRef.current?.hasPointerCapture(e.pointerId)) headRef.current.releasePointerCapture(e.pointerId)
    drag.current = null
  }

  // Wheel over the header and names scrolls the body.
  const forwardWheel = (e: React.WheelEvent) => {
    const el = scrollerRef.current
    if (!el || e.ctrlKey || e.metaKey) return
    el.scrollLeft += e.deltaX || (e.shiftKey ? e.deltaY : 0)
    if (!e.shiftKey) el.scrollTop += e.deltaY
  }

  // ---- Imperative ----
  useImperativeHandle(ref, () => ({
    reveal(rowId, col, c1) {
      const el = scrollerRef.current
      if (!el) return
      const p = live.current.pm
      const x0 = col * p.m.cellW
      const x1 = (c1 ?? col + 1) * p.m.cellW
      if (x0 < el.scrollLeft || x1 > el.scrollLeft + el.clientWidth) {
        el.scrollLeft = Math.max(0, (x0 + x1) / 2 - el.clientWidth / 2)
      }
      if (rowId) {
        const r = p.bodyRows.findIndex(x => x.id === rowId)
        if (r >= 0) {
          const y0 = r * p.m.pitch
          if (y0 < el.scrollTop || y0 + p.m.pitch > el.scrollTop + el.clientHeight) {
            el.scrollTop = Math.max(0, y0 - el.clientHeight / 2)
          }
        }
      }
    },
    focus() { scrollerRef.current?.focus({ preventScroll: true }) },
    firstVisibleRow() {
      const el = scrollerRef.current
      return el ? Math.floor(el.scrollTop / live.current.pm.m.pitch) : 0
    },
    scrollToColumn(col) {
      const el = scrollerRef.current
      if (el) el.scrollLeft = Math.max(0, col * live.current.pm.m.cellW)
    },
    visibleColumns() {
      const el = scrollerRef.current
      const cw = live.current.pm.m.cellW
      if (!el) return [0, 0]
      return [Math.floor(el.scrollLeft / cw), Math.ceil((el.scrollLeft + el.clientWidth) / cw)]
    },
  }), [])

  // Keep the column under the pointer (or the centre) still across a zoom.
  const prevCellW = useRef(cellW)
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (el && prevCellW.current !== cellW) {
      const a = zoomAnchor.current ?? { col: (el.scrollLeft + el.clientWidth / 2) / prevCellW.current, px: el.clientWidth / 2 }
      el.scrollLeft = Math.max(0, a.col * cellW - a.px)
      zoomAnchor.current = null
    }
    prevCellW.current = cellW
  }, [cellW])
  // ---- Name column resize ----
  const nameWidth = pm.view.nameWidth
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const start = nameWidth
    const move = (ev: PointerEvent) => {
      live.current.onNameWidth(Math.max(MIN_NAME_WIDTH, Math.min(MAX_NAME_WIDTH, start + ev.clientX - startX)))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className="aw-grid"
      ref={rootRef}
      style={{ gridTemplateColumns: `${nameWidth}px 1fr`, gridTemplateRows: `${pm.headH}px 1fr` }}
    >
      <div className="aw-corner" onWheel={forwardWheel}>
        {pm.head.map(t => t.label && (
          <div
            key={t.id}
            className={`aw-corner-label aw-corner-${t.id}`}
            style={{ top: t.y, height: t.id === 'reference' ? pm.m.rowH : t.h }}
            title={t.id === 'reference' ? `${t.label} is the reference row` : undefined}
          >
            {t.id === 'reference' && <span className="aw-ref-badge">REF</span>}
            <span className="aw-corner-text">{t.label}</span>
          </div>
        ))}
        <div className="aw-resize" onPointerDown={startResize} title="Drag to resize the name column" />
      </div>
      <canvas
        ref={headRef}
        className="aw-head"
        style={{ height: pm.headH }}
        onPointerDown={onHeadDown}
        onPointerMove={onHeadMove}
        onPointerUp={onHeadUp}
        onPointerCancel={onHeadUp}
        onPointerLeave={() => { if (!drag.current) props.hover.set(null) }}
        onContextMenu={e => {
          e.preventDefault()
          props.onContextMenu({ area: 'ruler', x: e.clientX, y: e.clientY, col: headCol(e.clientX) })
        }}
        onWheel={forwardWheel}
      />
      <NameColumn
        pm={pm}
        height={size.h}
        scroll={scrollSignal}
        selection={props.selection}
        caretRow={props.caret?.rowId ?? null}
        hover={props.hover}
        onSelect={props.onSelect}
        onMoveRows={props.onMoveRows}
        onRename={props.onRenameRow}
        onContextMenu={props.onContextMenu}
        onWheel={forwardWheel}
      />
      <div
        ref={scrollerRef}
        className={`aw-body${props.editing ? ' editing' : ''}`}
        tabIndex={0}
        role="grid"
        aria-label="Alignment"
        aria-rowcount={pm.bodyRows.length}
        aria-colcount={pm.width}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => { if (!drag.current) props.hover.set(null) }}
        onContextMenu={onContextMenu}
        onKeyDown={props.onKeyDown}
      >
        <div className="aw-sizer" style={{ width: Math.max(totalW, size.w), height: Math.max(totalH, size.h) }}>
          <div className="aw-stage" style={{ width: size.w, height: size.h }}>
            <canvas ref={bodyRef} className="aw-canvas" style={{ width: size.w, height: size.h }} />
            <canvas ref={overlayRef} className="aw-canvas" style={{ width: size.w, height: size.h }} />
          </div>
        </div>
      </div>
    </div>
  )
})

export default AlignmentGrid

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

interface NameProps {
  pm: PaintModel
  height: number
  scroll: Signal<{ x: number; y: number }>
  selection: Selection | null
  caretRow: string | null
  hover: Signal<HoverInfo | null>
  onSelect: Props['onSelect']
  onMoveRows: Props['onMoveRows']
  onRename: Props['onRenameRow']
  onContextMenu: Props['onContextMenu']
  onWheel: (e: React.WheelEvent) => void
}

/**
 * The name column. Only rows in view are rendered. Click selects a row,
 * Ctrl/Cmd+click adds or removes one, Shift+click selects a run; dragging a
 * selected name moves the selected rows.
 */
const NameColumn = memo(function NameColumn({
  pm, height, scroll, selection, caretRow, hover, onSelect, onMoveRows, onRename, onContextMenu, onWheel,
}: NameProps) {
  const { y } = useSignal(scroll)
  const hovered = useSignal(hover)?.rowId ?? null
  const { pitch, rowH } = pm.m
  const rows = pm.bodyRows
  const first = Math.max(0, Math.floor(y / pitch) - 1)
  const last = Math.min(rows.length, Math.ceil((y + height) / pitch) + 1)
  const fullRows = useMemo(() => {
    if (!selection) return new Set<string>()
    return selection.c0 === 0 && selection.c1 >= pm.width ? new Set(selection.rowIds) : new Set<string>()
  }, [selection, pm.width])
  const partRows = useMemo(() => new Set(selection?.rowIds ?? []), [selection])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<number | null>(null)
  const press = useRef<{ id: string; index: number; y: number; dragging: boolean } | null>(null)

  const indexAt = (clientY: number) => {
    const r = listRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(rows.length, Math.round((clientY - r.top + y) / pitch)))
  }

  const select = (e: React.PointerEvent | React.MouseEvent, i: number) => {
    const id = rows[i].id
    const current = selection && selection.c0 === 0 && selection.c1 >= pm.width ? selection.rowIds : []
    let ids: string[]
    if (e.shiftKey && anchor.current !== null) {
      const a = Math.min(anchor.current, i)
      const b = Math.max(anchor.current, i)
      ids = rows.slice(a, b + 1).map(r => r.id)
    } else if (e.ctrlKey || e.metaKey) {
      ids = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
      anchor.current = i
    } else {
      ids = [id]
      anchor.current = i
    }
    const order = new Map(rows.map((r, k) => [r.id, k]))
    ids.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    onSelect(ids.length ? { rowIds: ids, c0: 0, c1: pm.width } : null, ids.length ? { rowId: id, col: 0 } : null)
  }

  const onDown = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0 || renaming) return
    const id = rows[i].id
    // Pressing an already selected row may start a drag of the selection; act on release instead.
    if (fullRows.has(id) && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      press.current = { id, index: i, y: e.clientY, dragging: false }
    } else {
      select(e, i)
      press.current = { id, index: i, y: e.clientY, dragging: false }
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const p = press.current
    if (!p) return
    if (!p.dragging && Math.abs(e.clientY - p.y) > 4) p.dragging = true
    if (p.dragging) setDropAt(indexAt(e.clientY))
  }
  const onUp = (e: React.PointerEvent, i: number) => {
    const p = press.current
    press.current = null
    if (!p) return
    if (p.dragging) {
      const before = indexAt(e.clientY)
      setDropAt(null)
      const ids = fullRows.has(p.id) ? [...fullRows] : [p.id]
      // Body indices to document indices: the pinned reference is not in the body.
      const target = before < rows.length ? pm.doc.rows.indexOf(rows[before]) : pm.doc.rows.length
      onMoveRows(ids, target)
    } else if (fullRows.has(p.id) && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      select(e, i)
    }
  }

  return (
    <div className="aw-names" ref={listRef} onWheel={onWheel} style={{ height: '100%' }}>
      {rows.slice(first, last).map((row, k) => {
        const i = first + k
        const cls = [
          'aw-name',
          fullRows.has(row.id) ? 'selected' : partRows.has(row.id) ? 'partial' : '',
          caretRow === row.id ? 'caret' : '',
          hovered === row.id ? 'hover' : '',
          pm.reference === row ? 'is-ref' : '',
        ].filter(Boolean).join(' ')
        return (
          <div
            key={row.id}
            className={cls}
            style={{ top: i * pitch - y, height: rowH }}
            onPointerDown={e => onDown(e, i)}
            onPointerMove={onMove}
            onPointerUp={e => onUp(e, i)}
            onDoubleClick={() => setRenaming(row.id)}
            onContextMenu={e => {
              e.preventDefault()
              if (!partRows.has(row.id)) select(e, i)
              onContextMenu({ area: 'name', x: e.clientX, y: e.clientY, rowId: row.id })
            }}
            title={rowTitle(row)}
          >
            {renaming === row.id ? (
              <input
                className="aw-name-input"
                defaultValue={row.name}
                autoFocus
                onFocus={e => e.currentTarget.select()}
                onPointerDown={e => e.stopPropagation()}
                onBlur={e => { onRename(row.id, e.currentTarget.value); setRenaming(null) }}
                onKeyDown={e => {
                  e.stopPropagation()
                  if (e.key === 'Enter') e.currentTarget.blur()
                  else if (e.key === 'Escape') setRenaming(null)
                }}
              />
            ) : (
              <>
                {pm.reference === row && <span className="aw-ref-badge">REF</span>}
                <span className="aw-name-text">{row.name}</span>
              </>
            )}
          </div>
        )
      })}
      {dropAt !== null && <div className="aw-drop" style={{ top: dropAt * pitch - y - 1 }} />}
    </div>
  )
})

function rowTitle(row: AlnRow): string {
  let n = 0
  for (let i = 0; i < row.seq.length; i++) if (row.seq.charCodeAt(i) !== 45) n++
  const parts = [row.name, `${n.toLocaleString()} residues`]
  if (row.source && row.source.name !== row.name) parts.push(`from ${row.source.name}${row.source.reversed ? ' (reverse complement)' : ''}`)
  return parts.join('\n')
}
