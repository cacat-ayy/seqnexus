/**
 * Resolving what a task is aimed at: a feature of the document, or the
 * selection. Kept apart from the control that offers the choice so both can
 * be used without the other.
 */

import { useMemo } from 'react'
import { useEditorStore } from '../../../store'
import { selectionRange } from '../../../models/selection'
import { codingTarget, type CodingTarget, type FeatureLike } from '../../../crispr/strategy/coding'

export const SELECTION_VALUE = '__selection__'
/** The whole molecule, for a task that can sensibly work over all of it. */
export const WHOLE_VALUE = '__whole__'

export interface ChosenTarget {
  /** The span the task works on. */
  region: { start: number; end: number } | null
  /** The gene, when the chosen feature is a coding one. */
  coding: CodingTarget | null
  label: string
}

export const CODING_TYPES = new Set(['CDS', 'gene', 'mRNA', 'exon'])

/** Features worth aiming at, coding ones first. */
export function useTargetOptions() {
  const annotations = useEditorStore(s => s.doc.annotations)
  return useMemo(() => {
    const coding = annotations.filter(a => CODING_TYPES.has(a.type))
    const rest = annotations.filter(a => !CODING_TYPES.has(a.type))
    return [...coding, ...rest]
  }, [annotations])
}

/** Resolve a choice into a region and, when it is a gene, a coding target. */
export function useChosenTarget(value: string): ChosenTarget {
  const annotations = useEditorStore(s => s.doc.annotations)
  const selection = useEditorStore(s => s.selection)
  const seqLen = useEditorStore(s => s.doc.sequence.length)

  return useMemo(() => {
    if (value === WHOLE_VALUE) {
      return { region: { start: 0, end: seqLen }, coding: null, label: 'the whole sequence' }
    }
    if (value === SELECTION_VALUE) {
      const range = selectionRange(selection)
      return {
        region: range ? { start: range[0], end: range[1] } : null,
        coding: null,
        label: 'the selection',
      }
    }
    const feature = annotations.find(a => a.id === value)
    if (!feature) return { region: null, coding: null, label: 'nothing' }
    const like: FeatureLike = {
      name: feature.name,
      type: feature.type,
      start: feature.start,
      end: feature.end,
      strand: feature.strand,
      ...(feature.segments ? { segments: feature.segments } : {}),
      ...(feature.qualifiers ? { qualifiers: feature.qualifiers } : {}),
    }
    const region = feature.start < feature.end
      ? { start: feature.start, end: feature.end }
      : { start: feature.start, end: seqLen }
    return {
      region,
      coding: CODING_TYPES.has(feature.type) ? codingTarget(like, seqLen) : null,
      label: feature.name,
    }
  }, [value, annotations, selection, seqLen])
}

