/**
 * The stacked read view's canvas: every read in a row of its own, names on
 * the left, one ruler on top, one horizontal scroll for all of them.
 *
 * Same frame as the single-read canvas: a native scroller sized to the
 * whole stack with a sticky stage of two canvases, content (ruler, calls,
 * traces) repainted on scroll, and marks (gutter, hover column, picked row)
 * repainted on pointer moves. Only the rows on screen are drawn.
 *
 * Click picks a read, double-click (or Enter) opens it on its own, the
 * arrow keys move between reads. Ctrl+wheel zooms around the pointer,
 * Alt+wheel changes peak height, the wheel scrolls along the reads and
 * Shift+wheel down through them.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { TraceModel } from '../../sanger/model'
import { ZOOM_WIDTHS, type TraceView } from '../../sanger/view'
import { readAlnTheme, useThemeVersion, type AlnTheme } from '../alignment/theme'
import type { Signal } from '../alignment/signal'
import { withAlpha } from './paint'
import {
  GUTTER_W, LEAD, RULER_H, paintGutter, paintStackRow, paintStackRuler, rowBands,
  type GutterRow, type StackLayout,
} from './stack'

const TRAIL = 40

export interface StackHover { row: number; d: number | null }

export interface ReadStackHandle {
  revealRow: (row: number) => void
  focus: () => void
}

interface Props {
  models: readonly TraceModel[]
  rows: readonly GutterRow[]
  layout: StackLayout
  view: TraceView
  selected: number | null
  hover: Signal<StackHover | null>
  onSelect: (row: number) => void
  onOpen: (row: number) => void
  onContextMenu: (at: { x: number; y: number; row: number }) => void
  onZoom: (step: number) => void
  onHeight: (step: number) => void
}

const ReadStackCanvas = forwardRef<ReadStackHandle, Props>(function ReadStackCanvas(props, ref) {
  const { layout: L, view } = props
  const scrollerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLCanvasElement>(null)
  const marksRef = useRef<HTMLCanvasElement>(null)
  const themeVersion = useThemeVersion(scrollerRef)
  const theme = useRef<AlnTheme | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const zoomAnchor = useRef<{ col: number; px: number } | null>(null)
  const live = useRef(props)
  live.current = props

  const cellW = ZOOM_WIDTHS[view.zoom] ?? 12
  const cellRef = useRef(cellW)
  cellRef.current = cellW
  const contentW = GUTTER_W + LEAD + L.columns * cellW + TRAIL
  const contentH = RULER_H + props.models.length * L.rowH + 8

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** Shared columns and rows on screen. */
  const visible = useCallback(() => {
    const el = scrollerRef.current
    const p = live.current
    const cw = cellRef.current
    const sx = el?.scrollLeft ?? 0
    const sy = el?.scrollTop ?? 0
    const c0 = Math.max(0, Math.floor((sx - LEAD) / cw))
    const c1 = Math.min(p.layout.columns, Math.ceil((sx + size.w - GUTTER_W - LEAD) / cw) + 1)
    const r0 = Math.max(0, Math.floor((sy - RULER_H) / p.layout.rowH))
    const r1 = Math.min(p.models.length, Math.ceil((sy + size.h - RULER_H) / p.layout.rowH) + 1)
    // Shared column 0 starts here on the canvas.
    const x0 = GUTTER_W + LEAD - sx
    return { sx, sy, c0, c1, r0, r1, x0 }
  }, [size])

  // ---- Painting ----
  const frame = useRef(0)
  const dirty = useRef({ body: true, marks: true })

  const paint = useCallback(() => {
    frame.current = 0
    const t = theme.current
    if (!t || size.w === 0) return
    const p = live.current
    const cw = cellRef.current
    const v = visible()
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
    const clipX = GUTTER_W
    const clipW = size.w - GUTTER_W

    if (dirty.current.body) {
      const ctx = prep(bodyRef.current)
      if (ctx) {
        ctx.fillStyle = t.bg
        ctx.fillRect(0, 0, size.w, size.h)
        for (let r = v.r0; r < v.r1; r++) {
          const m = p.models[r]
          const off = p.layout.offsets[r]
          const d0 = Math.max(0, v.c0 - off)
          const d1 = Math.min(m.n, v.c1 - off)
          const y0 = RULER_H + r * p.layout.rowH - v.sy
          paintStackRow(ctx, m, p.view, t, p.layout, { x0: v.x0 + (d0 + off) * cw, y0, d0, d1: Math.max(d0, d1), cellW: cw, clipX, clipW })
        }
        paintStackRuler(ctx, t, p.layout, v.x0, cw, v.c0, v.c1, clipX, clipW)
      }
    }
    if (dirty.current.marks) {
      const ctx = prep(marksRef.current)
      if (ctx) {
        const h = p.hover.get()
        // The hovered column, through every read, to compare them at a glance.
        if (h && h.d !== null) {
          const col = h.d + p.layout.offsets[h.row]
          const x = v.x0 + col * cw
          if (x + cw > clipX) {
            ctx.save()
            ctx.beginPath()
            ctx.rect(clipX, RULER_H, clipW, size.h - RULER_H)
            ctx.clip()
            ctx.fillStyle = withAlpha(t.text, t.dark ? 0.08 : 0.06)
            ctx.fillRect(x, RULER_H, cw, size.h - RULER_H)
            const bands = rowBands(p.layout)
            const y = RULER_H + h.row * p.layout.rowH - v.sy
            ctx.strokeStyle = withAlpha(t.accent, 0.8)
            ctx.lineWidth = 1
            ctx.strokeRect(x + 0.5, y + bands.calls[0] + 0.5, cw - 1, bands.traces[1] - bands.calls[0] - 1)
            ctx.restore()
          }
        }
        if (p.selected !== null && p.selected >= v.r0 && p.selected < v.r1) {
          const y = RULER_H + p.selected * p.layout.rowH - v.sy
          ctx.fillStyle = withAlpha(t.accent, t.dark ? 0.07 : 0.05)
          ctx.fillRect(clipX, Math.max(RULER_H, y), clipW, p.layout.rowH - 5)
        }
        paintGutter(ctx, t, p.layout, p.rows, v.r0, v.r1, v.sy, size.h, p.selected, h?.row ?? null)
      }
    }
    dirty.current = { body: false, marks: false }
  }, [size, visible])

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

  useLayoutEffect(() => { schedule(true) }, [props.models, props.rows, L, view, size, schedule])
  useLayoutEffect(() => { schedule(false) }, [props.selected, schedule])
  useEffect(() => props.hover.subscribe(() => schedule(false)), [props.hover, schedule])

  // Keep the column under the pointer still across a wheel zoom.
  useLayoutEffect(() => {
    const a = zoomAnchor.current
    const el = scrollerRef.current
    if (!a || !el) return
    el.scrollLeft = LEAD + a.col * cellW - (a.px - GUTTER_W)
    zoomAnchor.current = null
  }, [cellW])

  // Lining the reads up differently moves them all; go to where they now line up.
  const align = useRef(view.stackAlign)
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || align.current === view.stackAlign) return
    align.current = view.stackAlign
    el.scrollLeft = view.stackAlign === 'trim' ? LEAD + Math.max(0, L.origin - 4) * cellRef.current : 0
  }, [view.stackAlign, L.origin])

  // ---- Hit testing ----
  const hitAt = useCallback((clientX: number, clientY: number) => {
    const el = scrollerRef.current!
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const p = live.current
    const v = visible()
    if (y < RULER_H) return null
    const row = Math.floor((y + v.sy - RULER_H) / p.layout.rowH)
    if (row < 0 || row >= p.models.length) return null
    let d: number | null = null
    if (x >= GUTTER_W) {
      const k = Math.floor((x - v.x0) / cellRef.current) - p.layout.offsets[row]
      if (k >= 0 && k < p.models[row].n) d = k
    }
    return { row, d }
  }, [visible])

  const onPointerMove = (e: React.PointerEvent) => {
    live.current.hover.set(hitAt(e.clientX, e.clientY))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    scrollerRef.current?.focus({ preventScroll: true })
    const hit = hitAt(e.clientX, e.clientY)
    if (hit) live.current.onSelect(hit.row)
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const hit = hitAt(e.clientX, e.clientY)
    if (hit) live.current.onOpen(hit.row)
  }

  const onContextMenu = (e: React.MouseEvent) => {
    const hit = hitAt(e.clientX, e.clientY)
    if (!hit) return
    e.preventDefault()
    live.current.onSelect(hit.row)
    live.current.onContextMenu({ x: e.clientX, y: e.clientY, row: hit.row })
  }

  const revealRow = useCallback((row: number) => {
    const el = scrollerRef.current
    if (!el) return
    const rowH = live.current.layout.rowH
    const top = RULER_H + row * rowH
    if (top - RULER_H < el.scrollTop) el.scrollTop = top - RULER_H
    else if (top + rowH > el.scrollTop + size.h) el.scrollTop = top + rowH - size.h
  }, [size])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const p = live.current
    const n = p.models.length
    if (n === 0) return
    const sel = p.selected
    const step = (to: number) => {
      e.preventDefault()
      const r = Math.max(0, Math.min(n - 1, to))
      p.onSelect(r)
      revealRow(r)
    }
    switch (e.key) {
      case 'ArrowDown': return step(sel === null ? 0 : sel + 1)
      case 'ArrowUp': return step(sel === null ? 0 : sel - 1)
      case 'Home': if (e.ctrlKey) return step(0); break
      case 'End': if (e.ctrlKey) return step(n - 1); break
      case 'Enter': if (sel !== null) { e.preventDefault(); p.onOpen(sel) } return
    }
    const el = scrollerRef.current
    if (!el) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      el.scrollLeft += (e.key === 'ArrowRight' ? 1 : -1) * (e.ctrlKey ? size.w * 0.8 : cellRef.current * 10)
    } else if (e.key === 'Home') {
      e.preventDefault()
      el.scrollLeft = 0
    } else if (e.key === 'End') {
      e.preventDefault()
      el.scrollLeft = el.scrollWidth
    }
  }

  // Wheel: Ctrl zooms around the pointer, Alt changes peak height, Shift
  // scrolls down through the reads, plain scrolls along them, as in the
  // single-read view. A trackpad's sideways swipe is left to the browser.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const r = el.getBoundingClientRect()
        const px = Math.max(GUTTER_W, e.clientX - r.left)
        zoomAnchor.current = { col: (el.scrollLeft + px - GUTTER_W - LEAD) / cellRef.current, px }
        live.current.onZoom(e.deltaY < 0 ? 1 : -1)
      } else if (e.altKey) {
        e.preventDefault()
        live.current.onHeight(e.deltaY < 0 ? 1 : -1)
      } else if (e.shiftKey) {
        e.preventDefault()
        el.scrollTop += e.deltaY || e.deltaX
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useImperativeHandle(ref, () => ({
    revealRow,
    focus() { scrollerRef.current?.focus({ preventScroll: true }) },
  }), [revealRow])

  return (
    <div
      ref={scrollerRef}
      className="tw-canvas-scroller rs-stack"
      tabIndex={0}
      role="application"
      aria-label="Sequencing traces, one read per row"
      onScroll={() => schedule(true)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => props.hover.set(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      <div className="tw-sizer" style={{ width: Math.max(contentW, size.w), height: Math.max(contentH, size.h) }}>
        <div className="tw-stage" style={{ width: size.w, height: size.h }}>
          <canvas ref={bodyRef} className="tw-layer" style={{ width: size.w, height: size.h }} />
          <canvas ref={marksRef} className="tw-layer" style={{ width: size.w, height: size.h }} />
        </div>
      </div>
    </div>
  )
})

export default ReadStackCanvas
