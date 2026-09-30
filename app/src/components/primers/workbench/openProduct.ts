/**
 * Turning a design into a document: the PCR product of two primers, or the
 * mutant a mutagenesis design makes. Both open as new tabs and say so.
 */

import { useEditorStore } from '../../../store'
import { Sequence } from '../../../models/Sequence'
import { Annotation } from '../../../models/Annotation'
import { replaceBases, snapshot, restore, type DocumentState } from '../../../models/Document'
import { simulatePcr } from '../../../primers/pcr'
import type { PrimerData } from '../../../primers/oligo'
import type { Region } from '../../../primers/design/types'
import { notify } from '../../../toast'

/** Run the PCR on a document (the active one by default); opens the product or reports why not. */
export function openPcrProduct(fwd: PrimerData, rev: PrimerData, template?: DocumentState): boolean {
  const doc = template ?? useEditorStore.getState().doc
  const product = simulatePcr({
    name: doc.name,
    bases: doc.sequence.bases,
    topology: doc.sequence.topology,
    annotations: doc.annotations.map(a => a.toData()),
  }, fwd, rev)
  if ('error' in product) {
    notify.error('No PCR product', { detail: product.error })
    return false
  }
  const state: DocumentState = {
    name: product.name,
    description: product.description,
    sequence: new Sequence(product.bases, 'linear'),
    annotations: product.annotations.map(a => new Annotation(a)),
    primers: product.primers,
    metadata: { origin: 'pcr' },
  }
  useEditorStore.getState().openDocumentState(state)
  const also = product.alternatives.length > 0
    ? ` The pair could also make ${product.alternatives.slice(0, 3).map(s => `${s} bp`).join(', ')}${product.alternatives.length > 3 ? '…' : ''}.`
    : ''
  notify.success(`Opened the ${product.bases.length} bp PCR product`, also ? { detail: also.trim() } : undefined)
  return true
}

/** The active document with an edit applied, features moved to fit, as a new tab. */
export function openMutant(at: Region, replacement: string, summary: string): void {
  const doc = useEditorStore.getState().doc
  // A copy, so the edit does not touch the original's piece table.
  const copy = restore(snapshot(doc))
  const mutant = replaceBases(copy, at.start, at.end, replacement.toUpperCase())
  useEditorStore.getState().openDocumentState({
    ...mutant,
    name: `${doc.name} mutant`,
    description: `${summary} (from ${doc.name})`,
    metadata: { ...doc.metadata, origin: 'pcr' },
  })
  notify.success(`Opened the mutant: ${summary}`)
}
