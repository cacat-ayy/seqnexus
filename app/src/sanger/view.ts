/**
 * How traces are shown: zoom, peak height, which channels and tracks.
 *
 * One setting for all reads rather than one per read: someone who likes
 * normalised peaks and no quality bars wants that on every read they open.
 * Kept in localStorage; a private window without storage just gets the
 * defaults. Whether a read is shown reverse complemented is per read and
 * lives on the read itself.
 */

import type { TraceBase } from '../io/trace'

/** Column widths in pixels; below LETTER_MIN_WIDTH calls are drawn as ticks. */
export const ZOOM_WIDTHS = [2, 3, 4, 6, 8, 10, 12, 14, 17, 20, 24, 30, 38] as const
export const DEFAULT_ZOOM = 7
export const LETTER_MIN_WIDTH = 8

export const HEIGHT_MIN = 0.25
export const HEIGHT_MAX = 8

export interface TraceView {
  zoom: number
  /** Multiplier on peak heights. */
  height: number
  /** Scale peaks by their local height, so the weak end of a read is as readable as the start. */
  normalize: boolean
  channels: Record<TraceBase, boolean>
  quality: boolean
  /** Mark calls with a strong second peak and show the second base under them. */
  mixed: boolean
  /** Second-to-first peak ratio that counts as mixed. */
  mixedRatio: number
  /** Quality cut-off line and the low-quality stops of "next problem". */
  qualityCutoff: number
  translate: boolean
  frame: 0 | 1 | 2
  /** Rows that wrap to the window instead of one long scrolling row. */
  wrap: boolean
}

export const DEFAULT_TRACE_VIEW: TraceView = {
  zoom: DEFAULT_ZOOM,
  height: 1,
  normalize: true,
  channels: { A: true, C: true, G: true, T: true },
  quality: true,
  mixed: true,
  mixedRatio: 0.33,
  qualityCutoff: 20,
  translate: false,
  frame: 0,
  wrap: false,
}

const KEY = 'seqnexus_trace_view'

export function loadTraceView(): TraceView {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_TRACE_VIEW
    return sanitize(JSON.parse(raw))
  } catch {
    return DEFAULT_TRACE_VIEW
  }
}

export function saveTraceView(view: TraceView): void {
  try { localStorage.setItem(KEY, JSON.stringify(view)) } catch { /* storage unavailable: keep it for this session only */ }
}

function sanitize(v: Partial<TraceView> | null): TraceView {
  const d = DEFAULT_TRACE_VIEW
  if (!v || typeof v !== 'object') return d
  const num = (x: unknown, lo: number, hi: number, def: number) =>
    typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : def
  const bool = (x: unknown, def: boolean) => (typeof x === 'boolean' ? x : def)
  const ch = (v.channels ?? {}) as Partial<Record<TraceBase, unknown>>
  return {
    zoom: Math.round(num(v.zoom, 0, ZOOM_WIDTHS.length - 1, d.zoom)),
    height: num(v.height, HEIGHT_MIN, HEIGHT_MAX, d.height),
    normalize: bool(v.normalize, d.normalize),
    channels: { A: bool(ch.A, true), C: bool(ch.C, true), G: bool(ch.G, true), T: bool(ch.T, true) },
    quality: bool(v.quality, d.quality),
    mixed: bool(v.mixed, d.mixed),
    mixedRatio: num(v.mixedRatio, 0.1, 0.9, d.mixedRatio),
    qualityCutoff: Math.round(num(v.qualityCutoff, 0, 60, d.qualityCutoff)),
    translate: bool(v.translate, d.translate),
    frame: v.frame === 1 || v.frame === 2 ? v.frame : 0,
    wrap: bool(v.wrap, d.wrap),
  }
}

// ---------------------------------------------------------------------------
// Shared setting: the workspace and the app toolbar's zoom both change it.
// ---------------------------------------------------------------------------

let current: TraceView | null = null
const listeners = new Set<() => void>()

export function getTraceView(): TraceView {
  if (!current) current = loadTraceView()
  return current
}

export function updateTraceView(patch: Partial<TraceView>): void {
  current = { ...getTraceView(), ...patch }
  saveTraceView(current)
  for (const l of listeners) l()
}

export function subscribeTraceView(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
