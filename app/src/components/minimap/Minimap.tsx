/**
 * The overview bar shared by the sequence, alignment and chromatogram views.
 *
 * Two stacked canvases: a static layer (ruler and tracks) that repaints only
 * when the content, size or theme changes, and an overlay (viewport,
 * selection, hover) that repaints on scroll. The host publishes its visible
 * range through a ViewportSource rather than props, so scrolling never
 * re-renders this component.
 *
 * Interaction: press on the viewport to drag it, press anywhere else to
 * centre the viewport there and keep dragging; hover for the position and
 * whatever track item is underneath. Collapsing leaves a thin strip that
 * still navigates, and the choice is remembered per kind of view.
 */

import './Minimap.css'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { MinimapHit, MinimapTheme, MinimapTrack, TrackArea } from './types'
import type { ViewportSource } from './viewport'
import { dragViewport, grabViewport, niceTickInterval, posAtX } from './geometry'
import { readTheme } from './theme'

export interface MinimapProps {
  /** Which view this is; the collapsed state is remembered per kind. */
  kind: 'sequence' | 'alignment' | 'chromatogram'
  /** Total length in units (bases or columns). */
  length: number
  tracks: readonly MinimapTrack[]
  viewport: ViewportSource
  /** Scroll the main view so its viewport starts at `start` (units). */
  onNavigate: (start: number) => void
  /** Selected stretches, half-open, in units. */
  selection?: readonly (readonly [number, number])[]
  /** Label for a 0-based position: ruler ticks and the hover readout. */
  formatPosition?: (pos: number) => string
  /** Word before the position in the readout only ("Column", "Base"). */
  positionLabel?: string
  /** Item the main view is hovering; tracks that drew it outline it. */
  highlightId?: string | null
  /** The track item under the pointer changed. */
  onHoverItem?: (id: string | null) => void
  ariaLabel: string
}

const PAD_X = 4
/** Room on the right for the collapse toggle, so it never covers the bar. */
const PAD_R = 18
const PAD_Y = 2
const RULER_H = 14
const TRACK_GAP = 2
const COLLAPSED_H = 10
const MIN_VIEWPORT_PX = 3

const STORAGE_PREFIX = 'seqnexus_minimap_collapsed_'

const defaultFormat = (pos: number) => (Math.floor(pos) + 1).toLocaleString()

function loadCollapsed(kind: string): boolean {
  try { return localStorage.getItem(STORAGE_PREFIX + kind) === '1' } catch { return false }
}

function saveCollapsed(kind: string, collapsed: boolean) {
  try { localStorage.setItem(STORAGE_PREFIX + kind, collapsed ? '1' : '0') } catch { /* private mode */ }
}

/** Vertical placement of each track in the expanded bar. */
function layoutTracks(tracks: readonly MinimapTrack[]): { placed: { track: MinimapTrack; y: number }[]; height: number } {
  let y = PAD_Y + RULER_H
  const placed = tracks.map(track => {
    const at = { track, y }
    y += track.height + TRACK_GAP
    return at
  })
  return { placed, height: y - TRACK_GAP + PAD_Y }
}

interface Hover {
  x: number
  pos: number
  hit: MinimapHit | null
}

