/**
 * Turning an explorer selection into something the rest of the app can use.
 *
 * Selection is stored as uids (`${kind}:${id}`). The export and alignment
 * paths want raw store ids grouped by kind, and both App's File menu and the
 * explorer's own context menu need the same conversion, so it lives here
 * rather than being spelled out at each call site with id-prefix guesswork.
 */

import type { ItemKind } from './types'
import { parseUid } from './types'

/** Store ids grouped by kind, dropping anything unparseable. */
export function groupSelection(selected: Iterable<string>): Partial<Record<ItemKind, string[]>> {
  const out: Partial<Record<ItemKind, string[]>> = {}
  for (const uid of selected) {
    const parsed = parseUid(uid)
    if (!parsed) continue
    ;(out[parsed.kind] ??= []).push(parsed.id)
  }
  return out
}

/** How many selected items can be exported. Every kind can, so: all of them. */
export function countSelectable(selected: Iterable<string>): number {
  let n = 0
  for (const uid of selected) if (parseUid(uid)) n++
  return n
}
