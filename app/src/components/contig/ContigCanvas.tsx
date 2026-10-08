/**
 * The scrolling contig view: a native scroller sized to the whole contig
 * with a sticky stage of two canvases (content, and marks that repaint on
 * every pointer move), like the trace and alignment views.
 *
 * Pointer: click a cell for the caret, drag for a block; drag in the header
 * to select columns across every read; click a name to select that read,
 * Shift/Ctrl for more, double-click to open the read. Ctrl+wheel zooms
 * around the pointer.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { Signal } from '../alignment/signal'
import { useCanvasLayers, type StageSize } from '../tracks/useCanvasLayers'
import {
  GUTTER, ROW_H, paintContig, paintMarks, rowTop, type ContigSelection, type Geometry, type MarkState, type PaintInput, type PaintState,
} from './paint'

export interface ContigCanvasHandle {
  revealColumn: (col: number, row?: number) => void
  scrollToColumn: (col: number) => void
  focus: () => void
  visibleColumns: () => [number, number]
}

export interface HoverCell { row: number; col: number }

interface Props {
  input: PaintInput
  selection: ContigSelection | null
  caret: { row: number; col: number } | null
  editing: boolean
  hits: readonly [number, number][]
  currentHit: number
  hover: Signal<HoverCell | null>
  onSelect: (sel: ContigSelection | null, caret: { row: number; col: number } | null) => void
  onOpenRow: (row: number) => void
  onZoom: (step: number) => void
  onViewport: (start: number, end: number) => void
  /** `col` is a column of the contig; `at` the column under the pointer, which may lie in the margins (trimmed ends). */
  onContextMenu: (at: { x: number; y: number; row: number; col: number; at: number; gutter: boolean }) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

type Drag =
  | { kind: 'cells'; row: number; col: number }
  | { kind: 'columns'; col: number }
  | { kind: 'rows'; row: number }

