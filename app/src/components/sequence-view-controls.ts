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
