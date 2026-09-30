/**
 * Binding sites of a document's primers, and of the workbench's unsaved
 * picks, recomputed only when the oligos or the bases change.
 *
 * `sequence.bases` is cached per piece-table version, so it is the same
 * string until an edit lands and makes a sound memo key; the document object
 * itself changes on every annotation tweak and would re-run the search for
 * nothing.
 */

import { useMemo } from 'react'
import type { DocumentState } from '../models/Document'
import type { DesignPicks } from '../store'
import { findBindingSites, type BindingSite } from './binding'
import type { PrimerData } from './oligo'
import { primerItems, type PrimerItem } from './display'

const NO_PRIMERS: PrimerData[] = []
const NO_SITES: ReadonlyMap<string, BindingSite[]> = new Map()

export function usePrimerSites(doc: DocumentState): ReadonlyMap<string, BindingSite[]> {
  const primers = doc.primers ?? NO_PRIMERS
  const bases = primers.length > 0 ? doc.sequence.bases : ''
  const topology = doc.sequence.topology
  return useMemo(
    () => (primers.length === 0 ? NO_SITES : findBindingSites(primers, bases, topology)),
    [primers, bases, topology],
  )
}

export type DesignRole = keyof DesignPicks

export const DESIGN_ROLES: readonly DesignRole[] = ['forward', 'reverse', 'probe']

/** Id of the stand-in oligo for a workbench pick. */
export function designOligoId(role: DesignRole): string {
  return `design-${role}`
}

const ROLE_LABEL: Record<DesignRole, string> = {
  forward: 'Forward (unsaved)',
  reverse: 'Reverse (unsaved)',
  probe: 'Probe (unsaved)',
}

/** The workbench's picks as oligos, so they bind and draw like saved ones. */
export function designOligos(picks: DesignPicks): PrimerData[] {
  const out: PrimerData[] = []
  for (const role of DESIGN_ROLES) {
    const sequence = picks[role]
    if (sequence) {
      out.push({ id: designOligoId(role), name: ROLE_LABEL[role], sequence, role: role === 'probe' ? 'probe' : 'primer' })
    }
  }
  return out
}

export interface DesignPreview {
  oligos: PrimerData[]
  sites: ReadonlyMap<string, BindingSite[]>
  items: PrimerItem[]
}

const NO_BATCH: { name: string; sequence: string }[] = []

export function useDesignPreview(
  doc: DocumentState,
  picks: DesignPicks,
  batch: { name: string; sequence: string }[] = NO_BATCH,
): DesignPreview {
  const { forward, reverse, probe } = picks
  const oligos = useMemo(() => [
    ...designOligos({ forward, reverse, probe }),
    ...batch.map((b, i): PrimerData => ({ id: `design-batch-${i}`, name: `${b.name} (unsaved)`, sequence: b.sequence, role: 'primer' })),
  ], [forward, reverse, probe, batch])
  const bases = oligos.length > 0 ? doc.sequence.bases : ''
  const topology = doc.sequence.topology
  const seqLen = doc.sequence.length
  return useMemo(() => {
    if (oligos.length === 0) return { oligos, sites: NO_SITES, items: [] }
    const sites = findBindingSites(oligos, bases, topology)
    return { oligos, sites, items: primerItems(oligos, sites, seqLen, { preview: true }) }
  }, [oligos, bases, topology, seqLen])
}
