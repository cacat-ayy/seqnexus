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
import { readAlnTheme, useThemeVersion, type AlnTheme } from '../alignment/theme'
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
  onContextMenu: (at: { x: number; y: number; row: number; col: number; gutter: boolean }) => void
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
  const bodyRef = useRef<HTMLCanvasElement>(null)
  const marksRef = useRef<HTMLCanvasElement>(null)
  const themeVersion = useThemeVersion(scrollerRef)
  const theme = useRef<AlnTheme | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [focused, setFocused] = useState(false)
  const drag = useRef<Drag | null>(null)
  const zoomAnchor = useRef<{ col: number; px: number } | null>(null)
  const live = useRef(props)
  live.current = props

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const state = useCallback((): PaintState => {
    const el = scrollerRef.current
    return { scrollX: el?.scrollLeft ?? 0, scrollY: el?.scrollTop ?? 0, w: size.w, h: size.h }
  }, [size])

  // ---- Painting ----
  const frame = useRef(0)
  const dirty = useRef({ body: true, marks: true })
  const paint = useCallback(() => {
    frame.current = 0
    const t = theme.current
    if (!t || size.w === 0) return
    const dpr = window.devicePixelRatio || 1
    const prep = (c: HTMLCanvasElement | null) => {
      if (!c) return null
      const W = Math.max(1, Math.round(size.w * dpr))
      const H = Math.max(1, Math.round(size.h * dpr))
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
      const ctx = c.getContext('2d')
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
      return ctx
    }
    const p = live.current
    const st = state()
    if (dirty.current.body) {
      const ctx = prep(bodyRef.current)
      if (ctx) paintContig(ctx, p.input, t, st)
    }
    if (dirty.current.marks) {
      const ctx = prep(marksRef.current)
      const m: MarkState = {
        selection: p.selection, caret: p.caret, hover: p.hover.get(), editing: p.editing, focused,
        hits: p.hits, currentHit: p.currentHit,
      }
      if (ctx) paintMarks(ctx, p.input.doc, p.input.geo, t, st, m)
    }
    dirty.current = { body: false, marks: false }
  }, [size, state, focused])

  const schedule = useCallback((body: boolean) => {
    if (body) dirty.current.body = true
    dirty.current.marks = true
    if (!frame.current) frame.current = requestAnimationFrame(paint)
  }, [paint])
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current) }, [])
  useLayoutEffect(() => {
    if (scrollerRef.current) theme.current = readAlnTheme(scrollerRef.current)
    schedule(true)
  }, [themeVersion, schedule])
  useLayoutEffect(() => { schedule(true) }, [input, size, schedule])
  useLayoutEffect(() => { schedule(false) }, [props.selection, props.caret, props.editing, props.hits, props.currentHit, focused, schedule])
  useEffect(() => props.hover.subscribe(() => schedule(false)), [props.hover, schedule])

  // ---- Viewport ----
  const visibleColumns = useCallback((): [number, number] => {
    const el = scrollerRef.current
    if (!el) return [0, 0]
    return [el.scrollLeft / g.cellW, (el.scrollLeft + size.w - GUTTER) / g.cellW]
  }, [g.cellW, size.w])
  const publish = useCallback(() => {
    const [a, b] = visibleColumns()
    live.current.onViewport(a, Math.min(live.current.input.doc.width, b))
  }, [visibleColumns])
  useLayoutEffect(() => { publish() }, [publish, size, input])
  useLayoutEffect(() => {
    const a = zoomAnchor.current
    const el = scrollerRef.current
    if (!a || !el) return
    el.scrollLeft = a.col * g.cellW - (a.px - GUTTER)
    zoomAnchor.current = null
  }, [g.cellW])

  const onScroll = () => { schedule(true); publish() }

  // ---- Hit testing ----
  const hitAt = (clientX: number, clientY: number) => {
    const el = scrollerRef.current!
    const r = el.getBoundingClientRect()
    const x = clientX - r.left
    const y = clientY - r.top
    const p = live.current.input
    const col = Math.max(0, Math.min(p.doc.width - 1, Math.floor((x - GUTTER + el.scrollLeft) / p.geo.cellW)))
    const inHeader = y < p.geo.headerH
    const row = inHeader ? -1 : Math.floor((y - p.geo.headerH + el.scrollTop) / p.geo.pitch)
    const valid = row >= 0 && row < p.doc.rows.length
    const onBases = valid && y - rowTop(row, p.geo, { scrollX: 0, scrollY: el.scrollTop, w: 0, h: 0 }) < ROW_H
    return { x, y, col, row: valid ? row : -1, inHeader, gutter: x < GUTTER, onBases }
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
    p.onContextMenu({ x: e.clientX, y: e.clientY, row: h.row, col: h.col, gutter: h.gutter })
  }

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left
      zoomAnchor.current = { col: (el.scrollLeft + px - GUTTER) / live.current.input.geo.cellW, px }
      live.current.onZoom(e.deltaY < 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useImperativeHandle(ref, () => ({
    revealColumn(col, row) {
      const el = scrollerRef.current
      if (!el) return
      const x = col * g.cellW
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
      if (el) el.scrollLeft = Math.max(0, col * g.cellW)
    },
    focus() { scrollerRef.current?.focus({ preventScroll: true }) },
    visibleColumns,
  }), [g, size, visibleColumns])

  const contentW = GUTTER + input.doc.width * g.cellW + 40
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
        <div className="cw-stage" style={{ width: size.w, height: size.h }}>
          <canvas ref={bodyRef} className="cw-layer" style={{ width: size.w, height: size.h }} />
          <canvas ref={marksRef} className="cw-layer" style={{ width: size.w, height: size.h }} />
        </div>
      </div>
    </div>
  )
})

export default ContigCanvas

export type { Geometry }
