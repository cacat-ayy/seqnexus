/**
 * Transient notifications.
 *
 * One store for the whole app, replacing what used to be three unrelated
 * mechanisms: two pieces of `useToasts` state owned by App, and a module-level
 * singleton in StorageToast. They all rendered at the same fixed position, so
 * any two that fired together overlapped exactly.
 *
 * A zustand store rather than a hook because half the callers are not
 * components: persistence.ts saves on a timer, workers report failures, and the
 * clipboard helper is a plain function. `useEditorStore.getState()` from
 * non-React code is already the established pattern here, and this follows it.
 *
 *   notify.success('Copied 240 bp')
 *   notify.error('Could not read "plasmid.gb"', { detail: err.message })
 *   notify.success('Deleted 3 features', { action: { label: 'Undo', onClick: undo } })
 */

import { create } from 'zustand'

export type ToastSeverity = 'success' | 'info' | 'warning' | 'error'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: string
  severity: ToastSeverity
  /** One line, sentence case, no terminal full stop. */
  message: string
  /** Optional second line for specifics: a parser error, a filename, a quota. */
  detail?: string
  /** At most one. Rendered as a button; activating it also dismisses. */
  action?: ToastAction
  /** Milliseconds until auto-dismiss. 0 means it stays until dismissed. */
  duration: number
  /**
   * Collapses repeats. A new toast with a key already on screen replaces that
   * one in place rather than stacking, so a save that fails every 10 seconds
   * does not bury everything else.
   */
  key?: string
}

export interface ToastOptions {
  detail?: string
  action?: ToastAction
  /** Override the per-severity default. 0 pins the toast open. */
  duration?: number
  key?: string
}

/**
 * Errors do not auto-dismiss. An error the user never read is worse than one
 * that lingers, and ours carry the longest text in the app. Everything else is
 * a confirmation the user can afford to miss.
 */
const DEFAULT_DURATION: Record<ToastSeverity, number> = {
  success: 3000,
  info: 4000,
  warning: 8000,
  error: 0,
}

/**
 * How many are visible at once. Beyond this the oldest dismissable toast is
 * dropped, so a burst of confirmations cannot push an error off screen.
 */
export const MAX_VISIBLE = 3

interface ToastStore {
  toasts: Toast[]
  push: (severity: ToastSeverity, message: string, opts?: ToastOptions) => string
  dismiss: (id: string) => void
  clear: () => void
}

let _seq = 0
const nextId = () => `toast_${++_seq}`

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  push(severity, message, opts = {}) {
    const toast: Toast = {
      id: nextId(),
      severity,
      message,
      detail: opts.detail,
      action: opts.action,
      duration: opts.duration ?? DEFAULT_DURATION[severity],
      key: opts.key,
    }

    set(state => {
      // Same key already on screen: replace in place, keeping its position so
      // the stack does not reshuffle under the pointer.
      if (toast.key) {
        const at = state.toasts.findIndex(t => t.key === toast.key)
        if (at !== -1) {
          const toasts = state.toasts.slice()
          toasts[at] = toast
          return { toasts }
        }
      }

      const toasts = [...state.toasts, toast]
      while (toasts.length > MAX_VISIBLE) {
        // Evict the oldest one the user could have dismissed anyway, never a
        // sticky error and never the toast being added. Dropping the new one
        // would make the action that triggered it look like it did nothing,
        // which is the failure mode this whole system exists to avoid, so if
        // the only expendable toast is the new one, let the stack grow.
        const victim = toasts.slice(0, -1).findIndex(t => t.duration > 0)
        if (victim === -1) break
        toasts.splice(victim, 1)
      }
      return { toasts }
    })

    return toast.id
  },

  dismiss(id) {
    set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }))
  },

  clear() {
    set({ toasts: [] })
  },
}))

/** Call this from anywhere, React or not. */
export const notify = {
  success: (message: string, opts?: ToastOptions) =>
    useToastStore.getState().push('success', message, opts),
  info: (message: string, opts?: ToastOptions) =>
    useToastStore.getState().push('info', message, opts),
  warning: (message: string, opts?: ToastOptions) =>
    useToastStore.getState().push('warning', message, opts),
  error: (message: string, opts?: ToastOptions) =>
    useToastStore.getState().push('error', message, opts),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  clear: () => useToastStore.getState().clear(),
}
