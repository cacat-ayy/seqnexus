/**
 * The main view's visible range, shared with its minimap outside React.
 *
 * Scrolling changes the viewport on every frame. Routing that through React
 * state re-rendered the minimap and repainted all of its tracks per scroll
 * event; this lets the host publish from its own draw or scroll handler and
 * the minimap repaint only its overlay layer.
 */

import type { Viewport } from './types'

export interface ViewportSource {
  get: () => Viewport
  /** Publish a new range; listeners only hear about real changes. */
  set: (vp: Viewport) => void
  subscribe: (listener: () => void) => () => void
}

/** Changes smaller than this (in units) are not worth a repaint. */
const EPSILON = 1e-3

export function createViewportSource(initial: Viewport = { start: 0, end: 0 }): ViewportSource {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set: vp => {
      if (Math.abs(vp.start - current.start) < EPSILON && Math.abs(vp.end - current.end) < EPSILON) return
      current = vp
      for (const l of listeners) l()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
