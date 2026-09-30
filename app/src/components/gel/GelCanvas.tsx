/**
 * The gel itself, drawn to fill its panel, and everything you can do to it
 * directly: pick a lane by clicking it, drag a well to reorder, click the empty
 * well after the last lane to add one, hover a band for what is in it, and read
 * the size at any height off the cursor line.
 *
 * The painted gel is cached; hovering and dragging only redraw the overlay.
 * Keyboard: ←/→ pick a lane, Alt+←/→ move it, Delete removes it, Insert adds.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GelBand, GelLayout } from '../../gel/bands'
import { sizeAtMm } from '../../gel/migration'
import { buildScene, formatBp, type GelScene, type SceneBand, type SceneLaneInput } from '../../gel/render/scene'
import { getLook } from '../../gel/render/looks'
import { renderGelCanvas } from '../../gel/render/paint'
import type { GelDisplay } from '../../gel/workspace'

export interface BandRef { laneIdx: number; bandIdx: number }

interface Props {
  layout: GelLayout
  lanes: SceneLaneInput[]
  display: GelDisplay
  canAddLane: boolean
  selectedLane: number | null
  /** Band to outline: hovered in the table, or picked on the gel. */
  highlight: BandRef | null
  describeBand: (laneIdx: number, band: GelBand) => string[]
  onSelectLane: (idx: number) => void
  onSelectBand: (ref: BandRef) => void
  onMoveLane: (from: number, to: number) => void
  onAddLane: () => void
  onRemoveLane: (idx: number) => void
}

const ACCENT = 'rgba(99, 179, 237, 0.95)'
const ACCENT_SOFT = 'rgba(99, 179, 237, 0.10)'
const DRAG_THRESHOLD = 4

interface Tooltip { x: number; y: number; lines: string[] }

