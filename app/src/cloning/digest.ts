/**
 * Restriction digest and ligation simulation.
 *
 * digestFragments() cuts a sequence with one or more enzymes and returns
 * fragments with computed overhangs, transferred annotations, and methylation
 * warnings. Cut sites blocked by dam/dcm methylation are excluded.
 *
 * ligateFragments() enumerates all valid assemblies from a set of fragments
 * by matching compatible overhangs.
 */

import type { RestrictionEnzyme } from '../enzymes/db'
import { findCutSites, type CutSite } from '../enzymes/finder'
import { reverseComplement } from '../models/complement'
import type { AnnotationData } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import type { CloningFragment, CloningProduct, OverhangKind } from './types'
import { productName as smartProductName, productDescription } from './naming'

// ---------------------------------------------------------------------------
// Overhang helpers
// ---------------------------------------------------------------------------

export interface Overhang {
  sequence: string
  type: OverhangKind
}

/**
 * Extract the overhang at a cut site.
 * fwdCut < revCut → 5'-protruding overhang (top strand extends past bottom).
 * fwdCut > revCut → 3'-protruding overhang (bottom strand extends past top).
 * fwdCut === revCut → blunt.
 */
export function extractOverhang(bases: string, fwdCut: number, revCut: number): Overhang {
  if (fwdCut === revCut) {
    return { sequence: '', type: 'blunt' }
  }
  if (fwdCut < revCut) {
    return { sequence: bases.slice(fwdCut, revCut), type: 'five_prime' }
  }
  // 3' protruding
  return { sequence: reverseComplement(bases.slice(revCut, fwdCut)), type: 'three_prime' }
}

/**
 * Two overhangs are compatible for ligation when:
 * - Both blunt, OR
 * - Same protrusion type AND one's sequence is the reverse complement of the other.
 */
export function areOverhangsCompatible(a: Overhang, b: Overhang): boolean {
  if (a.type === 'blunt' && b.type === 'blunt') return true
  if (a.type === 'blunt' || b.type === 'blunt') return false
  if (a.type !== b.type) return false
  if (a.sequence.length !== b.sequence.length) return false
  return a.sequence.toUpperCase() === reverseComplement(b.sequence.toUpperCase())
}

// ---------------------------------------------------------------------------
// Annotation slicing
// ---------------------------------------------------------------------------

/**
 * Collect annotations that overlap with [fragStart, fragEnd) on a sequence,
 * adjusting coordinates to fragment-local. Annotations that partially overlap
 * a boundary are truncated (not dropped) and marked with `truncated: true`.
 *
 * For circular sequences where fragStart > fragEnd (wraps origin), handle
 * the two segments.
 */
