/**
 * A selection in a sequence: an anchor and a focus, which may run the long
 * way round a circular sequence, and the extra selections a multi-select
 * adds. The helpers here turn selections into segments of the sequence, join
 * and order them, and extend them from the keyboard.
 */

import type { DocumentState } from './Document'
import type { Sequence } from './Sequence'

export interface Selection {
  anchor: number
  caret: number
  /**
   * The selection was dragged right to left. A drag stores its ends in order
   * (anchor before caret), because on a circular sequence anchor > caret
   * means a selection across the origin, so the direction is kept here. Read
   * by the selection translation, which reads in the direction of the drag.
   */
  reverse?: boolean
}

/**
 * Whether a selection reads right to left.
 *
 * The drag's own record when there is one. Otherwise (keyboard extension,
 * code) a linear selection whose caret is before its anchor was made
 * leftwards; on a circular sequence that ordering means the origin instead,
 * so it reads forwards.
 */
export function selectionIsReverse(sel: Selection, topology: string): boolean {
  if (sel.reverse !== undefined) return sel.reverse
  return topology !== 'circular' && sel.caret < sel.anchor
}

export function selectionRange(sel: Selection): [number, number] | null {
  if (sel.anchor === sel.caret) return null
  return [Math.min(sel.anchor, sel.caret), Math.max(sel.anchor, sel.caret)]
}

/**
 * Check if a selection spans the origin on a circular sequence.
 * This is encoded as anchor > caret (the selection wraps around position 0).
 */
export function isOriginSpanningSelection(sel: Selection, topology: string): boolean {
  return topology === 'circular' && sel.anchor > sel.caret && sel.anchor !== sel.caret
}

/**
 * Get the selected base ranges, handling origin-spanning on circular sequences.
 * Returns one or two [start, end) ranges. For origin-spanning selections,
 * returns [[anchor, seqLen), [0, caret)].
 */
export function selectionSegments(
  sel: Selection,
  topology: string,
  seqLen: number,
): [number, number][] {
  if (sel.anchor === sel.caret) return []
  if (isOriginSpanningSelection(sel, topology)) {
    // Wraps around origin: [anchor..seqLen) + [0..caret)
    const segs: [number, number][] = []
    if (sel.anchor < seqLen) segs.push([sel.anchor, seqLen])
    if (sel.caret > 0) segs.push([0, sel.caret])
    return segs
  }
  return [[Math.min(sel.anchor, sel.caret), Math.max(sel.anchor, sel.caret)]]
}

/**
 * Total number of selected bases, handling origin-spanning.
 */
export function selectionLength(sel: Selection, topology: string, seqLen: number): number {
  const segs = selectionSegments(sel, topology, seqLen)
  return segs.reduce((sum, [s, e]) => sum + (e - s), 0)
}

/**
 * The two ends of a selection as the user made it: `fixed` stays put when the
 * selection is extended, `focus` is the end that moves (where the caret is).
 * A selection made leftwards has its focus at the start. On a circular
 * sequence the end of a selection across the origin is past position 0.
 */
export function selectionEnds(sel: Selection, topology: string): { fixed: number; focus: number } {
  if (sel.anchor === sel.caret) return { fixed: sel.caret, focus: sel.caret }
  const start = isOriginSpanningSelection(sel, topology) ? sel.anchor : Math.min(sel.anchor, sel.caret)
  const end = isOriginSpanningSelection(sel, topology) ? sel.caret : Math.max(sel.anchor, sel.caret)
  return selectionIsReverse(sel, topology) ? { fixed: end, focus: start } : { fixed: start, focus: end }
}

/**
 * Extend a selection from its fixed end, as Shift with a key or a click does.
 *
 * The result follows the convention a drag uses: ends stored in order, the
 * direction in `reverse`. Storing the caret before the anchor instead would
 * read, on a circular sequence, as a selection across the origin, which is
 * how Shift+Left used to select nearly the whole plasmid.
 *
 * `to` moves the focus to a position, and the selection runs between the two
 * without crossing the origin (Home, End, a click). `by` moves the focus a
 * number of bases (the arrows); on a circular sequence that may carry it past
 * the origin, and the selection then spans it.
 */
export function extendSelection(
  sel: Selection,
  move: { to: number } | { by: number },
  topology: string,
  seqLen: number,
): Selection {
  const circular = topology === 'circular'
  const { fixed } = selectionEnds(sel, topology)
  const span = (from: number, to: number, reverse: boolean): Selection =>
    from === to ? { anchor: to, caret: to } : { anchor: from, caret: to, reverse }

  if ('to' in move) {
    const t = Math.max(0, Math.min(seqLen, move.to))
    return t < fixed ? span(t, fixed, true) : span(fixed, t, false)
  }

  // Signed length from the fixed end: positive when the focus is after it.
  const length = selectionLength(sel, topology, seqLen)
  let extent = (length > 0 && selectionIsReverse(sel, topology) ? -length : length) + move.by

  if (!circular) {
    extent = Math.max(-fixed, Math.min(seqLen - fixed, extent))
    if (extent === 0) return span(fixed, fixed, false)
    return extent > 0 ? span(fixed, fixed + extent, false) : span(fixed + extent, fixed, true)
  }

  // Circular: positions 0 and seqLen are one point, so work from 0..seqLen-1.
  const f = fixed % seqLen
  if (extent === 0) return span(fixed, fixed, false)
  if (Math.abs(extent) >= seqLen) {
    // The whole circle: only expressible from the origin.
    if (f === 0) return span(0, seqLen, extent < 0)
    extent = Math.sign(extent) * (seqLen - 1)
  }
  if (extent > 0) {
    const end = f + extent
    return span(f, end <= seqLen ? end : end - seqLen, false)
  }
  const start = f + extent
  if (start >= 0) return span(start, f, true)
  // Past the origin leftwards. Ending exactly at the origin is the end of
  // the sequence, not a selection across it.
  return span(start + seqLen, f === 0 ? seqLen : f, true)
}

