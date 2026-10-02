/**
 * One entry point for assembly, shared by the worker and the main-thread
 * fallback.
 */

import { assembleDeNovo } from './denovo'
import { mapToReference, type MapReference } from './map'
import type { AssemblyInput, AssemblyReport, AssemblySettings } from './types'

export interface AssemblyRequest {
  mode: 'reference' | 'de-novo'
  reference: MapReference | null
  inputs: AssemblyInput[]
  settings: AssemblySettings
}

export type AssemblyMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; report: AssemblyReport }
  | { type: 'error'; message: string }

export function runAssembly(req: AssemblyRequest, onProgress?: (done: number, total: number) => void): AssemblyReport {
  if (req.mode === 'reference') {
    if (!req.reference) throw new Error('Choose a reference to map to')
    return mapToReference(req.reference, req.inputs, req.settings, onProgress)
  }
  return assembleDeNovo(req.inputs, req.settings, onProgress)
}