function sliceAnnotations(
  annotations: AnnotationData[],
  fragStart: number,
  fragEnd: number,
  seqLen: number,
  circular: boolean,
): AnnotationData[] {
  const result: AnnotationData[] = []

  for (const ann of annotations) {
    // Skip origin-spanning annotations for simplicity
    if (ann.start > ann.end) continue

    if (circular && fragStart > fragEnd) {
      // Fragment wraps origin: [fragStart, seqLen) + [0, fragEnd)
      const tailLen = seqLen - fragStart

      // Check overlap with tail segment [fragStart, seqLen)
      if (ann.end > fragStart && ann.start < seqLen) {
        const clampStart = Math.max(ann.start, fragStart)
        const clampEnd = Math.min(ann.end, seqLen)
        const truncated = clampStart !== ann.start || clampEnd !== ann.end
        if (clampEnd > clampStart) {
          result.push({
            ...ann,
            start: clampStart - fragStart,
            end: clampEnd - fragStart,
            ...(truncated ? { truncated: true } : {}),
          })
        }
      }
      // Check overlap with head segment [0, fragEnd)
      else if (ann.end > 0 && ann.start < fragEnd) {
        const clampStart = Math.max(ann.start, 0)
        const clampEnd = Math.min(ann.end, fragEnd)
        const truncated = clampStart !== ann.start || clampEnd !== ann.end
        if (clampEnd > clampStart) {
          result.push({
            ...ann,
            start: clampStart + tailLen,
            end: clampEnd + tailLen,
            ...(truncated ? { truncated: true } : {}),
          })
        }
      }
    } else {
      // Normal linear fragment – check for any overlap with [fragStart, fragEnd)
      if (ann.end > fragStart && ann.start < fragEnd) {
        const clampStart = Math.max(ann.start, fragStart)
        const clampEnd = Math.min(ann.end, fragEnd)
        const truncated = clampStart !== ann.start || clampEnd !== ann.end
        if (clampEnd > clampStart) {
          result.push({
            ...ann,
            start: clampStart - fragStart,
            end: clampEnd - fragStart,
            ...(truncated ? { truncated: true } : {}),
          })
        }
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------

interface CutBoundary {
  /** Absolute position of the forward-strand cut. */
  fwdCut: number
  /** Absolute position of the reverse-strand cut. */
  revCut: number
}

/**
 * Digest a document with one or more enzymes.
 * Returns fragments with overhangs and transferred annotations.
 */
// Dam motif: GATC. Dcm motif: CCWGG (W = A or T).
const DAM_RE = /GATC/gi
const DCM_RE = /CC[AT]GG/gi

/**
 * Check if a cut site is blocked by dam or dcm methylation.
 * Looks for methylation motifs overlapping the recognition site region.
 */
function isMethylationBlocked(
  site: CutSite,
  bases: string,
  seqLen: number,
  enzyme: RestrictionEnzyme,
  dam: boolean,
  dcm: boolean,
): boolean {
  if (!dam && !dcm) return false

  // Extract the region around the recognition site (with flanking to catch overlapping motifs)
  const flank = 5
  const start = site.position - flank
  const end = site.end + flank
  let region: string
  if (start < 0 || end > seqLen) {
    // Handle wrapping for circular sequences
    let r = ''
    for (let i = start; i < end; i++) {
      r += bases[((i % seqLen) + seqLen) % seqLen]
    }
    region = r.toUpperCase()
  } else {
    region = bases.slice(start, end).toUpperCase()
  }

  if (dam && (enzyme.dam === 'blocked')) {
    DAM_RE.lastIndex = 0
    if (DAM_RE.test(region)) return true
  }
  if (dcm && (enzyme.dcm === 'blocked')) {
    DCM_RE.lastIndex = 0
    if (DCM_RE.test(region)) return true
  }
  return false
}

/**
 * Check if a cut site is impaired (but not fully blocked) by methylation.
 * Returns a warning string or null.
 */
function methylationWarning(
  site: CutSite,
  bases: string,
  seqLen: number,
  enzyme: RestrictionEnzyme,
  dam: boolean,
  dcm: boolean,
): string | null {
  if (!dam && !dcm) return null

  const flank = 5
  const start = site.position - flank
  const end = site.end + flank
  let region: string
  if (start < 0 || end > seqLen) {
    let r = ''
    for (let i = start; i < end; i++) {
      r += bases[((i % seqLen) + seqLen) % seqLen]
    }
    region = r.toUpperCase()
  } else {
    region = bases.slice(start, end).toUpperCase()
  }

  if (dam && enzyme.dam === 'impaired') {
    DAM_RE.lastIndex = 0
    if (DAM_RE.test(region)) {
      return `${enzyme.name} site at position ${site.position + 1} may be impaired by dam methylation`
    }
  }
  if (dcm && enzyme.dcm === 'impaired') {
    DCM_RE.lastIndex = 0
    if (DCM_RE.test(region)) {
      return `${enzyme.name} site at position ${site.position + 1} may be impaired by dcm methylation`
    }
  }
  return null
}

export interface DigestResult {
  fragments: CloningFragment[]
  warnings: string[]
}

export function digestFragments(
  doc: DocumentState,
  enzymes: RestrictionEnzyme[],
): DigestResult {
  const bases = doc.sequence.bases
  const seqLen = bases.length
  const topology = doc.sequence.topology
  const circular = topology === 'circular'
  const annData = doc.annotations.map(a => a.toData())
  const warnings: string[] = []

  // Collect all cut sites from all enzymes, filtering by methylation
  const dam = doc.metadata?.damMethylated ?? false
  const dcm = doc.metadata?.dcmMethylated ?? false
  const allSites: CutSite[] = []
  let blockedCount = 0
  for (const enzyme of enzymes) {
    const sites = findCutSites(bases, enzyme, topology)
    for (const site of sites) {
      if (isMethylationBlocked(site, bases, seqLen, enzyme, dam, dcm)) {
        blockedCount++
        continue
      }
      // Check for impaired (but not blocked) sites
      const warn = methylationWarning(site, bases, seqLen, enzyme, dam, dcm)
      if (warn) warnings.push(warn)
      allSites.push(site)
    }
  }
  if (blockedCount > 0) {
    warnings.push(`${blockedCount} cut site${blockedCount > 1 ? 's' : ''} blocked by methylation`)
  }

  if (allSites.length === 0) {
    // No cuts - return the whole sequence as a single fragment
    return {
      fragments: [{
        name: `${doc.name} (uncut)`,
        sequence: bases,
        overhang5: '',
        overhang3: '',
        overhang5Type: 'blunt',
        overhang3Type: 'blunt',
        annotations: annData,
        sourceName: doc.name,
        reversed: false,
      }],
      warnings,
    }
  }

  // Sort by fwdCut position (the actual cut point on the sense strand)
  const boundaries: CutBoundary[] = allSites
    .map(s => ({ fwdCut: s.fwdCut, revCut: s.revCut }))
    .sort((a, b) => a.fwdCut - b.fwdCut)

  // Deduplicate boundaries at the same fwdCut position
  const deduped: CutBoundary[] = []
  for (const b of boundaries) {
    if (deduped.length === 0 || deduped[deduped.length - 1].fwdCut !== b.fwdCut) {
      deduped.push(b)
    }
  }

  const fragments: CloningFragment[] = []
  const n = deduped.length

  if (circular) {
    // Circular: n cuts produce n fragments
    for (let i = 0; i < n; i++) {
      const left = deduped[i]
      const right = deduped[(i + 1) % n]

      // Fragment body: from left fwdCut to right fwdCut
      // (the "top strand cut" defines where the fragment body starts/ends)
      const bodyStart = left.fwdCut % seqLen
      const bodyEnd = right.fwdCut % seqLen

      let body: string
      if (bodyStart < bodyEnd) {
        body = bases.slice(bodyStart, bodyEnd)
      } else {
        // Wraps origin
        body = bases.slice(bodyStart) + bases.slice(0, bodyEnd)
      }

      // Overhangs at left boundary (5' end of this fragment)
      const oh5 = extractOverhang(bases, left.fwdCut, left.revCut)
      // Overhangs at right boundary (3' end of this fragment)
      const oh3 = extractOverhang(bases, right.fwdCut, right.revCut)

      const fragAnns = sliceAnnotations(annData, bodyStart, bodyEnd, seqLen, true)
      const size = body.length

      fragments.push({
        name: `${doc.name} fragment ${i + 1} (${formatSize(size)})`,
        sequence: body,
        overhang5: oh5.sequence,
        overhang3: oh3.sequence,
        overhang5Type: oh5.type,
        overhang3Type: oh3.type,
        annotations: fragAnns,
        sourceName: doc.name,
        reversed: false,
      })
    }
  } else {
    // Linear: n cuts produce n+1 fragments
    // First fragment: [0, first cut)
    const firstCut = deduped[0]
    const firstBody = bases.slice(0, firstCut.fwdCut)
    const firstOh3 = extractOverhang(bases, firstCut.fwdCut, firstCut.revCut)
    // Emitted unconditionally, even when empty: a cut at position 0 yields a
    // zero-length first fragment, and n cuts must still produce n+1 fragments
    // so that fragment numbering lines up with the cut positions.
    {
      fragments.push({
        name: `${doc.name} fragment 1 (${formatSize(firstBody.length)})`,
        sequence: firstBody,
        overhang5: '',
        overhang3: firstOh3.sequence,
        overhang5Type: 'blunt',
        overhang3Type: firstOh3.type,
        annotations: sliceAnnotations(annData, 0, firstCut.fwdCut, seqLen, false),
        sourceName: doc.name,
        reversed: false,
      })
    }

    // Middle fragments: between adjacent cuts
    for (let i = 0; i < n - 1; i++) {
      const left = deduped[i]
      const right = deduped[i + 1]
      const body = bases.slice(left.fwdCut, right.fwdCut)
      const oh5 = extractOverhang(bases, left.fwdCut, left.revCut)
      const oh3 = extractOverhang(bases, right.fwdCut, right.revCut)

      fragments.push({
        name: `${doc.name} fragment ${i + 2} (${formatSize(body.length)})`,
        sequence: body,
        overhang5: oh5.sequence,
        overhang3: oh3.sequence,
        overhang5Type: oh5.type,
        overhang3Type: oh3.type,
        annotations: sliceAnnotations(annData, left.fwdCut, right.fwdCut, seqLen, false),
        sourceName: doc.name,
        reversed: false,
      })
    }

    // Last fragment: [last cut, end)
    const lastCut = deduped[n - 1]
    const lastBody = bases.slice(lastCut.fwdCut)
    const lastOh5 = extractOverhang(bases, lastCut.fwdCut, lastCut.revCut)
    fragments.push({
      name: `${doc.name} fragment ${n + 1} (${formatSize(lastBody.length)})`,
      sequence: lastBody,
      overhang5: lastOh5.sequence,
      overhang3: '',
      overhang5Type: lastOh5.type,
      overhang3Type: 'blunt',
      annotations: sliceAnnotations(annData, lastCut.fwdCut, seqLen, seqLen, false),
      sourceName: doc.name,
      reversed: false,
    })
  }

  return { fragments, warnings }
}

// ---------------------------------------------------------------------------
// Partial digest
// ---------------------------------------------------------------------------

const MAX_PARTIAL_SITES = 8 // 2^8 = 256 combinations

/**
 * Simulate a partial digest where each cut site may or may not be cut.
 *
 * Returns deduplicated fragment sets – each set represents one possible
 * digest outcome. The full digest and uncut outcomes are included.
 * Limited to sequences with ≤ MAX_PARTIAL_SITES cut sites.
 */
export interface PartialDigestResult {
  fragmentSets: CloningFragment[][]
  warnings: string[]
}

export function partialDigestFragments(
  doc: DocumentState,
  enzymes: RestrictionEnzyme[],
): PartialDigestResult {
  const bases = doc.sequence.bases
  const topology = doc.sequence.topology

  // Collect all cut sites
  const allSites: CutSite[] = []
  for (const enzyme of enzymes) {
    allSites.push(...findCutSites(bases, enzyme, topology))
  }

  if (allSites.length === 0) {
    const r = digestFragments(doc, enzymes)
    return { fragmentSets: [r.fragments], warnings: r.warnings }
  }

  if (allSites.length > MAX_PARTIAL_SITES) {
    // Too many sites – fall back to complete digest only
    const r = digestFragments(doc, enzymes)
    return { fragmentSets: [r.fragments], warnings: r.warnings }
  }

  // Get methylation warnings from a full digest (they apply to all combinations)
  const fullDigest = digestFragments(doc, enzymes)
  const warnings = fullDigest.warnings

  // Sort sites by fwdCut position and deduplicate
  const sorted = [...allSites].sort((a, b) => a.fwdCut - b.fwdCut)
  const sites: CutSite[] = []
  for (const s of sorted) {
    if (sites.length === 0 || sites[sites.length - 1].fwdCut !== s.fwdCut) {
      sites.push(s)
    }
  }

  const n = sites.length
  const totalCombinations = 1 << n
  const results: CloningFragment[][] = []
  const seenKeys = new Set<string>()

  for (let mask = 0; mask < totalCombinations; mask++) {
    const activeSites = sites.filter((_, i) => (mask >> i) & 1)

    // Generate a key for deduplication (sorted fwdCut positions)
    const key = activeSites.map(s => s.fwdCut).join(',')
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    if (activeSites.length === 0) {
      // No cuts – return uncut fragment
      const r = digestFragments(doc, [])
      results.push(r.fragments)
      continue
    }

    // Build fragments from active sites using the same logic as digestFragments
    const frags = buildFragmentsFromSites(doc, activeSites)
    results.push(frags)
  }

  return { fragmentSets: results, warnings }
}

/**
 * Build fragments from a specific set of pre-computed cut sites.
 * Reuses the same logic as digestFragments but with explicit sites.
 */
function buildFragmentsFromSites(
  doc: DocumentState,
  sites: CutSite[],
): CloningFragment[] {
  const bases = doc.sequence.bases
  const seqLen = bases.length
  const circular = doc.sequence.topology === 'circular'
  const annData = doc.annotations.map(a => a.toData())

  const boundaries: CutBoundary[] = sites
    .map(s => ({ fwdCut: s.fwdCut, revCut: s.revCut }))
    .sort((a, b) => a.fwdCut - b.fwdCut)

  const fragments: CloningFragment[] = []
  const n = boundaries.length

  if (circular) {
    for (let i = 0; i < n; i++) {
      const left = boundaries[i]
      const right = boundaries[(i + 1) % n]
      const bodyStart = left.fwdCut % seqLen
      const bodyEnd = right.fwdCut % seqLen

      let body: string
      if (bodyStart < bodyEnd) {
        body = bases.slice(bodyStart, bodyEnd)
      } else {
        body = bases.slice(bodyStart) + bases.slice(0, bodyEnd)
      }

      const oh5 = extractOverhang(bases, left.fwdCut, left.revCut)
      const oh3 = extractOverhang(bases, right.fwdCut, right.revCut)
      const fragAnns = sliceAnnotations(annData, bodyStart, bodyEnd, seqLen, true)

      fragments.push({
        name: `${doc.name} fragment ${i + 1} (${formatSize(body.length)})`,
        sequence: body,
        overhang5: oh5.sequence,
        overhang3: oh3.sequence,
        overhang5Type: oh5.type,
        overhang3Type: oh3.type,
        annotations: fragAnns,
        sourceName: doc.name,
        reversed: false,
      })
    }
  } else {
    // First fragment
    const firstCut = boundaries[0]
    const firstBody = bases.slice(0, firstCut.fwdCut)
    const firstOh3 = extractOverhang(bases, firstCut.fwdCut, firstCut.revCut)
    fragments.push({
      name: `${doc.name} fragment 1 (${formatSize(firstBody.length)})`,
      sequence: firstBody,
      overhang5: '',
      overhang3: firstOh3.sequence,
      overhang5Type: 'blunt',
      overhang3Type: firstOh3.type,
      annotations: sliceAnnotations(annData, 0, firstCut.fwdCut, seqLen, false),
      sourceName: doc.name,
      reversed: false,
    })

    // Middle fragments
    for (let i = 0; i < n - 1; i++) {
      const left = boundaries[i]
      const right = boundaries[i + 1]
      const body = bases.slice(left.fwdCut, right.fwdCut)
      const oh5 = extractOverhang(bases, left.fwdCut, left.revCut)
      const oh3 = extractOverhang(bases, right.fwdCut, right.revCut)

      fragments.push({
        name: `${doc.name} fragment ${i + 2} (${formatSize(body.length)})`,
        sequence: body,
        overhang5: oh5.sequence,
        overhang3: oh3.sequence,
        overhang5Type: oh5.type,
        overhang3Type: oh3.type,
        annotations: sliceAnnotations(annData, left.fwdCut, right.fwdCut, seqLen, false),
        sourceName: doc.name,
        reversed: false,
      })
    }

    // Last fragment
    const lastCut = boundaries[n - 1]
    const lastBody = bases.slice(lastCut.fwdCut)
    const lastOh5 = extractOverhang(bases, lastCut.fwdCut, lastCut.revCut)
    fragments.push({
      name: `${doc.name} fragment ${n + 1} (${formatSize(lastBody.length)})`,
      sequence: lastBody,
      overhang5: lastOh5.sequence,
      overhang3: '',
      overhang5Type: lastOh5.type,
      overhang3Type: 'blunt',
      annotations: sliceAnnotations(annData, lastCut.fwdCut, seqLen, seqLen, false),
      sourceName: doc.name,
      reversed: false,
    })
  }

  return fragments
}

// ---------------------------------------------------------------------------
// Ligation
// ---------------------------------------------------------------------------

const MAX_PRODUCTS = 50

export interface LigationOptions {
  allowSelfLigation?: boolean
  /**
   * Indices of fragments that are dephosphorylated. A dephosphorylated
   * fragment cannot provide the 5'-phosphate needed for ligation, so its
   * 5' ends cannot serve as the acceptor in a ligation junction. In practice
   * this prevents vector self-ligation while still allowing insert ligation
   * into the vector.
   */
  dephosphorylatedFragments?: Set<number>
}

/**
 * Enumerate all valid ligation products from a set of fragments.
 *
 * Builds a compatibility graph on fragment ends and uses DFS to find
 * all valid assemblies (circular when a chain closes, linear otherwise).
 */
export function ligateFragments(
  fragments: CloningFragment[],
  options: LigationOptions = {},
): CloningProduct[] {
  const { allowSelfLigation = true, dephosphorylatedFragments } = options
  if (fragments.length === 0) return []

  const products: CloningProduct[] = []

  // Build adjacency: for each fragment's 3' end, which fragments' 5' ends are compatible?
  const compatMap = new Map<number, number[]>()

  for (let i = 0; i < fragments.length; i++) {
    const oh3: Overhang = { sequence: fragments[i].overhang3, type: fragments[i].overhang3Type }
    const compatible: number[] = []
    for (let j = 0; j < fragments.length; j++) {
      if (i === j && !allowSelfLigation) continue
      // Dephosphorylation: if fragment j is dephosphorylated, its 5' end
      // lacks a phosphate group. Ligation requires a 5'-phosphate on one
      // side and a 3'-OH on the other. When both sides meeting at a junction
      // are from dephosphorylated fragments, no ligation occurs. When only
      // one side is dephosphorylated, ligation can still occur (the other
      // fragment provides the phosphate). However, the standard simplification
      // is: dephosphorylated vector cannot self-circularize, meaning we block
      // junctions where BOTH fragments are dephosphorylated.
      if (dephosphorylatedFragments &&
          dephosphorylatedFragments.has(i) &&
          dephosphorylatedFragments.has(j)) {
        continue
      }
      const oh5: Overhang = { sequence: fragments[j].overhang5, type: fragments[j].overhang5Type }
      if (areOverhangsCompatible(oh3, oh5)) {
        compatible.push(j)
      }
    }
    compatMap.set(i, compatible)
  }

  // DFS to enumerate assemblies
  // A path is a sequence of fragment indices. A circular product forms when
  // the last fragment's 3' end is compatible with the first fragment's 5' end.
  const used = new Set<number>()

  function dfs(path: number[]) {
    if (products.length >= MAX_PRODUCTS) return

    const lastIdx = path[path.length - 1]
    const firstIdx = path[0]

    // Check if we can close the circle
    if (path.length >= 1) {
      const oh3Last: Overhang = { sequence: fragments[lastIdx].overhang3, type: fragments[lastIdx].overhang3Type }
      const oh5First: Overhang = { sequence: fragments[firstIdx].overhang5, type: fragments[firstIdx].overhang5Type }
      if (areOverhangsCompatible(oh3Last, oh5First)) {
        // Circular product
        products.push(buildProduct(path, fragments, true))
      }
    }

    // Try extending the path
    const nexts = compatMap.get(lastIdx) ?? []
    for (const next of nexts) {
      if (used.has(next)) continue
      if (products.length >= MAX_PRODUCTS) return
      used.add(next)
      path.push(next)
      dfs(path)
      path.pop()
      used.delete(next)
    }

    // If no extension possible and path length > 0, emit as linear product
    // (only if we haven't already emitted a circular product with this exact path)
    if (nexts.every(n => used.has(n)) || nexts.length === 0) {
      if (path.length >= 2) {
        products.push(buildProduct(path, fragments, false))
      }
    }
  }

  // Start DFS from each fragment
  for (let i = 0; i < fragments.length; i++) {
    if (products.length >= MAX_PRODUCTS) break
    used.clear()
    used.add(i)
    dfs([i])
  }

  // Deduplicate circular products (rotational equivalents)
  const deduped = deduplicateCircular(products)

  // Mark expected products: circular assemblies using all fragments exactly once
  for (const p of deduped) {
    if (p.topology === 'circular') {
      // Count unique source fragments - if it uses all input fragments, it's expected
      const desc = p.description
      const fragCount = (desc.match(/fragment/g) || []).length
      if (fragCount === fragments.length) {
        p.isExpected = true
      }
    }
  }

  // Sort: expected first, then by size descending
  deduped.sort((a, b) => {
    if (a.isExpected !== b.isExpected) return a.isExpected ? -1 : 1
    return b.size - a.size
  })

  return deduped
}

function buildProduct(
  path: number[],
  fragments: CloningFragment[],
  circular: boolean,
): CloningProduct {
  let sequence = ''
  const allAnnotations: AnnotationData[] = []
  const names: string[] = []

  for (const idx of path) {
    const frag = fragments[idx]
    const offset = sequence.length
    sequence += frag.sequence
    names.push(frag.name)

    // Transfer annotations with offset
    for (const ann of frag.annotations) {
      allAnnotations.push({
        ...ann,
        id: `${ann.id}_clone_${idx}`,
        start: ann.start + offset,
        end: ann.end + offset,
      })
    }
  }

  const topology = circular ? 'circular' as const : 'linear' as const
  const fragsInPath = path.map(i => fragments[i])

  return {
    name: smartProductName(fragsInPath),
    sequence,
    topology,
    annotations: allAnnotations,
    size: sequence.length,
    isExpected: false,
    description: productDescription(`${circular ? 'Circular' : 'Linear'} ligation`, fragsInPath),
  }
}

/**
 * Remove rotationally equivalent circular products.
 * Two circular products are equivalent if one is a rotation of the other.
 */
function deduplicateCircular(products: CloningProduct[]): CloningProduct[] {
  const seen = new Set<string>()
  const result: CloningProduct[] = []

  for (const p of products) {
    if (p.topology === 'linear') {
      result.push(p)
      continue
    }

    // Canonical form: smallest rotation of the sequence
    const canon = canonicalRotation(p.sequence)
    if (seen.has(canon)) continue
    seen.add(canon)
    result.push(p)
  }

  return result
}

/**
 * Find the lexicographically smallest rotation of a string.
 * Uses Booth's algorithm for O(n) complexity.
 */
function canonicalRotation(s: string): string {
  const n = s.length
  if (n === 0) return s
  const ss = s + s
  const f = new Array(2 * n).fill(-1)
  let k = 0
  for (let j = 1; j < 2 * n; j++) {
    let i = f[j - 1 - k]
    while (i !== -1 && ss[j] !== ss[k + i + 1]) {
      if (ss[j] < ss[k + i + 1]) k = j - i - 1
      i = f[i]
    }
    if (i === -1 && ss[j] !== ss[k + i + 1]) {
      if (ss[j] < ss[k + i + 1]) k = j
      f[j - k] = -1
    } else {
      f[j - k] = i + 1
    }
  }
  return ss.slice(k, k + n)
}

function formatSize(bp: number): string {
  if (bp >= 1000) return `${(bp / 1000).toFixed(1)} kb`
  return `${bp} bp`
}
