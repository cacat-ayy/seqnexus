/**
 * Whether a sequence being opened is already open: the same name, molecule
 * and bases. Opening the same file twice used to give two identical items
 * with nothing to tell them apart. A sequence of the same name but other
 * bases (a newer version of a plasmid) is not a duplicate and opens as usual.
 */

import type { DocumentState } from '../models/Document'

export function isSameDocument(a: DocumentState, b: DocumentState): boolean {
  return a.name === b.name
    && a.sequence.alphabet === b.sequence.alphabet
    && a.sequence.length === b.sequence.length
    && a.sequence.bases === b.sequence.bases
}

/** The open tab holding the same document, if there is one. */
export function openTwin<T extends { doc: DocumentState }>(doc: DocumentState, tabs: readonly T[]): T | undefined {
  return tabs.find(t => isSameDocument(t.doc, doc))
}
