/**
 * A value that changes often (the hovered cell, the scroll position) and that
 * only a few small components read. Routing it through workspace state would
 * re-render the whole workspace on every mouse move.
 */

import { useSyncExternalStore } from 'react'

export interface Signal<T> {
  get: () => T
  set: (v: T) => void
  subscribe: (listener: () => void) => () => void
}

export function createSignal<T>(initial: T, equal: (a: T, b: T) => boolean = Object.is): Signal<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: v => {
      if (equal(value, v)) return
      value = v
      for (const l of listeners) l()
    },
    subscribe: l => {
      listeners.add(l)
      return () => { listeners.delete(l) }
    },
  }
}

export function useSignal<T>(signal: Signal<T>): T {
  return useSyncExternalStore(signal.subscribe, signal.get, signal.get)
}
