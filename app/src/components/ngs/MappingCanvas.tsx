/**
 * The scrolling mapping view. Rows of reads scroll natively up and down
 * under a fixed header. Along the reference the view keeps its own position
 * and scale instead of a native scroller, because a genome at a readable
 * zoom is far wider than any element a browser will lay out.
 *
 * Pointer: drag to pan (sideways and up and down), click a read to select
 * it, double-click to zoom in there, right-click for actions. Wheel scrolls
 * the rows; Shift+wheel or a sideways wheel pans; Ctrl+wheel zooms around
 * the pointer. Keys: arrows pan, + and - zoom, Escape clears the selection.
 */

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import type { Signal } from '../alignment/signal'
import { useCanvasLayers, type StageSize } from '../tracks/useCanvasLayers'
import { readInRow, type ViewRead } from '../../ngs/view'
import type { Variant } from '../../assembly/variants'
import { clampScale, variantAt, paintMapMarks, paintMapping, rowTop, type MapMarks, type MapPaintInput, type MapScale, type MapState } from './mappingPaint'

export interface MapHover {
  /** Reference position under the pointer (0-based). */
  pos: number
  read: ViewRead | null
  /** The variant under the pointer in the variant track. */
  variant: Variant | null
  clientX: number
  clientY: number
}

export interface MappingCanvasHandle {
  /** Show [start, end) across the view. */
  goTo: (start: number, end: number) => void
  centerOn: (pos: number) => void
  zoomBy: (factor: number) => void
  focus: () => void
  /** Scroll the rows so `row` is in view. */
  revealRow: (row: number) => void
}

interface Props {
  input: MapPaintInput
  scale: Signal<MapScale>
  hover: Signal<MapHover | null>
  marks: Omit<MapMarks, 'hoverPos' | 'hoverRead'>
  onPlotWidth: (w: number) => void
  onSelectRead: (r: ViewRead | null) => void
  onSelectVariant?: (v: Variant) => void
  onContextMenu: (at: { x: number; y: number; pos: number; read: ViewRead | null }) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
}

