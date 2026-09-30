/**
 * What you can do with a band: find it in its sequence, or cut it out.
 *
 * Both leave the gel: one opens the source sequence with the fragment
 * selected, the other opens the fragment as a new sequence, the way a band is
 * cut out of an agarose gel and purified.
 */

import { useEditorStore } from '../store'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { getEnzyme, type RestrictionEnzyme } from '../enzymes/db'
import { digestFragments } from '../cloning/digest'
import { notify } from '../toast'
import type { FragmentOrigin } from './model'
import { formatBp } from './render/scene'

/** The live document behind a tab: the store's copy when it is the open one. */
function docOf(tabId: string): DocumentState | null {
  const s = useEditorStore.getState()
  if (s.activeTabId === tabId) return s.doc
  return s.tabs.find(t => t.id === tabId)?.doc ?? null
}

/** The bases a fragment covers on its source, wrapping the origin if it does. */
export function fragmentBases(bases: string, f: FragmentOrigin): string {
  return f.end > f.start ? bases.slice(f.start, f.end) : bases.slice(f.start) + bases.slice(0, f.end)
}

/**
 * Open the source sequence with the fragment selected. A fragment spanning
 * the origin of a circle becomes a selection that wraps.
 */
export function selectInSequence(sourceId: string, f: FragmentOrigin): void {
  const s = useEditorStore.getState()
  const doc = docOf(sourceId)
  if (!doc) return
  s.setActiveTab(sourceId)
  const len = doc.sequence.length
  // An end of 0 on a circle means "to the last base".
  const caret = f.end === 0 ? len : f.end
  useEditorStore.getState().smoothScrollRequested = true
  useEditorStore.getState().setSelection({ anchor: f.start, caret })
}

function describeEnd(name: string | null, overhang: string, type: string): string {
  if (!name) return 'sequence end'
  if (type === 'blunt' || !overhang) return `${name}, blunt`
  return `${name}, ${type === 'five_prime' ? "5'" : "3'"} overhang ${overhang}`
}

/**
 * Cut a band out: open the fragment as a new sequence, features carried
 * over, with its ends described. Methylation follows the source.
 */
export function extractFragment(sourceId: string, enzymeNames: string[], f: FragmentOrigin): boolean {
  const doc = docOf(sourceId)
  if (!doc) {
    notify.error('The source sequence is no longer open')
    return false
  }
  const enzymes = enzymeNames.map(n => getEnzyme(n)).filter((e): e is RestrictionEnzyme => !!e)
  const body = fragmentBases(doc.sequence.bases, f).toUpperCase()
  const fragment = digestFragments(doc, enzymes).fragments.find(fr => fr.sequence.toUpperCase() === body)
  if (!fragment) {
    notify.error('Could not cut out this fragment')
    return false
  }
  const size = fragment.sequence.length
  const ends = `${f.leftEnzyme ?? 'end'}–${f.rightEnzyme ?? 'end'}`
  const meta = doc.metadata ?? {}
  const state: DocumentState = {
    name: `${doc.name} ${ends} ${formatBp(size)}`,
    description: [
      `Extracted from a virtual gel: ${doc.name} cut with ${enzymeNames.join(' + ')}, ${size.toLocaleString()} bp.`,
      `Left end: ${describeEnd(f.leftEnzyme, fragment.overhang5, fragment.overhang5Type)}.`,
      `Right end: ${describeEnd(f.rightEnzyme, fragment.overhang3, fragment.overhang3Type)}.`,
    ].join('\n'),
    sequence: new Sequence(fragment.sequence, 'linear'),
    annotations: fragment.annotations.map(a => new Annotation(a)),
    metadata: {
      ...(meta.damMethylated ? { damMethylated: true } : {}),
      ...(meta.dcmMethylated ? { dcmMethylated: true } : {}),
      origin: 'gel',
    },
  }
  useEditorStore.getState().openDocumentState(state)
  notify.success(`Opened the ${formatBp(size)} fragment as a new sequence`)
  return true
}

/** The template for a PCR lane, for opening its product. */
export function pcrTemplate(templateId: string): DocumentState | null {
  return docOf(templateId)
}
