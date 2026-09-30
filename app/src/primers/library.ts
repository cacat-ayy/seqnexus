/**
 * The primer library meeting a sequence: which library oligos bind it and
 * are not on it yet. Used to offer them in the Primers tab, and to say so
 * when a sequence is opened.
 */

import { useMemo } from 'react'
import type { DocumentState } from '../models/Document'
import { findBindingSites, type BindingSite } from './binding'
import type { LibraryOligo, PrimerData } from './oligo'

export interface LibraryMatch {
  oligo: LibraryOligo
  site: BindingSite
  siteCount: number
}

export function libraryMatches(oligos: readonly LibraryOligo[], doc: DocumentState): LibraryMatch[] {
  if (oligos.length === 0 || doc.sequence.length === 0) return []
  const onDoc = new Set((doc.primers ?? []).map(p => p.sequence))
  const candidates = oligos.filter(o => !onDoc.has(o.sequence))
  if (candidates.length === 0) return []
  const sites = findBindingSites(candidates, doc.sequence.bases, doc.sequence.topology)
  const out: LibraryMatch[] = []
  for (const oligo of candidates) {
    const s = sites.get(oligo.id) ?? []
    if (s.length > 0) out.push({ oligo, site: s[0], siteCount: s.length })
  }
  return out
}

/** Memoised on the library, the document's primers and its bases. */
export function useLibraryMatches(oligos: readonly LibraryOligo[], doc: DocumentState): LibraryMatch[] {
  const bases = oligos.length > 0 ? doc.sequence.bases : ''
  return useMemo(
    () => libraryMatches(oligos, doc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [oligos, doc.primers, bases, doc.sequence.topology],
  )
}

/** A library oligo as a primer for a document: a fresh, unlinked copy. */
export function toDocumentPrimer(o: LibraryOligo, id: string): PrimerData {
  return {
    id,
    name: o.name,
    sequence: o.sequence,
    role: o.role,
    ...(o.color ? { color: o.color } : {}),
    ...(o.notes ? { notes: o.notes } : {}),
    ...(o.mods ? { mods: o.mods } : {}),
  }
}