const MappingCanvas = forwardRef<MappingCanvasHandle, Props>(function MappingCanvas(props, ref) {
  const { input } = props
  const g = input.geo
  const scrollerRef = useRef<HTMLDivElement>(null)
  const live = useRef(props)
  live.current = props
  const drag = useRef<{ x: number; y: number; start: number; scrollTop: number; moved: boolean; id: number } | null>(null)

  const mapState = (sz: StageSize): MapState => ({
    scale: live.current.scale.get(),
    scrollY: scrollerRef.current?.scrollTop ?? 0,
    w: sz.w,
    h: sz.h,
  })
  const { size, bodyRef, marksRef, schedule } = useCanvasLayers(scrollerRef, {
    body: (ctx, t, sz) => paintMapping(ctx, live.current.input, t, mapState(sz)),
    marks: (ctx, t, sz) => {
      const p = live.current
      const h = p.hover.get()
      paintMapMarks(ctx, p.input, t, mapState(sz), { ...p.marks, hoverPos: h ? Math.floor(h.pos) : null, hoverRead: h?.read ?? null })
    },
  })
  const plotW = Math.max(1, size.w - g.gutter)
  const plotRef = useRef(plotW)
  plotRef.current = plotW

  const measured = size.w > 0
  useLayoutEffect(() => { if (measured) live.current.onPlotWidth(plotW) }, [plotW, measured])
  useLayoutEffect(() => { schedule(true) }, [input, schedule])
  useLayoutEffect(() => { schedule(false) }, [props.marks, schedule])
  useEffect(() => props.scale.subscribe(() => schedule(true)), [props.scale, schedule])
  useEffect(() => props.hover.subscribe(() => schedule(false)), [props.hover, schedule])

  const setScale = (s: MapScale) => live.current.scale.set(clampScale(s, live.current.input.length, plotRef.current))
  // Re-clamp when the plot is resized or the reference changes.
  useLayoutEffect(() => { if (measured) setScale(live.current.scale.get()) }, [plotW, input.length, measured])

  const zoomAround = (factor: number, px: number) => {
    const s = live.current.scale.get()
    const at = s.start + px * s.bpPerPx
    const bpPerPx = s.bpPerPx / factor
    const c = clampScale({ start: 0, bpPerPx }, live.current.input.length, plotRef.current)
    setScale({ start: at - px * c.bpPerPx, bpPerPx: c.bpPerPx })
  }

  useImperativeHandle(ref, () => ({
    goTo(start, end) {
      const span = Math.max(1, end - start)
      setScale({ start, bpPerPx: span / plotRef.current })
      // A span narrower than the closest zoom is centred.
      const s = live.current.scale.get()
      const shown = plotRef.current * s.bpPerPx
      if (shown > span) setScale({ start: start - (shown - span) / 2, bpPerPx: s.bpPerPx })
    },
    centerOn(pos) {
      const s = live.current.scale.get()
      setScale({ start: pos - (plotRef.current * s.bpPerPx) / 2, bpPerPx: s.bpPerPx })
    },
    zoomBy(factor) { zoomAround(factor, plotRef.current / 2) },
    focus() { scrollerRef.current?.focus({ preventScroll: true }) },
    revealRow(row) {
      const el = scrollerRef.current
      if (!el) return
      const gg = live.current.input.geo
      const y = row * gg.pitch
      const viewH = el.clientHeight - gg.headerH
      if (y < el.scrollTop || y + gg.pitch > el.scrollTop + viewH) el.scrollTop = Math.max(0, y - viewH / 3)
    },
  }))

  // ---- Hit testing ----
  const hitAt = (clientX: number, clientY: number) => {
    const el = scrollerRef.current!
    const r = el.getBoundingClientRect()
    const x = clientX - r.left
    const y = clientY - r.top
    const p = live.current.input
    const s = live.current.scale.get()
    const pos = s.start + (x - p.geo.gutter) * s.bpPerPx
    let read: ViewRead | null = null
    if (y >= p.geo.headerH && x >= p.geo.gutter && p.layout) {
      const st: MapState = { scale: s, scrollY: el.scrollTop, w: 0, h: 0 }
      const row = Math.floor((y - p.geo.headerH + el.scrollTop) / p.geo.pitch)
      if (row >= 0 && row < p.layout.rows.length && y - rowTop(row, p.geo, st) < p.geo.rowH) read = readInRow(p.layout.rows[row], Math.floor(pos))
    }
    const vb = p.geo.vars
    const variant = vb && p.variants && y >= vb[0] && y < vb[1] && x >= p.geo.gutter ? variantAt(p.variants, pos, s.bpPerPx) : null
    return { x, y, pos, read, variant, gutter: x < p.geo.gutter, inside: pos >= 0 && pos < p.length }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    scrollerRef.current?.focus({ preventScroll: true })
    scrollerRef.current?.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, start: live.current.scale.get().start, scrollTop: scrollerRef.current?.scrollTop ?? 0, moved: false, id: e.pointerId }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (d) {
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
      if (d.moved) {
        const s = live.current.scale.get()
        setScale({ start: d.start - dx * s.bpPerPx, bpPerPx: s.bpPerPx })
        const el = scrollerRef.current
        if (el) el.scrollTop = d.scrollTop - dy
        live.current.hover.set(null)
        return
      }
    }
    const h = hitAt(e.clientX, e.clientY)
    live.current.hover.set(h.gutter || !h.inside ? null : { pos: h.pos, read: h.read, variant: h.variant, clientX: e.clientX, clientY: e.clientY })
  }

  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    const el = scrollerRef.current
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (d && !d.moved && e.type === 'pointerup') {
      const h = hitAt(e.clientX, e.clientY)
      if (h.variant) live.current.onSelectVariant?.(h.variant)
      else if (!h.gutter) live.current.onSelectRead(h.read)
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const h = hitAt(e.clientX, e.clientY)
    if (!h.gutter) zoomAround(2, h.x - live.current.input.geo.gutter)
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const h = hitAt(e.clientX, e.clientY)
    if (h.gutter || !h.inside) return
    live.current.onContextMenu({ x: e.clientX, y: e.clientY, pos: Math.floor(h.pos), read: h.read })
  }

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left - live.current.input.geo.gutter
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const step = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
        zoomAround(Math.exp(-Math.max(-300, Math.min(300, step)) * 0.0035), Math.max(0, px))
        return
      }
      const sideways = e.shiftKey ? e.deltaY || e.deltaX : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0
      if (sideways) {
        e.preventDefault()
        const s = live.current.scale.get()
        const dpx = e.deltaMode === 1 ? sideways * 33 : sideways
        setScale({ start: s.start + dpx * s.bpPerPx, bpPerPx: s.bpPerPx })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: React.KeyboardEvent) => {
    props.onKeyDown?.(e)
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
    const s = live.current.scale.get()
    const span = plotRef.current * s.bpPerPx
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const step = (e.shiftKey ? span : span / 8) * (e.key === 'ArrowLeft' ? -1 : 1)
      setScale({ start: s.start + step, bpPerPx: s.bpPerPx })
    } else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAround(2, plotRef.current / 2) }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAround(0.5, plotRef.current / 2) }
    else if (e.key === 'Home') { e.preventDefault(); setScale({ start: 0, bpPerPx: s.bpPerPx }) }
    else if (e.key === 'End') { e.preventDefault(); setScale({ start: live.current.input.length, bpPerPx: s.bpPerPx }) }
    else if (e.key === 'Escape') live.current.onSelectRead(null)
  }

  const rows = input.layout?.rows.length ?? 0
  const contentH = g.headerH + rows * g.pitch + 24
  return (
    <div
      ref={scrollerRef}
      className="mv-scroller"
      tabIndex={0}
      role="application"
      aria-label={`Reads mapped to ${input.refName}. Arrows pan, plus and minus zoom.`}
      onScroll={() => schedule(true)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => { if (!drag.current) props.hover.set(null) }}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      <div className="mv-sizer" style={{ height: Math.max(contentH, size.h) }}>
        <div className="mv-stage" style={{ width: size.w, height: size.h }}>
          <canvas ref={bodyRef} className="mv-layer" style={{ width: size.w, height: size.h }} />
          <canvas ref={marksRef} className="mv-layer" style={{ width: size.w, height: size.h }} />
        </div>
      </div>
    </div>
  )
})

export default MappingCanvas
