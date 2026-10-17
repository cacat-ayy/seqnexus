/**
 * Web Worker: restriction enzyme site finder.
 *
 * Runs the shared finder (enzymes/finder.ts) off the main thread to avoid
 * blocking the UI on large sequences. Sites go back without their enzyme
 * objects, which the main thread reattaches by index.
 */

import type { RestrictionEnzyme } from '../enzymes/db'
import { scanEnzymes, type CutSite } from '../enzymes/finder'

export interface EnzymeFinderRequest {
  bases: string
  enzymes: RestrictionEnzyme[]
  topology: 'linear' | 'circular'
  maxSites: number
}

export type SerializedCutSite = Omit<CutSite, 'enzyme'> & {
  enzymeIdx: number
}

export interface EnzymeFinderResponse {
  sites: SerializedCutSite[]
  /** Enzymes past the site limit, as [name, number of sites]. */
  tooMany: [string, number][]
}

self.onmessage = (e: MessageEvent<EnzymeFinderRequest>) => {
  const { bases, enzymes, topology, maxSites } = e.data
  const index = new Map(enzymes.map((enzyme, i) => [enzyme, i]))
  const scan = scanEnzymes(bases, enzymes, topology, maxSites)
  const sites: SerializedCutSite[] = []
  for (const { enzyme, position, end, fwdCut, revCut, cut2, strand, offEnd } of scan.sites) {
    sites.push({
      position, end, fwdCut, revCut, strand,
      ...(cut2 ? { cut2 } : {}),
      ...(offEnd ? { offEnd } : {}),
      enzymeIdx: index.get(enzyme)!,
    })
  }
  const response: EnzymeFinderResponse = { sites, tooMany: [...scan.tooMany] }
  self.postMessage(response)
}