const ContigCanvas = forwardRef<ContigCanvasHandle, Props>(function ContigCanvas(props, ref) {
  const { input } = props
  const g = input.geo
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const drag = useRef<Drag | null>(null)
  const zoomAnchor = useRef<{ col: number; px: number } | null>(null)
  const live = useRef(props)
  const focusedRef = useRef(focused)
  live.current = props
  focusedRef.current = focused

  // Room before column 0 for trimmed ends: the scroller is that much wider,
  // and the columns' scroll position is the scroller's less it.
  const leadPx = input.margins.left * g.cellW
  const lead = () => live.current.input.margins.left * live.current.input.geo.cellW

  // ---- Painting ----
  const scrollState = (sz: StageSize): PaintState => {
    const el = scrollerRef.current
    return { scrollX: (el?.scrollLeft ?? 0) - lead(), scrollY: el?.scrollTop ?? 0, w: sz.w, h: sz.h }
  }
  const { size, bodyRef, marksRef, schedule } = useCanvasLayers(scrollerRef, {
    body: (ctx, t, sz) => paintContig(ctx, live.current.input, t, scrollState(sz)),
    marks: (ctx, t, sz) => {
      const p = live.current
      const f = focusedRef.current
      const m: MarkState = {
        selection: p.selection, caret: p.caret, hover: p.hover.get(), editing: p.editing, focused: f,
        hits: p.hits, currentHit: p.currentHit,
      }
      paintMarks(ctx, p.input.doc, p.input.geo, t, scrollState(sz), m)
    },
  })
  useLayoutEffect(() => { schedule(true) }, [input, schedule])
  useLayoutEffect(() => { schedule(false) }, [props.selection, props.caret, props.editing, props.hits, props.currentHit, focused, schedule])
  useEffect(() => props.hover.subscribe(() => schedule(false)), [props.hover, schedule])

  // ---- Viewport ----
  const visibleColumns = useCallback((): [number, number] => {
    const el = scrollerRef.current
    if (!el) return [0, 0]
    const x = el.scrollLeft - leadPx
    return [x / g.cellW, (x + size.w - GUTTER) / g.cellW]
  }, [g.cellW, size.w, leadPx])
  const publish = useCallback(() => {
    const [a, b] = visibleColumns()
    live.current.onViewport(Math.max(0, a), Math.min(live.current.input.doc.width, b))
  }, [visibleColumns])
  useLayoutEffect(() => { publish() }, [publish, size, input])
  useLayoutEffect(() => {
    const a = zoomAnchor.current
    const el = scrollerRef.current
    if (!a || !el) return
    el.scrollLeft = a.col * g.cellW - (a.px - GUTTER) + leadPx
    zoomAnchor.current = null
  }, [g.cellW]) // eslint-disable-line react-hooks/exhaustive-deps
  // When the margin changes (trimmed ends shown or hidden, a read extended), keep the columns in view where they were.
  const lastLead = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    if (lastLead.current === null) el.scrollLeft = leadPx
    else if (zoomAnchor.current === null && leadPx !== lastLead.current) el.scrollLeft += leadPx - lastLead.current
    lastLead.current = leadPx
  }, [leadPx])

  const onScroll = () => { schedule(true); publish() }

  // ---- Hit testing ----
  const hitAt = (clientX: number, clientY: number) => {
    const el = scrollerRef.current!
    const r = el.getBoundingClientRect()
    const x = clientX - r.left
    const y = clientY - r.top
    const p = live.current.input
    const at = Math.floor((x - GUTTER + el.scrollLeft - lead()) / p.geo.cellW)
    const col = Math.max(0, Math.min(p.doc.width - 1, at))
    const inHeader = y < p.geo.headerH
    const row = inHeader ? -1 : Math.floor((y - p.geo.headerH + el.scrollTop) / p.geo.pitch)
    const valid = row >= 0 && row < p.doc.rows.length
    const onBases = valid && y - rowTop(row, p.geo, { scrollX: 0, scrollY: el.scrollTop, w: 0, h: 0 }) < ROW_H
    return { x, y, col, at, row: valid ? row : -1, inHeader, gutter: x < GUTTER, onBases }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const h = hitAt(e.clientX, e.clientY)
    const p = live.current
    scrollerRef.current?.focus({ preventScroll: true })
    scrollerRef.current!.setPointerCapture(e.pointerId)
    if (h.gutter) {
      if (h.row < 0) return
      if (e.detail === 2) { p.onOpenRow(h.row); return }
      const s = p.selection
      const anchor = e.shiftKey && s && s.r0 >= 0 ? s.r0 : h.row
      p.onSelect({ r0: Math.min(anchor, h.row), r1: Math.max(anchor, h.row) + 1, c0: 0, c1: p.input.doc.width }, null)
      drag.current = { kind: 'rows', row: anchor }
      return
    }
    if (h.inHeader) {
      const anchor = e.shiftKey && p.selection ? p.selection.c0 : h.col
      p.onSelect({ r0: -1, r1: -1, c0: Math.min(anchor, h.col), c1: Math.max(anchor, h.col) + 1 }, { row: -1, col: h.col })
      drag.current = { kind: 'columns', col: anchor }
      return
    }
    if (h.row < 0) { p.onSelect(null, null); return }
    if (e.shiftKey && p.caret && p.caret.row >= 0) {
      const a = p.caret
      p.onSelect({ r0: Math.min(a.row, h.row), r1: Math.max(a.row, h.row) + 1, c0: Math.min(a.col, h.col), c1: Math.max(a.col, h.col) + 1 }, null)
      drag.current = { kind: 'cells', row: a.row, col: a.col }
      return
    }
    p.onSelect(null, { row: h.row, col: h.col })
    drag.current = { kind: 'cells', row: h.row, col: h.col }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const h = hitAt(e.clientX, e.clientY)
    const p = live.current
    const d = drag.current
    if (!d) { p.hover.set(h.gutter ? null : { row: h.row, col: h.col }); return }
    autoScroll(e.clientX, e.clientY)
    if (d.kind === 'columns') {
      p.onSelect({ r0: -1, r1: -1, c0: Math.min(d.col, h.col), c1: Math.max(d.col, h.col) + 1 }, null)
    } else if (d.kind === 'rows') {
      const row = h.row < 0 ? (h.inHeader ? 0 : p.input.doc.rows.length - 1) : h.row
      p.onSelect({ r0: Math.min(d.row, row), r1: Math.max(d.row, row) + 1, c0: 0, c1: p.input.doc.width }, null)
    } else {
      const row = h.row < 0 ? (h.inHeader ? 0 : p.input.doc.rows.length - 1) : h.row
      if (row === d.row && h.col === d.col) return
      p.onSelect({ r0: Math.min(d.row, row), r1: Math.max(d.row, row) + 1, c0: Math.min(d.col, h.col), c1: Math.max(d.col, h.col) + 1 }, null)
    }
    p.hover.set({ row: h.row, col: h.col })
  }

  const endDrag = (e: React.PointerEvent) => {
    drag.current = null
    const el = scrollerRef.current
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  }

  const autoScroll = (clientX: number, clientY: number) => {
    const el = scrollerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (clientX < r.left + GUTTER + 20) el.scrollLeft -= 16
    else if (clientX > r.right - 20) el.scrollLeft += 16
    if (clientY > r.bottom - 20) el.scrollTop += 16
    else if (clientY < r.top + live.current.input.geo.headerH + 10) el.scrollTop -= 16
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const h = hitAt(e.clientX, e.clientY)
    const p = live.current
    const s = p.selection
    const inside = s && h.col >= s.c0 && h.col < s.c1 && (s.r0 < 0 || (h.row >= s.r0 && h.row < s.r1))
    if (!inside && !h.gutter) p.onSelect(null, { row: h.row, col: h.col })
    if (!inside && h.gutter && h.row >= 0) p.onSelect({ r0: h.row, r1: h.row + 1, c0: 0, c1: p.input.doc.width }, null)
    p.onContextMenu({ x: e.clientX, y: e.clientY, row: h.row, col: h.col, at: h.at, gutter: h.gutter })
  }

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left
      zoomAnchor.current = { col: (el.scrollLeft - lead() + px - GUTTER) / live.current.input.geo.cellW, px }
      live.current.onZoom(e.deltaY < 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useImperativeHandle(ref, () => ({
    revealColumn(col, row) {
      const el = scrollerRef.current
      if (!el) return
      const x = col * g.cellW + leadPx
      const viewW = size.w - GUTTER
      if (x < el.scrollLeft + 10 || x + g.cellW > el.scrollLeft + viewW - 10) el.scrollLeft = Math.max(0, x - viewW / 2)
      if (row !== undefined && row >= 0) {
        const y = row * g.pitch
        const viewH = size.h - g.headerH
        if (y < el.scrollTop || y + g.pitch > el.scrollTop + viewH) el.scrollTop = Math.max(0, y - viewH / 3)
      }
    },
    scrollToColumn(col) {
      const el = scrollerRef.current
      if (el) el.scrollLeft = Math.max(0, col * g.cellW + leadPx)
    },
    focus() { scrollerRef.current?.focus({ preventScroll: true }) },
    visibleColumns,
  }), [g, size, visibleColumns, leadPx])

  const contentW = GUTTER + (input.margins.left + input.doc.width + input.margins.right) * g.cellW + 40
  const contentH = g.headerH + input.doc.rows.length * g.pitch + 24
  return (
    <div
      ref={scrollerRef}
      className={`cw-scroller${props.editing ? ' editing' : ''}`}
      tabIndex={0}
      role="grid"
      aria-label="Contig"
      aria-rowcount={input.doc.rows.length}
      aria-colcount={input.doc.width}
      onScroll={onScroll}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => { if (!drag.current) props.hover.set(null) }}
      onContextMenu={onContextMenu}
      onKeyDown={props.onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div className="cw-sizer" style={{ width: Math.max(contentW, size.w), height: Math.max(contentH, size.h) }}>
        <div className="cw-canvas-stage" style={{ width: size.w, height: size.h }}>
          <canvas ref={bodyRef} className="cw-layer" style={{ width: size.w, height: size.h }} />
          <canvas ref={marksRef} className="cw-layer" style={{ width: size.w, height: size.h }} />
        </div>
      </div>
    </div>
  )
})

export default ContigCanvas

export type { Geometry }
