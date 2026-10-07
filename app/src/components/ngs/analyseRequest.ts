/**
 * Opening the guided NGS pipeline (AnalyseReadsDialog.tsx) from anywhere:
 * the read set page and the command palette ask, and the app, which keeps
 * the dialog mounted while the screen behind it changes, answers.
 */

import { useSyncExternalStore } from 'react'

export interface AnalyseRequest {
  readSetIds: string[]
  /** Start on assembling de novo rather than mapping. */
  denovo?: boolean
}

let request: AnalyseRequest | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export function openAnalyse(readSetIds: string[] = [], denovo = false): void {
  request = { readSetIds, denovo }
  emit()
}

export function closeAnalyse(): void {
  request = null
  emit()
}

export function useAnalyseRequest(): AnalyseRequest | null {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l) } }, () => request)
}
