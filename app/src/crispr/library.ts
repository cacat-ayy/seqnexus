/**
 * Guides you keep.
 *
 * The same arrangement as the oligo library: a guide saved once is yours
 * across every document, and the useful question about it afterwards is not
 * what it scored when you designed it but whether it binds the sequence in
 * front of you now. So a library guide meeting a document is a search, and
 * the answer is where it would cut here, which is often nowhere.
 *
 * A kept guide carries what it scored at the time, marked as of then. Scores
 * depend on settings that can change, and a number recorded in March should
 * not pretend to be a measurement made today.
 */

import { useMemo } from 'react'
import { findGuideSites } from './finder'
import { resolveNuclease } from './nucleases'
import type { GuideCandidate, GuideRecord, GuideSite, Nuclease } from './types'

export interface LibraryMatch {
  guide: GuideRecord
  /** Where it binds here, if it does. */
  site: GuideSite | null
  /** How many places it binds, when it binds more than one. */
  siteCount: number
}

/** A guide kept from a candidate, with where and when it came from. */
export function recordFromCandidate(
  candidate: GuideCandidate,
  nuclease: Nuclease,
  name: string,
  documentId: string | null,
  documentName: string | null,
  id: string,
): GuideRecord {
  return {
    id,
    name,
    nucleaseId: nuclease.id,
    spacer: candidate.site.spacer,
    pam: candidate.site.pam,
    origin: {
      ...(documentId ? { documentId } : {}),
      ...(documentName ? { documentName } : {}),
      start: candidate.site.start,
      end: candidate.site.end,
      strand: candidate.site.strand,
    },
    scores: candidate.scores,
    createdAt: Date.now(),
  }
}

/**
 * Where each library guide binds in a sequence.
 *
 * The scan is run once per nuclease rather than once per guide, since the
 * expensive half is finding the PAMs and most libraries use one or two
 * nucleases.
 */
export function libraryMatches(
  guides: readonly GuideRecord[],
  bases: string,
  topology: 'linear' | 'circular',
  custom: readonly Nuclease[] = [],
): LibraryMatch[] {
  if (guides.length === 0 || bases.length === 0) {
    return guides.map(guide => ({ guide, site: null, siteCount: 0 }))
  }

  const byNuclease = new Map<string, GuideSite[]>()
  const out: LibraryMatch[] = []
  for (const guide of guides) {
    const nuclease = resolveNuclease(guide.nucleaseId, custom)
    if (!nuclease) { out.push({ guide, site: null, siteCount: 0 }); continue }
    const key = `${nuclease.id}:${guide.spacer.length}`
    let sites = byNuclease.get(key)
    if (!sites) {
      sites = findGuideSites(bases, nuclease, topology, { spacerLength: guide.spacer.length }).sites
      byNuclease.set(key, sites)
    }
    const spacer = guide.spacer.toUpperCase()
    const hits = sites.filter(s => s.spacer === spacer)
    out.push({ guide, site: hits[0] ?? null, siteCount: hits.length })
  }
  return out
}

/** Memoised on the library and the sequence, for the panel. */
export function useLibraryMatches(
  guides: readonly GuideRecord[],
  bases: string,
  topology: 'linear' | 'circular',
  custom: readonly Nuclease[] = [],
): LibraryMatch[] {
  return useMemo(
    () => libraryMatches(guides, bases, topology, custom),
    [guides, bases, topology, custom],
  )
}

/** A name that is not already taken, for a guide being kept. */
export function freeName(wanted: string, guides: readonly GuideRecord[]): string {
  const taken = new Set(guides.map(g => g.name.toLowerCase()))
  if (!taken.has(wanted.toLowerCase())) return wanted
  for (let i = 2; i < 1000; i++) {
    const next = `${wanted} ${i}`
    if (!taken.has(next.toLowerCase())) return next
  }
  return `${wanted} ${Date.now()}`
}

/** The library as a table, for ordering or for a notebook. */
export function libraryCsv(guides: readonly GuideRecord[]): string {
  const rows = [['name', 'spacer', 'pam', 'nuclease', 'from', 'at', 'notes'].join(',')]
  for (const g of guides) {
    rows.push([
      g.name,
      g.spacer,
      g.pam,
      g.nucleaseId,
      g.origin?.documentName ?? '',
      g.origin ? String(g.origin.start + 1) : '',
      (g.notes ?? '').replace(/[\r\n,]+/g, ' '),
    ].join(','))
  }
  return rows.join('\n')
}
