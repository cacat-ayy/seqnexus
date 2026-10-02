/**
 * The scrolling trace view.
 *
 * A native scroller sized to the whole read, with a sticky stage of two
 * canvases on top: content (ruler, calls, quality, traces), repainted on
 * scroll and edits, and marks (selection, caret, hover, hits, trim edges),
 * repainted on every pointer move. One long row by default; wrapped, the
 * read breaks into rows that fit the width and the view scrolls vertically.
 *
 * Pointer: drag to select, Shift+click to extend, drag a trim edge's grip
 * in the ruler to move it. Ctrl+wheel zooms around the pointer, Alt+wheel
 * changes peak height, plain wheel scrolls along the read.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { Codon, TraceModel } from '../../sanger/model'
import { ZOOM_WIDTHS, type TraceView } from '../../sanger/view'
import { readAlnTheme, useThemeVersion, type AlnTheme } from '../alignment/theme'
import type { Signal } from '../alignment/signal'
import { paintMarks, paintRow, trackLayout, type RowGeom, type TrackLayout } from './paint'

const PAD = 24
const WRAP_TRACE_H = 120
const WRAP_GAP = 14

export interface TraceSelection { d0: number; d1: number }

export interface TraceCanvasHandle {
  scrollToColumn: (d: number, align?: 'center' | 'start') => void
  /** Scroll just enough to show [d0, d1). */
  reveal: (d0: number, d1?: number) => void
  focus: () => void
  visibleRange: () => [number, number]
}