// --- Several ranges at once ---
//
// Ctrl+drag (or Ctrl+click on a feature) selects a range beside the ones
// already selected. The range being made or dragged stays `selection`, the
// active one: the caret, the keyboard and every single-range tool act on it.
// The others are kept beside it (see MultiSelection) and never overlap or
// touch it: ranges that meet merge into one.

/** Two ranges' segments share a base or meet end to end. */
function segmentsMeet(a: [number, number][], b: [number, number][], circular: boolean, seqLen: number): boolean {
  for (const [as, ae] of a) {
    for (const [bs, be] of b) {
      if (as <= be && bs <= ae) return true
      // On a circle the end of the sequence and its start are one point.
      if (circular && ((ae === seqLen && bs === 0) || (be === seqLen && as === 0))) return true
    }
  }
  return false
}

/**
 * The active range merged with every other range it overlaps or meets, and
 * the ranges it did not reach, in order along the sequence.
 *
 * Merging repeats until nothing more meets, since a range grown by one merge
 * can reach the next. The merged range keeps the active one's direction. An
 * empty active range (a caret) merges with nothing; empty others are dropped.
 */
export function mergeSelections(
  active: Selection,
  others: Selection[],
  topology: string,
  seqLen: number,
): { active: Selection; others: Selection[] } {
  const circular = topology === 'circular'
  let rest = others.filter(o => o.anchor !== o.caret)
  let segs = selectionSegments(active, topology, seqLen)
  if (segs.length > 0) {
    let grown = true
    while (grown) {
      grown = false
      const keep: Selection[] = []
      for (const o of rest) {
        const os = selectionSegments(o, topology, seqLen)
        if (segmentsMeet(segs, os, circular, seqLen)) { segs = unionSegments([...segs, ...os]); grown = true }
        else keep.push(o)
      }
      rest = keep
    }
  }
  if (segs.length > 0 && rest.length < others.length) {
    const reverse = selectionIsReverse(active, topology)
    const first = segs[0]
    const last = segs[segs.length - 1]
    // Joined into one span, or across the origin as two.
    if (segs.length === 1) active = { anchor: first[0], caret: first[1], reverse }
    else if (circular && segs.length === 2 && first[0] === 0 && last[1] === seqLen) {
      active = { anchor: last[0], caret: first[1], reverse }
    }
  }
  return { active, others: orderSelections(rest, topology) }
}

/** Overlapping or adjacent [start, end) segments joined, in order. */
function unionSegments(segs: [number, number][]): [number, number][] {
  const sorted = [...segs].sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const [s, e] of sorted) {
    const last = out[out.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

/** Where a range starts reading: an origin-spanning one at its anchor. */
function rangeStart(sel: Selection, topology: string): number {
  return isOriginSpanningSelection(sel, topology) ? sel.anchor : Math.min(sel.anchor, sel.caret)
}

/**
 * Ranges in reading order: the one across the origin first, if there is
 * one, then the rest by where they start. That is the order a GenBank join
 * across the origin is written in, and on a linear sequence it is simply
 * left to right.
 */
export function orderSelections(ranges: Selection[], topology: string): Selection[] {
  const spans = (s: Selection) => isOriginSpanningSelection(s, topology)
  return [...ranges].sort((a, b) =>
    (spans(a) ? 0 : 1) - (spans(b) ? 0 : 1) || rangeStart(a, topology) - rangeStart(b, topology))
}

/**
 * Every selected base as [start, end) segments in reading order: the
 * ranges joined the way exons are, each read 5' to 3'. With one range this
 * is selectionSegments. Copying and the joined translation read this.
 */
export function joinedSegments(ranges: Selection[], topology: string, seqLen: number): [number, number][] {
  return orderSelections(ranges, topology).flatMap(r => selectionSegments(r, topology, seqLen))
}

/**
 * Ranges selected beside the active one, and what they belong to. They are
 * bound to the tab and to the sequence's edit count, so any edit, undo or
 * switch of tab drops them without each of those having to: edits change
 * the bases in place, which would leave the ranges pointing at the wrong
 * ones.
 */
export interface MultiSelection {
  tabId: string
  sequence: Sequence
  version: number
  ranges: Selection[]
}

const NO_RANGES: Selection[] = []

/** The ranges selected beside the active one, empty when there are none. */
export function extraSelectionsOf(s: {
  multiSelection: MultiSelection | null; activeTabId: string | null; doc: DocumentState
}): Selection[] {
  const m = s.multiSelection
  if (!m || m.tabId !== s.activeTabId || m.sequence !== s.doc.sequence
      || m.version !== s.doc.sequence.pieceTable.version) return NO_RANGES
  return m.ranges
}

/** The active range (unless it is only a caret) and the others, in reading order. */
export function selectedRanges(selection: Selection, extra: readonly Selection[], topology: string): Selection[] {
  const active = selection.anchor === selection.caret ? [] : [selection]
  return extra.length === 0 ? active : orderSelections([...active, ...extra], topology)
}

/** Every selected range, the active one included, in reading order. */
export function allSelectionsOf(s: {
  multiSelection: MultiSelection | null; activeTabId: string | null; doc: DocumentState; selection: Selection
}): Selection[] {
  return selectedRanges(s.selection, extraSelectionsOf(s), s.doc.sequence.topology)
}
