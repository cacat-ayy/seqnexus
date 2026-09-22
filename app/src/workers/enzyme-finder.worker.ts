/**
 * Web Worker: restriction enzyme site finder.
 *
 * Scans a DNA sequence for recognition sites of selected enzymes.
 * Runs off the main thread to avoid blocking the UI on large sequences.
 */

import type { RestrictionEnzyme } from '../enzymes/db'
import { recognitionToRegex } from '../enzymes/db'

export interface EnzymeFinderRequest {
  bases: string
  enzymes: RestrictionEnzyme[]
  topology: 'linear' | 'circular'
}

export interface SerializedCutSite {
  enzymeName: string
  enzymeIdx: number
  position: number
  end: number
  fwdCut: number
  revCut: number
  strand: 1 | -1
}

export interface EnzymeFinderResponse {
  sites: SerializedCutSite[]
}

const COMPLEMENT: Record<string, string> = {
  A: 'T', T: 'A', G: 'C', C: 'G',
  R: 'Y', Y: 'R', S: 'S', W: 'W',
  K: 'M', M: 'K', B: 'V', V: 'B',
  D: 'H', H: 'D', N: 'N',
}

function reverseComplement(seq: string): string {
  const result: string[] = []
  for (let i = seq.length - 1; i >= 0; i--) {
    result.push(COMPLEMENT[seq[i]] ?? seq[i])
  }
  return result.join('')
}

function findSitesForEnzyme(
  upper: string,
  seqLen: number,
  enzyme: RestrictionEnzyme,
  enzymeIdx: number,
  topology: 'linear' | 'circular',
): SerializedCutSite[] {
  const sites: SerializedCutSite[] = []
  const recLen = enzyme.recognition.length
  const pattern = new RegExp(recognitionToRegex(enzyme.recognition), 'gi')
  const rc = reverseComplement(enzyme.recognition.toUpperCase())
  const isPalindrome = enzyme.recognition.toUpperCase() === rc

  const searchSeq = topology === 'circular'
    ? upper + upper.slice(0, recLen - 1)
    : upper

  let m: RegExpExecArray | null
  pattern.lastIndex = 0
  while ((m = pattern.exec(searchSeq)) !== null) {
    const pos = m.index
    if (pos >= seqLen) break
    sites.push({
      enzymeName: enzyme.name,
      enzymeIdx,
      position: pos,
      end: (pos + recLen) % (topology === 'circular' ? seqLen : seqLen + recLen),
      fwdCut: pos + enzyme.fwd_cut,
      revCut: pos + enzyme.rev_cut,
      strand: 1,
    })
    pattern.lastIndex = m.index + 1
  }

  if (!isPalindrome) {
    const revPattern = new RegExp(recognitionToRegex(rc), 'gi')
    revPattern.lastIndex = 0
    while ((m = revPattern.exec(searchSeq)) !== null) {
      const pos = m.index
      if (pos >= seqLen) break
      sites.push({
        enzymeName: enzyme.name,
        enzymeIdx,
        position: pos,
        end: (pos + recLen) % (topology === 'circular' ? seqLen : seqLen + recLen),
        fwdCut: pos + (recLen - enzyme.rev_cut),
        revCut: pos + (recLen - enzyme.fwd_cut),
        strand: -1,
      })
      revPattern.lastIndex = m.index + 1
    }
  }

  // Deduplicate by position
  sites.sort((a, b) => a.position - b.position)
  const deduped: SerializedCutSite[] = []
  for (const site of sites) {
    if (deduped.length === 0 || deduped[deduped.length - 1].position !== site.position) {
      deduped.push(site)
    }
  }
  return deduped
}

self.onmessage = (e: MessageEvent<EnzymeFinderRequest>) => {
  const { bases, enzymes, topology } = e.data
  const upper = bases.toUpperCase()
  const seqLen = upper.length
  const allSites: SerializedCutSite[] = []

  for (let i = 0; i < enzymes.length; i++) {
    const sites = findSitesForEnzyme(upper, seqLen, enzymes[i], i, topology)
    allSites.push(...sites)
  }

  allSites.sort((a, b) => a.position - b.position)
  const response: EnzymeFinderResponse = { sites: allSites }
  self.postMessage(response)
}
