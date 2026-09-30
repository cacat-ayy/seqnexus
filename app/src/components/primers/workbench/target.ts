/**
 * "The region this task works on": follows the selection by default, or
 * can be typed. Every workbench task needs one (the PCR target, the insert
 * to clone, the bases to mutate, the region to sequence).
 */

import { useEffect, useState } from 'react'
import { useEditorStore, selectionRange } from '../../../store'
import type { Region } from '../../../primers/design/types'

export const regionLength = (r: Region, n: number) => (r.start < r.end ? r.end - r.start : n - r.start + r.end)
export const fmtRegion = (r: Region) => `${(r.start + 1).toLocaleString()}..${r.end.toLocaleString()}`

export interface SelectionTarget {
  target: Region | null
  follow: boolean
  setFollow: (v: boolean) => void
  setManual: (r: Region | null) => void
  /** The current selection, whatever `follow` says. */
  selection: Region | null
}

/**
 * Following keeps the last real target when the selection collapses to a
 * caret, so clicking into the sequence does not wipe it. With `allowEmpty`
 * a caret counts too, as an empty region at the caret (an insertion point).
 */
export function useSelectionTarget(allowEmpty = false): SelectionTarget {
  const sel = useEditorStore(s => s.selection)
  const [follow, setFollow] = useState(true)
  const [manual, setManual] = useState<Region | null>(null)
  const range = selectionRange(sel)
  const selection: Region | null = range
    ? { start: range[0], end: range[1] }
    : allowEmpty ? { start: sel.caret, end: sel.caret } : null

  useEffect(() => {
    if (follow && selection) setManual(selection)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, selection?.start, selection?.end])

  return { target: follow ? (selection ?? manual) : manual, follow, setFollow, setManual, selection }
}
