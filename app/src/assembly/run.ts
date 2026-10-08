/**
 * One entry point for assembly, shared by the worker and the main-thread
 * fallback.
 */

import { assembleBatch } from './batch'
import { assembleDeNovo } from './denovo'
import type { NameGrouping } from './groups'
import { mapToReference, type MapReference } from './map'
import type { AssemblyInput, AssemblyReport, AssemblySettings } from './types'

export interface AssemblyRequest {
  mode: 'reference' | 'de-novo'
  /** One reference to map to (the usual case). */
  reference: MapReference | null
  /** Several references, each clone (or read) going to the one it matches best. Takes the place of `reference`. */
  references?: MapReference[]
  /** Reads grouped into clones by name, each clone assembled on its own. */
  grouping?: NameGrouping | null
  inputs: AssemblyInput[]
  settings: AssemblySettings
}

export type AssemblyMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; report: AssemblyReport }
  | { type: 'error'; message: string }

export function runAssembly(req: AssemblyRequest, onProgress?: (done: number, total: number) => void): AssemblyReport {
  const references = req.references?.length ? req.references : req.reference ? [req.reference] : []
  if (req.grouping || references.length > 1) {
    return assembleBatch({ mode: req.mode, references, inputs: req.inputs, grouping: req.grouping ?? null, settings: req.settings }, onProgress)
  }
  if (req.mode === 'reference') {
    if (!references[0]) throw new Error('Choose a reference to map to')
    return mapToReference(references[0], req.inputs, req.settings, onProgress)
  }
  return assembleDeNovo(req.inputs, req.settings, onProgress)
}