interface Props {
  model: TraceModel
  view: TraceView
  codons: readonly Codon[] | null
  selection: TraceSelection | null
  caret: number | null
  editing: boolean
  insertMode: boolean
  hits: readonly [number, number][]
  currentHit: number
  hover: Signal<number | null>
  onSelect: (sel: TraceSelection | null, caret: number | null) => void
  /** A trim edge moved to display column boundaries [d0, d1); `commit` on release. */
  onTrim: (d0: number, d1: number, commit: boolean) => void
  onZoom: (step: number) => void
  onHeight: (step: number) => void
  onViewport: (start: number, end: number) => void
  onContextMenu: (at: { x: number; y: number; col: number }) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

interface Geometry {
  wrap: boolean
  cellW: number
  tracks: TrackLayout
  /** Columns per row (wrapped) or n (one row). */
  perRow: number
  rowH: number
  rows: number
  contentW: number
  contentH: number
}

type Drag =
  | { kind: 'select'; anchor: number; moved: boolean }
  | { kind: 'trim'; side: 'start' | 'end' }

const TraceCanvas = forwardRef<TraceCanvasHandle, Props>(function TraceCanvas(props, ref) {
  const { model: m, view } = props
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

  const cellW = ZOOM_WIDTHS[view.zoom] ?? 12
  const geo = computeGeometry(m, view, cellW, size)
  const geoRef = useRef(geo)
  geoRef.current = geo

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

  // ---- Rows on screen ----
  const visibleRows = useCallback((): RowGeom[] => {
    const el = scrollerRef.current
    const g = geoRef.current
    if (!el) return []
    const sx = el.scrollLeft
    const sy = el.scrollTop
    const n = live.current.model.n
    if (!g.wrap) {
      const d0 = Math.max(0, Math.floor((sx - PAD) / g.cellW))
      const d1 = Math.min(n, Math.ceil((sx + size.w - PAD) / g.cellW) + 1)
      return [{ x0: PAD - sx + d0 * g.cellW, y0: 0, d0, d1, cellW: g.cellW, clipX: 0, clipW: size.w }]
    }
    const out: RowGeom[] = []
    const r0 = Math.max(0, Math.floor((sy - 8) / g.rowH))
    const r1 = Math.min(g.rows, Math.ceil((sy + size.h) / g.rowH) + 1)
    for (let r = r0; r < r1; r++) {
      const d0 = r * g.perRow
      out.push({ x0: PAD, y0: 8 + r * g.rowH - sy, d0, d1: Math.min(n, d0 + g.perRow), cellW: g.cellW, clipX: 0, clipW: size.w })
    }
    return out
  }, [size])

  // ---- Painting ----
  const frame = useRef(0)
  const dirty = useRef({ body: true, marks: true })

  const paint = useCallback(() => {
    frame.current = 0
    const t = theme.current
    if (!t || size.w === 0) return
    const p = live.current
    const g = geoRef.current
    const dpr = window.devicePixelRatio || 1
    const prep = (c: HTMLCanvasElement | null) => {
      if (!c) return null
      const W = Math.max(1, Math.round(size.w * dpr))
      const H = Math.max(1, Math.round(size.h * dpr))
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
      const ctx = c.getContext('2d')
      if (!ctx) return null
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size.w, size.h)
      return ctx
    }
    const rows = visibleRows()
    if (dirty.current.body) {
      const ctx = prep(bodyRef.current)
      if (ctx) {
        ctx.fillStyle = t.bg
        ctx.fillRect(0, 0, size.w, size.h)
        for (const row of rows) paintRow(ctx, p.model, p.view, t, g.tracks, row, p.codons)
      }
    }
    if (dirty.current.marks) {
      const ctx = prep(marksRef.current)
      if (ctx) {
        const state = {
          selection: p.selection, caret: p.caret, hover: p.hover.get(), editing: p.editing,
          insertMode: p.insertMode, hits: p.hits, currentHit: p.currentHit, focused,
        }
        for (const row of rows) paintMarks(ctx, p.model, t, g.tracks, row, state)
      }
    }
    dirty.current = { body: false, marks: false }
  }, [size, visibleRows, focused])

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

  useLayoutEffect(() => { schedule(true) }, [m, view, props.codons, size, schedule])
  useLayoutEffect(() => { schedule(false) }, [props.selection, props.caret, props.editing, props.insertMode, props.hits, props.currentHit, focused, schedule])
  useEffect(() => props.hover.subscribe(() => schedule(false)), [props.hover, schedule])

  // ---- Viewport ----
  const visibleRange = useCallback((): [number, number] => {
    const rows = visibleRows()
    if (rows.length === 0) return [0, 0]
    if (!geoRef.current.wrap) {
      const el = scrollerRef.current!
      const g = geoRef.current
      return [Math.max(0, (el.scrollLeft - PAD) / g.cellW), Math.min(live.current.model.n, (el.scrollLeft + size.w - PAD) / g.cellW)]
    }
    return [rows[0].d0, rows[rows.length - 1].d1]
  }, [visibleRows, size])

  const publishViewport = useCallback(() => {
    const [a, b] = visibleRange()
    live.current.onViewport(a, b)
  }, [visibleRange])

  useLayoutEffect(() => { publishViewport() }, [publishViewport, size, geo.cellW, geo.wrap, m.n])

  // Keep the column under the pointer still across a wheel zoom.
  useLayoutEffect(() => {
    const a = zoomAnchor.current
    const el = scrollerRef.current
    if (!a || !el || geo.wrap) return
    el.scrollLeft = PAD + a.col * cellW - a.px
    zoomAnchor.current = null
  }, [cellW, geo.wrap])

  const onScroll = () => {
    schedule(true)
    publishViewport()
  }

  // ---- Hit testing ----
  const hitAt = useCallback((clientX: number, clientY: number) => {
    const el = scrollerRef.current!
    const r = el.getBoundingClientRect()
    const x = clientX - r.left
    const y = clientY - r.top
    const rows = visibleRows()
    const g = geoRef.current
    const n = live.current.model.n
    let row = rows[0]
    for (const rw of rows) if (y >= rw.y0 - WRAP_GAP / 2) row = rw
    if (!row) return { col: 0, edge: 0, x, y, inRuler: false, row: null as RowGeom | null }
    const f = row.d0 + (x - row.x0) / g.cellW
    const col = Math.max(0, Math.min(n - 1, Math.floor(f)))
    const edge = Math.max(0, Math.min(n, Math.round(f)))
    const ry = y - row.y0
    const inRuler = ry >= g.tracks.ruler[0] && ry < g.tracks.ruler[1]
    return { col, edge, x, y, inRuler, row }
  }, [visibleRows])

  const trimEdgeNear = (hit: ReturnType<typeof hitAt>): 'start' | 'end' | null => {
    if (!hit.row) return null
    const g = geoRef.current
    const [t0, t1] = live.current.model.trim
    const xOf = (d: number) => hit.row!.x0 + (d - hit.row!.d0) * g.cellW
    const ds = Math.abs(hit.x - xOf(t0))
    const de = Math.abs(hit.x - xOf(t1))
    const ry = hit.y - hit.row.y0
    // The grips sit at the top of the row; the edges themselves are grabbable anywhere in the ruler.
    if (ry > g.tracks.calls[0] + 2) return null
    if (ds <= 7 && ds <= de) return 'start'
    if (de <= 7) return 'end'
    return null
  }

  // ---- Pointer ----
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const hit = hitAt(e.clientX, e.clientY)
    const p = live.current
    scrollerRef.current?.focus({ preventScroll: true })
    const edge = trimEdgeNear(hit)
    if (edge) {
      drag.current = { kind: 'trim', side: edge }
      scrollerRef.current!.setPointerCapture(e.pointerId)
      return
    }
    if (e.shiftKey && (p.caret !== null || p.selection)) {
      const anchor = p.selection ? (p.caret === p.selection.d0 ? p.selection.d1 - 1 : p.selection.d0) : p.caret!
      p.onSelect({ d0: Math.min(anchor, hit.col), d1: Math.max(anchor, hit.col) + 1 }, hit.col)
      drag.current = { kind: 'select', anchor, moved: true }
    } else {
      drag.current = { kind: 'select', anchor: hit.col, moved: false }
      p.onSelect(null, hit.col)
    }
    scrollerRef.current!.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const hit = hitAt(e.clientX, e.clientY)
    const p = live.current
    const d = drag.current
    if (!d) {
      p.hover.set(hit.row ? hit.col : null)
      const el = scrollerRef.current!
      el.style.cursor = trimEdgeNear(hit) ? 'ew-resize' : ''
      return
    }
    autoScroll(e.clientX)
    if (d.kind === 'trim') {
      const [t0, t1] = p.model.trim
      if (d.side === 'start') p.onTrim(Math.min(hit.edge, t1), t1, false)
      else p.onTrim(t0, Math.max(hit.edge, t0), false)
      return
    }
    if (hit.col !== d.anchor || d.moved) {
      d.moved = true
      p.onSelect({ d0: Math.min(d.anchor, hit.col), d1: Math.max(d.anchor, hit.col) + 1 }, hit.col)
    }
    p.hover.set(hit.col)
  }

  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    const el = scrollerRef.current
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (d?.kind === 'trim') {
      const [t0, t1] = live.current.model.trim
      live.current.onTrim(t0, t1, true)
    }
  }

  const autoScroll = (clientX: number) => {
    const el = scrollerRef.current
    if (!el || geoRef.current.wrap) return
    const r = el.getBoundingClientRect()
    if (clientX < r.left + 24) el.scrollLeft -= 18
    else if (clientX > r.right - 24) el.scrollLeft += 18
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const hit = hitAt(e.clientX, e.clientY)
    const p = live.current
    const inSel = p.selection && hit.col >= p.selection.d0 && hit.col < p.selection.d1
    if (!inSel) p.onSelect(null, hit.col)
    p.onContextMenu({ x: e.clientX, y: e.clientY, col: hit.col })
  }

  // Wheel: Ctrl zooms around the pointer, Alt changes peak height, plain scrolls along the read.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const g = geoRef.current
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const r = el.getBoundingClientRect()
        const px = e.clientX - r.left
        zoomAnchor.current = { col: (el.scrollLeft + px - PAD) / g.cellW, px }
        live.current.onZoom(e.deltaY < 0 ? 1 : -1)
      } else if (e.altKey) {
        e.preventDefault()
        live.current.onHeight(e.deltaY < 0 ? 1 : -1)
      } else if (!g.wrap && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---- Handle ----
  useImperativeHandle(ref, () => ({
    scrollToColumn(d, align = 'center') {
      const el = scrollerRef.current
      if (!el) return
      const g = geoRef.current
      if (g.wrap) {
        const row = Math.floor(d / g.perRow)
        el.scrollTop = Math.max(0, 8 + row * g.rowH - (align === 'center' ? (size.h - g.rowH) / 2 : 0))
      } else {
        const x = PAD + d * g.cellW
        el.scrollLeft = Math.max(0, align === 'center' ? x - size.w / 2 + g.cellW / 2 : x - PAD)
      }
    },
    reveal(d0, d1 = d0 + 1) {
      const el = scrollerRef.current
      if (!el) return
      const g = geoRef.current
      if (g.wrap) {
        const top = 8 + Math.floor(d0 / g.perRow) * g.rowH
        if (top < el.scrollTop || top + g.rowH > el.scrollTop + size.h) el.scrollTop = Math.max(0, top - (size.h - g.rowH) / 2)
        return
      }
      const a = PAD + d0 * g.cellW
      const b = PAD + d1 * g.cellW
      if (a >= el.scrollLeft + 8 && b <= el.scrollLeft + size.w - 8) return
      el.scrollLeft = Math.max(0, (a + b) / 2 - size.w / 2)
    },
    focus() { scrollerRef.current?.focus({ preventScroll: true }) },
    visibleRange,
  }), [size, visibleRange])

  return (
    <div
      ref={scrollerRef}
      className={`tw-canvas-scroller${props.editing ? ' editing' : ''}${geo.wrap ? ' wrapped' : ''}`}
      tabIndex={0}
      role="application"
      aria-label="Sequencing trace"
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
      <div className="tw-sizer" style={{ width: Math.max(geo.contentW, size.w), height: Math.max(geo.contentH, size.h) }}>
        <div className="tw-stage" style={{ width: size.w, height: size.h }}>
          <canvas ref={bodyRef} className="tw-layer" style={{ width: size.w, height: size.h }} />
          <canvas ref={marksRef} className="tw-layer" style={{ width: size.w, height: size.h }} />
        </div>
      </div>
    </div>
  )
})

export default TraceCanvas

function computeGeometry(m: TraceModel, view: TraceView, cellW: number, size: { w: number; h: number }): Geometry {
  if (!view.wrap) {
    const tracks = trackLayout(m, view, { height: size.h })
    return {
      wrap: false, cellW, tracks, perRow: m.n, rowH: tracks.height, rows: 1,
      contentW: PAD * 2 + m.n * cellW, contentH: size.h,
    }
  }
  const tracks = trackLayout(m, view, { traceHeight: WRAP_TRACE_H })
  const perRow = Math.max(10, Math.floor((size.w - PAD * 2) / cellW))
  const rows = Math.max(1, Math.ceil(m.n / perRow))
  const rowH = tracks.height + WRAP_GAP
  return { wrap: true, cellW, tracks, perRow, rowH, rows, contentW: size.w, contentH: 16 + rows * rowH }
}
