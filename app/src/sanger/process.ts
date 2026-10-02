/**
 * Trimming and mixed-base calling for one read or a plate of them.
 *
 * `planRead` works out what would change without changing anything, so the
 * dialog can show every read's result before it is applied. Mixed bases are
 * called inside the new trim, after trimming.
 */

import type { BaseEdit, SequencingRead } from '../store'
import { DEFAULT_MIXED, planMixedCalls, type MixedSettings } from './mixed'
import { DEFAULT_TRIM, planTrim, type TrimSettings } from './trim'

export interface ProcessSettings {
  trimEnabled: boolean
  trim: TrimSettings
  mixed: MixedSettings
}

export const DEFAULT_PROCESS: ProcessSettings = { trimEnabled: true, trim: DEFAULT_TRIM, mixed: DEFAULT_MIXED }

export interface ReadPlan {
  readId: string
  before: [number, number]
  trimStart: number
  trimEnd: number
  edits: BaseEdit[]
  mixedCalls: number
  mixedCleared: number
  notes: string[]
  tooShort: boolean
  changed: boolean
}

export function planRead(read: SequencingRead, s: ProcessSettings): ReadPlan {
  const before: [number, number] = [read.trimStart, read.trimEnd]
  let trimStart = read.trimStart
  let trimEnd = read.trimEnd
  let notes: string[] = []
  let tooShort = false
  if (s.trimEnabled) {
    const t = planTrim(read.data, before, s.trim)
    trimStart = t.start
    trimEnd = t.end
    notes = t.notes
    tooShort = t.tooShort
  }
  let edits = read.edits
  let mixedCalls = 0
  let mixedCleared = 0
  if (s.mixed.enabled) {
    const m = planMixedCalls(read.data, read.edits, trimStart, trimEnd, s.mixed)
    edits = m.edits
    mixedCalls = m.calls
    mixedCleared = m.cleared
  }
  const changed = trimStart !== read.trimStart || trimEnd !== read.trimEnd || !sameEdits(edits, read.edits)
  return { readId: read.id, before, trimStart, trimEnd, edits, mixedCalls, mixedCleared, notes, tooShort, changed }
}

/** Undo label for applying `s`. */
export function processLabel(s: ProcessSettings): string {
  if (s.trimEnabled && s.mixed.enabled) return 'Trim and call mixed bases'
  if (s.mixed.enabled) return 'Call mixed bases'
  return 'Trim'
}

function sameEdits(a: readonly BaseEdit[], b: readonly BaseEdit[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  const key = (e: BaseEdit) => JSON.stringify(e)
  const set = new Set(b.map(key))
  return a.every(e => set.has(key(e)))
}

// ---------------------------------------------------------------------------
// Remembered settings (the vector is chosen per use: it names an open sequence)
// ---------------------------------------------------------------------------

const KEY = 'seqnexus_trim_settings'

export function loadProcessSettings(): ProcessSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_PROCESS
    const v = JSON.parse(raw) as Partial<ProcessSettings>
    const t = { ...DEFAULT_TRIM, ...(v.trim ?? {}), vector: null }
    if (!['error', 'quality', 'keep'].includes(t.method)) t.method = DEFAULT_TRIM.method
    t.primers = Array.isArray(t.primers) ? t.primers.filter(p => p && typeof p.sequence === 'string' && typeof p.name === 'string') : []
    return {
      trimEnabled: typeof v.trimEnabled === 'boolean' ? v.trimEnabled : true,
      trim: t,
      mixed: { ...DEFAULT_MIXED, ...(v.mixed ?? {}) },
    }
  } catch {
    return DEFAULT_PROCESS
  }
}

export function saveProcessSettings(s: ProcessSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify({ ...s, trim: { ...s.trim, vector: null } })) } catch { /* not remembered */ }
}
