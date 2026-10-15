/**
 * What the toolbar needs from the sequence view without owning it.
 *
 * The view's layout decides how many bases fit on a row (in letter mode that
 * depends on the width of the pane), and only the view can work out which
 * zoom fits the whole sequence. Neither belongs in the store: they are
 * derived per frame and never saved. The view publishes the one and
 * registers the other here; the toolbar reads them.
 */

import { useSyncExternalStore } from 'react'

let basesPerRow = 0
const listeners = new Set<() => void>()

/** Called from the view's draw; notifies only when the value changes. */
export function publishBasesPerRow(n: number): void {
  if (n === basesPerRow) return
  basesPerRow = n
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** Bases per row in the sequence view as last drawn; 0 before the first draw. */
export function useBasesPerRow(): number {
  return useSyncExternalStore(subscribe, () => basesPerRow, () => basesPerRow)
}

/** "60 bp", "1.5 kb", "15 kb". */
export function formatBasesPerRow(n: number): string {
  if (n < 1000) return `${n} bp`
  const kb = n / 1000
  return `${Number.isInteger(kb) ? kb : kb.toFixed(1)} kb`
}

let minZoom = 0
const minZoomListeners = new Set<() => void>()

/**
 * Called by the view: the lowest zoom level worth zooming out to, the one at
 * which the whole sequence fits. 0 when no view is mounted.
 */
export function publishMinZoom(n: number): void {
  if (n === minZoom) return
  minZoom = n
  for (const l of minZoomListeners) l()
}

function subscribeMinZoom(l: () => void) {
  minZoomListeners.add(l)
  return () => { minZoomListeners.delete(l) }
}

/** The lowest zoom level the toolbar's zoom out should go to. */
export function useMinZoom(): number {
  return useSyncExternalStore(subscribeMinZoom, () => minZoom, () => minZoom)
}

let fitHandler: (() => void) | null = null

/** The mounted sequence view offers its fit; returns the unregister. */
export function registerSequenceViewFit(fn: () => void): () => void {
  fitHandler = fn
  return () => { if (fitHandler === fn) fitHandler = null }
}

/** Zoom the sequence view so the whole sequence fits. False when none is mounted. */
export function fitSequenceView(): boolean {
  if (!fitHandler) return false
  fitHandler()
  return true
}

let visibleRange: { start: number; end: number } | null = null

/**
 * Called from the view's draw: the whole rows in view, as bases [start, end).
 * The PDF export offers them as "visible region". Null when no view is mounted.
 */
export function publishVisibleRange(range: { start: number; end: number } | null): void {
  visibleRange = range
}

/** The rows the sequence view shows right now, or null when none is mounted. */
export function getVisibleRange(): { start: number; end: number } | null {
  return visibleRange
}

let zoomToHandler: ((start: number, end: number) => void) | null = null

/** The mounted sequence view offers its zoom to a range; returns the unregister. */
export function registerSequenceViewZoomTo(fn: (start: number, end: number) => void): () => void {
  zoomToHandler = fn
  return () => { if (zoomToHandler === fn) zoomToHandler = null }
}

/**
 * Zoom the sequence view in as far as the range [start, end) still fits, and
 * centre it. A range across the origin is given with start > end. False when
 * no sequence view is mounted (the map alone is showing).
 */
export function zoomSequenceViewTo(start: number, end: number): boolean {
  if (!zoomToHandler) return false
  zoomToHandler(start, end)
  return true
}

let centerHandler: ((start: number, end: number) => void) | null = null

/** The mounted sequence view offers its centring on a range; returns the unregister. */
export function registerSequenceViewCenter(fn: (start: number, end: number) => void): () => void {
  centerHandler = fn
  return () => { if (centerHandler === fn) centerHandler = null }
}

/**
 * Scroll the sequence view so the range [start, end) is in the middle of it,
 * at the zoom it has. False when no sequence view is mounted.
 */
export function centerSequenceViewOn(start: number, end: number): boolean {
  if (!centerHandler) return false
  centerHandler(start, end)
  return true
}
