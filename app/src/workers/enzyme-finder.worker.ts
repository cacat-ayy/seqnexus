/**
 * Web Worker: restriction enzyme site finder.
 *
 * Runs the shared finder (enzymes/finder.ts) off the main thread to avoid
 * blocking the UI on large sequences. Sites go back without their enzyme
 * objects, which the main thread reattaches by index.
 */

import type { RestrictionEnzyme } from '../enzymes/db'
import { findCutSites, type CutSite } from '../enzymes/finder'

export interface EnzymeFinderRequest {
  bases: string
  enzymes: RestrictionEnzyme[]
  topology: 'linear' | 'circular'
}

export type SerializedCutSite = Omit<CutSite, 'enzyme'> & {
  enzymeName: string
  enzymeIdx: number
}

export interface EnzymeFinderResponse {
  sites: SerializedCutSite[]
}

self.onmessage = (e: MessageEvent<EnzymeFinderRequest>) => {
  const { bases, enzymes, topology } = e.data
  const allSites: SerializedCutSite[] = []

  enzymes.forEach((enzyme, enzymeIdx) => {
    for (const { position, end, fwdCut, revCut, strand, offEnd } of findCutSites(bases, enzyme, topology)) {
      allSites.push({
        position, end, fwdCut, revCut, strand,
        ...(offEnd ? { offEnd } : {}),
        enzymeName: enzyme.name,
        enzymeIdx,
      })
    }
  })

  allSites.sort((a, b) => a.position - b.position)
  const response: EnzymeFinderResponse = { sites: allSites }
  self.postMessage(response)
}