export default function Minimap({
  kind,
  length,
  tracks,
  viewport,
  onNavigate,
  selection,
  formatPosition = defaultFormat,
  positionLabel,
  highlightId,
  onHoverItem,
  ariaLabel,
}: MinimapProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(kind))
  const [width, setWidth] = useState(0)
  const [themeTick, setThemeTick] = useState(0)
  const [hover, setHover] = useState<Hover | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ offset: number } | null>(null)
  const themeRef = useRef<MinimapTheme | null>(null)
  const hoverItemRef = useRef<string | null>(null)

  const { placed, height: fullHeight } = useMemo(() => layoutTracks(tracks), [tracks])
  const compactTracks = useMemo(() => tracks.filter(t => t.drawCompact), [tracks])
  const height = collapsed ? COLLAPSED_H : fullHeight
  const barW = Math.max(0, width - PAD_X - PAD_R)

  const area = useCallback((y: number, h: number): TrackArea => ({
    x: PAD_X,
    y,
    w: barW,
    h,
    length,
    toX: (pos: number) => PAD_X + (length > 0 ? (pos / length) * barW : 0),
  }), [barW, length])

  const toggle = useCallback(() => {
    setCollapsed(c => {
      saveCollapsed(kind, !c)
      return !c
    })
  }, [kind])

  // --- Size and theme ---

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const app = rootRef.current?.closest('.app-root')
    if (!app) return
    const mo = new MutationObserver(() => setThemeTick(t => t + 1))
    mo.observe(app, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])

  // --- Static layer: ruler and tracks ---

  useLayoutEffect(() => {
    const canvas = baseRef.current
    const root = rootRef.current
    if (!canvas || !root || width <= 0) return
    const ctx = sizeCanvas(canvas, width, height)
    if (!ctx) return
    const theme = readTheme(root)
    themeRef.current = theme
    ctx.fillStyle = theme.bg
    ctx.fillRect(0, 0, width, height)
    if (length <= 0 || barW <= 0) return

    if (collapsed) {
      const rows = compactTracks.length
      if (rows === 0) {
        ctx.fillStyle = theme.ink
        ctx.fillRect(PAD_X, Math.floor(height / 2), barW, 1)
        return
      }
      const rowH = (height - 2) / rows
      compactTracks.forEach((t, i) => {
        t.drawCompact!(ctx, area(1 + i * rowH, rowH), theme)
      })
      return
    }

    drawRuler(ctx, theme, area(PAD_Y, RULER_H), formatPosition)
    for (const { track, y } of placed) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, y, width, track.height)
      ctx.clip()
      track.draw(ctx, area(y, track.height), theme)
      ctx.restore()
    }
  }, [width, height, collapsed, length, barW, placed, compactTracks, formatPosition, area, themeTick])

  // --- Overlay: selection, viewport, hover ---

  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current
    const theme = themeRef.current
    if (!canvas || !theme || width <= 0) return
    const ctx = sizeCanvas(canvas, width, height)
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    if (length <= 0 || barW <= 0) return
    const toX = (pos: number) => PAD_X + (pos / length) * barW
    const top = collapsed ? 0 : PAD_Y + RULER_H
    const h = height - top - (collapsed ? 0 : PAD_Y)

    if (highlightId && !collapsed) {
      for (const { track, y } of placed) track.highlight?.(ctx, area(y, track.height), theme, highlightId)
    }

    for (const [s, e] of selection ?? []) {
      ctx.globalAlpha = 0.3
      ctx.fillStyle = theme.accent
      const x1 = toX(s)
      ctx.fillRect(x1, top, Math.max(1, toX(e) - x1), h)
    }
    ctx.globalAlpha = 1

    const vp = viewport.get()
    const vx = toX(vp.start)
    const vw = Math.max(MIN_VIEWPORT_PX, toX(vp.end) - vx)
    const covers = vp.start <= 0 && vp.end >= length
    if (!covers) {
      if (collapsed) {
        ctx.globalAlpha = 0.35
        ctx.fillStyle = theme.accent
        ctx.fillRect(vx, 0, vw, height)
      } else {
        ctx.globalAlpha = 0.45
        ctx.fillStyle = theme.dim
        if (vx > PAD_X) ctx.fillRect(PAD_X, top, vx - PAD_X, h)
        if (vx + vw < PAD_X + barW) ctx.fillRect(vx + vw, top, PAD_X + barW - vx - vw, h)
      }
      ctx.globalAlpha = 1
      ctx.strokeStyle = theme.accent
      ctx.lineWidth = 1.5
      ctx.strokeRect(vx + 0.75, top + 0.75, Math.max(0, vw - 1.5), h - 1.5)
    }

    if (hover && !dragging) {
      ctx.globalAlpha = 0.8
      ctx.fillStyle = theme.ink
      ctx.fillRect(Math.round(hover.x) - 0.5, top, 1, h)
      ctx.globalAlpha = 1
    }
  }, [width, height, length, barW, collapsed, placed, area, selection, viewport, highlightId, hover, dragging])

  // Repaint the overlay after the static layer and whenever its inputs change.
  useLayoutEffect(() => { drawOverlay() }, [drawOverlay, themeTick])

  // Scroll: at most one overlay repaint per frame, outside React.
  const drawOverlayRef = useRef(drawOverlay)
  drawOverlayRef.current = drawOverlay
  useEffect(() => {
    let frame = 0
    const unsubscribe = viewport.subscribe(() => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        drawOverlayRef.current()
      })
    })
    return () => {
      unsubscribe()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [viewport])

  // --- Pointer ---

  const posFromEvent = useCallback((e: React.PointerEvent) => {
    const rect = overlayRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    return { x, y: e.clientY - rect.top, pos: posAtX(x, PAD_X, barW, length) }
  }, [barW, length])

  const hitAt = useCallback((pos: number, y: number): MinimapHit | null => {
    const theme = themeRef.current
    if (collapsed || !theme) return null
    const unitsPerPx = barW > 0 ? length / barW : 1
    for (const { track, y: ty } of placed) {
      if (y >= ty && y < ty + track.height) return track.hit?.(pos, y - ty, unitsPerPx, theme) ?? null
    }
    return null
  }, [collapsed, placed, barW, length])

  const setHoverItem = useCallback((id: string | null) => {
    if (hoverItemRef.current === id) return
    hoverItemRef.current = id
    onHoverItem?.(id)
  }, [onHoverItem])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || length <= 0) return
    const { pos } = posFromEvent(e)
    const grab = grabViewport(pos, viewport.get(), length)
    if (grab.start !== null) onNavigate(grab.start)
    dragRef.current = { offset: grab.offset }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [length, posFromEvent, viewport, onNavigate])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const { x, y, pos } = posFromEvent(e)
    if (dragRef.current) {
      onNavigate(dragViewport(pos, dragRef.current.offset, viewport.get(), length))
      return
    }
    const hit = hitAt(pos, y)
    setHover({ x: Math.max(PAD_X, Math.min(PAD_X + barW, x)), pos, hit })
    setHoverItem(hit?.itemId ?? null)
  }, [posFromEvent, onNavigate, viewport, length, hitAt, barW, setHoverItem])

  const endDrag = useCallback(() => {
    dragRef.current = null
    setDragging(false)
  }, [])

  const handlePointerLeave = useCallback(() => {
    if (dragRef.current) return
    setHover(null)
    setHoverItem(null)
  }, [setHoverItem])

  // Release the host's hover highlight if we unmount mid-hover.
  useEffect(() => () => { if (hoverItemRef.current) onHoverItem?.(null) }, [onHoverItem])

  // Read on render: the viewport moves without one, but the cursor only
  // needs to be right when the pointer moves, which does re-render.
  const vpNow = viewport.get()
  const overViewport = !!hover && hover.pos >= vpNow.start && hover.pos <= vpNow.end
  const cursor = dragging ? 'grabbing' : overViewport ? 'grab' : 'pointer'

  return (
    <div
      ref={rootRef}
      className={`minimap${collapsed ? ' collapsed' : ''}`}
      data-kind={kind}
      aria-label={ariaLabel}
      role="group"
    >
      <div className="minimap-stage" style={{ height }}>
        <canvas ref={baseRef} className="minimap-canvas" aria-hidden />
        <canvas
          ref={overlayRef}
          className="minimap-canvas minimap-overlay"
          style={{ cursor }}
          aria-hidden
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={handlePointerLeave}
        />
      </div>
      <button
        type="button"
        className="minimap-toggle"
        onClick={toggle}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand overview' : 'Collapse overview'}
        aria-label={collapsed ? 'Expand overview' : 'Collapse overview'}
      >
        {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>
      {hover && !dragging && (
        <div
          className="minimap-readout"
          style={{ left: Math.max(0, Math.min(width - 8, hover.x)) }}
          data-align={hover.x > width / 2 ? 'end' : 'start'}
          role="status"
        >
          <span className="minimap-readout-pos">{positionLabel ? `${positionLabel} ` : ''}{formatPosition(hover.pos)}</span>
          {hover.hit && (
            <>
              {hover.hit.color && <span className="minimap-readout-swatch" style={{ background: hover.hit.color }} />}
              <span className="minimap-readout-label">{hover.hit.label}</span>
              {hover.hit.detail && <span className="minimap-readout-detail">{hover.hit.detail}</span>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Size a canvas for the device pixel ratio and return a context in CSS pixels. */
function sizeCanvas(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1
  const pw = Math.round(w * dpr)
  const ph = Math.round(h * dpr)
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  const ctx = canvas.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

function drawRuler(
  ctx: CanvasRenderingContext2D,
  theme: MinimapTheme,
  a: TrackArea,
  format: (pos: number) => string,
) {
  const interval = niceTickInterval(a.length, a.w)
  // Ticks on the first position and on round 1-based numbers (1,000 rather
  // than 1,001), which sit one position before each multiple.
  const ticks = [0]
  for (let k = interval; k <= a.length; k += interval) ticks.push(k - 1)
  const base = a.y + a.h - 0.5
  ctx.strokeStyle = theme.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(a.x, base)
  ctx.lineTo(a.x + a.w, base)
  for (const p of ticks) {
    const x = Math.round(a.toX(p + 0.5)) + 0.5
    ctx.moveTo(x, base - 3)
    ctx.lineTo(x, base)
  }
  ctx.stroke()

  ctx.fillStyle = theme.muted
  ctx.font = `10px ${theme.font}`
  ctx.textBaseline = 'top'
  let lastRight = -Infinity
  for (const p of ticks) {
    const label = format(p)
    const w = ctx.measureText(label).width
    const x = a.toX(p + 0.5)
    // Left-align the first label and keep the rest from colliding or
    // running off the right edge.
    const left = p === 0 ? x : Math.min(x - w / 2, a.x + a.w - w)
    if (left < lastRight + 6) continue
    ctx.textAlign = 'left'
    ctx.fillText(label, left, a.y)
    lastRight = left + w
  }
}