export default function GelCanvas({
  layout, lanes, display, canAddLane, selectedLane, highlight, describeBand,
  onSelectLane, onSelectBand, onMoveLane, onAddLane, onRemoveLane,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hoverLane, setHoverLane] = useState<number | null>(null)
  const [hoverBand, setHoverBand] = useState<BandRef | null>(null)
  const [cursorY, setCursorY] = useState<number | null>(null)
  const [ghostHover, setGhostHover] = useState(false)
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const dragRef = useRef<{ from: number; startX: number; started: boolean } | null>(null)
  const [dropSlot, setDropSlot] = useState<number | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const look = getLook(display.look)

  const scene = useMemo((): GelScene | null => {
    if (size.w <= 0 || size.h <= 0) return null
    return buildScene({
      width: size.w, height: size.h, layout, lanes,
      exposure: display.exposure, labelMode: display.labelMode, ghostLane: canAddLane,
    })
  }, [size, layout, lanes, display.exposure, display.labelMode, canAddLane])

  // The painted gel, cached until the scene or the imaging changes.
  const base = useMemo(() => {
    if (!scene) return null
    const dpr = window.devicePixelRatio || 1
    return renderGelCanvas(scene, look, {
      scale: dpr, exposure: display.exposure, effects: display.effects, showDyeFronts: display.showDyeFronts,
    })
  }, [scene, look, display.exposure, display.effects, display.showDyeFronts])

  // ---- Drawing ----
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !scene) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(scene.width * dpr)
    canvas.height = Math.round(scene.height * dpr)
    canvas.style.width = `${scene.width}px`
    canvas.style.height = `${scene.height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (base) ctx.drawImage(base, 0, 0, scene.width, scene.height)
    const { slab } = scene

    // Selected lane: a faint column and an outlined well.
    if (selectedLane !== null && scene.lanes[selectedLane]) {
      const lane = scene.lanes[selectedLane]
      ctx.fillStyle = ACCENT_SOFT
      ctx.fillRect(lane.x - 2, slab.y + 2, lane.w + 4, slab.h - 4)
      ctx.strokeStyle = ACCENT
      ctx.lineWidth = 1.5
      ctx.strokeRect(lane.x - 1, scene.wellY - 1, lane.w + 2, scene.wellH + 2)
    }
    if (hoverLane !== null && hoverLane !== selectedLane && scene.lanes[hoverLane]) {
      const lane = scene.lanes[hoverLane]
      ctx.strokeStyle = 'rgba(99, 179, 237, 0.5)'
      ctx.lineWidth = 1
      ctx.strokeRect(lane.x - 1, scene.wellY - 1, lane.w + 2, scene.wellH + 2)
    }

    // Highlighted band
    const outline = highlight ?? hoverBand
    const hb = outline && scene.bands.find(b => b.laneIdx === outline.laneIdx && b.bandIdx === outline.bandIdx)
    if (hb) {
      ctx.strokeStyle = ACCENT
      ctx.lineWidth = 1.5
      ctx.setLineDash([])
      ctx.strokeRect(hb.x - 3, hb.y - 2, hb.w + 6, hb.h + 4)
    }

    // Empty well after the last lane: click to add a lane.
    if (scene.ghost) {
      const g = scene.ghost
      ctx.save()
      ctx.strokeStyle = ghostHover ? ACCENT : look.textMuted
      ctx.setLineDash([3, 3])
      ctx.lineWidth = 1
      ctx.strokeRect(g.x + 0.5, g.y + 0.5, g.w - 1, g.h - 1)
      ctx.setLineDash([])
      ctx.fillStyle = ghostHover ? ACCENT : look.textMuted
      ctx.font = '600 13px Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('+', g.x + g.w / 2, slab.y - 12)
      ctx.restore()
    }

    // Size cursor: a line across the gel with the size at that height.
    if (cursorY !== null && dropSlot === null) {
      const mm = (cursorY - scene.originY) / scene.pxPerMm
      const bp = sizeAtMm(mm, layout.conditions)
      ctx.save()
      ctx.strokeStyle = look.textMuted
      ctx.setLineDash([2, 3])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(slab.x + 1, cursorY + 0.5)
      ctx.lineTo(slab.x + slab.w - 1, cursorY + 0.5)
      ctx.stroke()
      ctx.setLineDash([])
      if (bp !== null) {
        const text = `≈ ${formatBp(Math.round(bp))}`
        ctx.font = '600 10px Inter, system-ui, sans-serif'
        const w = ctx.measureText(text).width + 10
        const x = Math.min(scene.width - w - 2, slab.x + slab.w + 4)
        ctx.fillStyle = look.frame
        ctx.globalAlpha = 0.85
        ctx.fillRect(x, cursorY - 8, w, 16)
        ctx.globalAlpha = 1
        ctx.fillStyle = look.text
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, x + 5, cursorY)
      }
      ctx.restore()
    }

    // Drop position while dragging a lane
    if (dropSlot !== null && scene.lanes.length > 0) {
      const ls = scene.lanes
      const half = ls.length > 1 ? (ls[1].x - ls[0].x - ls[0].w) / 2 : 4
      const x = dropSlot >= ls.length ? ls[ls.length - 1].x + ls[ls.length - 1].w + half : ls[dropSlot].x - half
      ctx.strokeStyle = ACCENT
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x, slab.y - 16)
      ctx.lineTo(x, slab.y + slab.h)
      ctx.stroke()
    }
  }, [scene, base, look, selectedLane, hoverLane, highlight, hoverBand, ghostHover, cursorY, dropSlot, layout.conditions])

  // ---- Hit testing ----
  const pointer = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const laneAtX = useCallback((x: number): number | null => {
    if (!scene) return null
    const i = scene.lanes.findIndex(l => x >= l.x - 3 && x <= l.x + l.w + 3)
    return i === -1 ? null : i
  }, [scene])

  const inHeader = (y: number) => !!scene && y < scene.wellY + scene.wellH + 3
  const inGhost = (x: number, y: number) =>
    !!scene?.ghost && x >= scene.ghost.x - 3 && x <= scene.ghost.x + scene.ghost.w + 3 && inHeader(y)

  const bandAt = useCallback((x: number, y: number): SceneBand | null => {
    if (!scene) return null
    let best: SceneBand | null = null
    let bestD = Infinity
    for (const b of scene.bands) {
      if (x < b.x || x > b.x + b.w || y < b.y - 3 || y > b.y + b.h + 3) continue
      const d = Math.abs(y - (b.y + b.h / 2))
      if (d < bestD) { best = b; bestD = d }
    }
    return best
  }, [scene])

  const slotAtX = useCallback((x: number): number => {
    if (!scene) return 0
    const i = scene.lanes.findIndex(l => x < l.x + l.w / 2)
    return i === -1 ? scene.lanes.length : i
  }, [scene])

  const onMouseMove = (e: React.MouseEvent) => {
    if (!scene) return
    const { x, y } = pointer(e)
    const drag = dragRef.current
    if (drag) {
      if (!drag.started && Math.abs(e.clientX - drag.startX) >= DRAG_THRESHOLD) drag.started = true
      if (drag.started) {
        setDropSlot(slotAtX(x))
        setTooltip(null)
        return
      }
    }
    const lane = laneAtX(x)
    const header = inHeader(y)
    setHoverLane(header ? lane : null)
    setGhostHover(inGhost(x, y))
    const inSlab = x >= scene.slab.x && x <= scene.slab.x + scene.slab.w && y > scene.originY && y < scene.slab.y + scene.slab.h
    setCursorY(inSlab ? y : null)
    const b = inSlab ? bandAt(x, y) : null
    setHoverBand(b ? { laneIdx: b.laneIdx, bandIdx: b.bandIdx } : null)
    setTooltip(b ? { x, y, lines: describeBand(b.laneIdx, b.band) } : null)
    canvasRef.current!.style.cursor = header && lane !== null ? 'grab' : inGhost(x, y) || b || lane !== null ? 'pointer' : 'crosshair'
  }

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const { x, y } = pointer(e)
    const lane = laneAtX(x)
    if (lane !== null && inHeader(y)) dragRef.current = { from: lane, startX: e.clientX, started: false }
  }

  const onMouseUp = () => {
    const drag = dragRef.current
    if (drag?.started && dropSlot !== null) {
      const to = dropSlot > drag.from ? dropSlot - 1 : dropSlot
      if (to !== drag.from) onMoveLane(drag.from, to)
      suppressClick.current = true
    }
    dragRef.current = null
    setDropSlot(null)
  }

  const onMouseLeave = () => {
    dragRef.current = null
    setDropSlot(null)
    setHoverLane(null)
    setHoverBand(null)
    setCursorY(null)
    setGhostHover(false)
    setTooltip(null)
  }

  const onClick = (e: React.MouseEvent) => {
    if (suppressClick.current) { suppressClick.current = false; return }
    const { x, y } = pointer(e)
    if (inGhost(x, y)) { onAddLane(); return }
    const b = bandAt(x, y)
    if (b) { onSelectBand({ laneIdx: b.laneIdx, bandIdx: b.bandIdx }); return }
    const lane = laneAtX(x)
    if (lane !== null) onSelectLane(lane)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = lanes.length
    if (n === 0) return
    const cur = selectedLane ?? 0
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const dir = e.key === 'ArrowLeft' ? -1 : 1
      const next = Math.max(0, Math.min(n - 1, cur + dir))
      if (e.altKey && selectedLane !== null && next !== cur) onMoveLane(cur, next)
      else onSelectLane(next)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      onSelectLane(e.key === 'Home' ? 0 : n - 1)
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLane !== null) {
      e.preventDefault()
      onRemoveLane(selectedLane)
    } else if (e.key === 'Insert' && canAddLane) {
      e.preventDefault()
      onAddLane()
    }
  }

  return (
    <div className="gw-canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-label="Gel. Arrow keys pick a lane, Alt+arrows move it, Delete removes it, Insert adds one."
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
        onKeyDown={onKeyDown}
      />
      {tooltip && (
        <div
          className="gw-tooltip"
          style={{ left: Math.min(tooltip.x + 14, size.w - 240), top: tooltip.y + 12 }}
        >
          {tooltip.lines.map((l, i) => <div key={i} className={i === 0 ? 'gw-tooltip-title' : ''}>{l}</div>)}
        </div>
      )}
    </div>
  )
}
