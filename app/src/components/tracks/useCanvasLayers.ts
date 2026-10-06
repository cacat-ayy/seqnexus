/**
 * The track engine's stage: two stacked canvases the size of their scroller,
 * one for content and one for marks (hover, selection, caret) that repaint
 * on every pointer move without redrawing the content under them.
 *
 * The hook keeps the canvases sized to the scroller at the screen's pixel
 * ratio, reads the theme's colours from the CSS tokens (again whenever the
 * theme changes), and batches repaints into one animation frame. The host
 * supplies the two draw functions; they always run with the host's latest
 * props, because the hook calls whatever was passed on the last render.
 *
 * Used by the Sanger contig view and the NGS mapping view.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { readAlnTheme, useThemeVersion, type AlnTheme } from '../alignment/theme'

export interface StageSize { w: number; h: number }

export type LayerDraw = (ctx: CanvasRenderingContext2D, theme: AlnTheme, size: StageSize) => void

export interface CanvasLayers {
  size: StageSize
  bodyRef: React.RefObject<HTMLCanvasElement>
  marksRef: React.RefObject<HTMLCanvasElement>
  /** Repaint on the next frame: the marks always, the content too when `body` is true. */
  schedule: (body: boolean) => void
}

export function useCanvasLayers(scrollerRef: React.RefObject<HTMLElement>, draw: { body: LayerDraw; marks: LayerDraw }): CanvasLayers {
  const bodyRef = useRef<HTMLCanvasElement>(null)
  const marksRef = useRef<HTMLCanvasElement>(null)
  const themeVersion = useThemeVersion(scrollerRef)
  const theme = useRef<AlnTheme | null>(null)
  const [size, setSize] = useState<StageSize>({ w: 0, h: 0 })
  const live = useRef({ draw, size })
  live.current = { draw, size }

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = () => setSize(s => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollerRef])

  const frame = useRef(0)
  const dirty = useRef({ body: true, marks: true })
  const paint = useCallback(() => {
    frame.current = 0
    const t = theme.current
    const { draw: d, size: sz } = live.current
    if (!t || sz.w === 0) return
    const dpr = window.devicePixelRatio || 1
    const prep = (c: HTMLCanvasElement | null) => {
      if (!c) return null
      const W = Math.max(1, Math.round(sz.w * dpr))
      const H = Math.max(1, Math.round(sz.h * dpr))
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
      const ctx = c.getContext('2d')
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
      return ctx
    }
    if (dirty.current.body) {
      const ctx = prep(bodyRef.current)
      if (ctx) d.body(ctx, t, sz)
    }
    if (dirty.current.marks) {
      const ctx = prep(marksRef.current)
      if (ctx) d.marks(ctx, t, sz)
    }
    dirty.current = { body: false, marks: false }
  }, [])

  const schedule = useCallback((body: boolean) => {
    if (body) dirty.current.body = true
    dirty.current.marks = true
    if (!frame.current) frame.current = requestAnimationFrame(paint)
  }, [paint])

  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current) }, [])
  useLayoutEffect(() => {
    if (scrollerRef.current) theme.current = readAlnTheme(scrollerRef.current)
    schedule(true)
  }, [themeVersion, schedule, scrollerRef])
  useLayoutEffect(() => { schedule(true) }, [size, schedule])

  return { size, bodyRef, marksRef, schedule }
}
