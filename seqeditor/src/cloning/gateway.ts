/**
 * Gateway Cloning simulation.
 *
 * Supports three reaction types:
 * - BP reaction: attB × attP → entry clone (attL) + byproduct (attR)
 * - LR reaction: attL × attR → expression clone (attB) + byproduct (attP)
 * - MultiSite: 2–3 entry clones (attL) × destination vector (attR) → multi-fragment clone
 *
 * att sites are detected by pattern matching against consensus sequences.
 */

import type { AnnotationData } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import type { CloningProduct } from './types'
import {
  ATT_SITES,
  findAttSites,
  type AttSiteMatch,
} from './gateway-sites'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GatewayReaction = 'BP' | 'LR' | 'MultiSite'

export interface GatewayInput {
  reaction: GatewayReaction
  /** Source sequences. For BP: [attB-insert, attP-donor]. For LR: [attL-entry, attR-dest]. For MultiSite: [attL-entry1, ..., attR-dest]. */
  sources: { doc: DocumentState }[]
}

export interface GatewayResult {
  products: CloningProduct[]
  warnings: string[]
  /** Detected att sites per source (for UI display). */
  detectedSites: { sourceName: string; sites: AttSiteMatch[] }[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bp: number): string {
  if (bp >= 1000) return `${(bp / 1000).toFixed(1)} kb`
  return `${bp} bp`
}

/**
 * Transfer annotations from a source document region [start, end) to a
 * product at the given offset. Annotations partially overlapping the region
 * are truncated and marked.
 */
function transferAnnotations(
  doc: DocumentState,
  start: number,
  end: number,
  outputOffset: number,
): AnnotationData[] {
  const result: AnnotationData[] = []

  for (const ann of doc.annotations) {
    const data = ann.toData()
    if (data.start > data.end) continue // skip origin-spanning

    if (data.end > start && data.start < end) {
      const clampStart = Math.max(data.start, start)
      const clampEnd = Math.min(data.end, end)
      const truncated = clampStart !== data.start || clampEnd !== data.end
      if (clampEnd > clampStart) {
        result.push({
          ...data,
          id: `${data.id}_gw_${outputOffset}`,
          start: clampStart - start + outputOffset,
          end: clampEnd - start + outputOffset,
          ...(truncated ? { truncated: true } : {}),
        })
      }
    }
  }

  return result
}

/**
 * Look up the core sequence for a product att site by name (e.g., 'attL1').
 * Falls back to the input sequence if not found in the database.
 */
function productAttCore(name: string, fallback: string): string {
  const site = ATT_SITES.find(s => s.name === name)
  return site ? site.core : fallback
}

/**
 * Create an annotation for an att site on the product.
 */
function attSiteAnnotation(
  siteName: string,
  start: number,
  end: number,
): AnnotationData {
  return {
    id: `att_${siteName}_${start}`,
    name: siteName,
    type: 'att_site',
    start,
    end,
    strand: 1,
    color: '#7c3aed',
  }
}

/**
 * Extract a region from a circular or linear sequence.
 * For circular sequences, handles wrapping around the origin.
 */


// ---------------------------------------------------------------------------
// BP Reaction: attB × attP → attL (entry clone) + attR (byproduct)
// ---------------------------------------------------------------------------

function runBP(sources: { doc: DocumentState }[]): GatewayResult {
  const warnings: string[] = []
  const detectedSites: GatewayResult['detectedSites'] = []

  if (sources.length < 2) {
    return {
      products: [],
      warnings: ['BP reaction requires 2 sources: an attB-flanked insert and an attP donor vector'],
      detectedSites: [],
    }
  }

  // Scan all sources for attB and attP sites
  const allAttB: { srcIdx: number; match: AttSiteMatch; doc: DocumentState }[] = []
  const allAttP: { srcIdx: number; match: AttSiteMatch; doc: DocumentState }[] = []

  for (let i = 0; i < sources.length; i++) {
    const doc = sources[i].doc
    const bases = doc.sequence.bases

    const attBMatches = findAttSites(bases, ['attB'])
    const attPMatches = findAttSites(bases, ['attP'])

    detectedSites.push({
      sourceName: doc.name,
      sites: [...attBMatches, ...attPMatches],
    })

    for (const m of attBMatches) allAttB.push({ srcIdx: i, match: m, doc })
    for (const m of attPMatches) allAttP.push({ srcIdx: i, match: m, doc })
  }

  if (allAttB.length < 2) {
    warnings.push(`Found ${allAttB.length} attB site(s) – need 2 (attB1 + attB2) flanking the insert`)
    return { products: [], warnings, detectedSites }
  }

  if (allAttP.length < 2) {
    warnings.push(`Found ${allAttP.length} attP site(s) – need 2 (attP1 + attP2) on the donor vector`)
    return { products: [], warnings, detectedSites }
  }

  // Find paired attB1/attB2 on the insert source
  const attB1 = allAttB.find(a => a.match.site.number === 1)
  const attB2 = allAttB.find(a => a.match.site.number === 2)
  if (!attB1 || !attB2) {
    warnings.push('Could not find matched attB1/attB2 pair on the insert')
    return { products: [], warnings, detectedSites }
  }

  // Find paired attP1/attP2 on the donor vector
  const attP1 = allAttP.find(a => a.match.site.number === 1)
  const attP2 = allAttP.find(a => a.match.site.number === 2)
  if (!attP1 || !attP2) {
    warnings.push('Could not find matched attP1/attP2 pair on the donor vector')
    return { products: [], warnings, detectedSites }
  }

  // Validate pairing: attB and attP should be on different sources
  if (attB1.srcIdx === attP1.srcIdx) {
    warnings.push('attB and attP sites found on the same source – expected them on different sequences')
  }

  // Build the entry clone: vector backbone (outside attP sites) + insert (between attB sites)
  // The recombination swaps the segments between the att sites
  const insertDoc = attB1.doc
  const vectorDoc = attP1.doc
  const insertBases = insertDoc.sequence.bases
  const vectorBases = vectorDoc.sequence.bases
  const vectorCircular = vectorDoc.sequence.topology === 'circular'

  // Insert region: between attB1 end and attB2 start
  const b1 = attB1.match
  const b2 = attB2.match
  const insertStart = Math.min(b1.end, b2.end)
  const insertEnd = Math.max(b1.start, b2.start)
  const insertSeq = insertBases.slice(insertStart, insertEnd)

  // Vector backbone: outside attP sites
  const p1 = attP1.match
  const p2 = attP2.match
  const pLeft = Math.min(p1.start, p2.start)
  const pRight = Math.max(p1.end, p2.end)

  // Product att site cores (attL = recombination product of attB × attP)
  const attL1Core = productAttCore('attL1', insertBases.slice(b1.start, b1.end))
  const attL2Core = productAttCore('attL2', insertBases.slice(b2.start, b2.end))

  // Entry clone: left-backbone + attL1 + insert + attL2 + right-backbone
  // Splitting the backbone preserves the vector origin at position 0
  const leftBb = vectorBases.slice(0, pLeft)
  const rightBb = vectorBases.slice(pRight)
  const entrySeq = vectorCircular
    ? leftBb + attL1Core + insertSeq + attL2Core + rightBb
    : leftBb + attL1Core + insertSeq + attL2Core + rightBb
  const entryAnnotations: AnnotationData[] = []

  // Transfer left-backbone annotations (0..pLeft at offset 0)
  entryAnnotations.push(...transferAnnotations(vectorDoc, 0, pLeft, 0))

  // att site + insert region offset
  const attInsertOffset = leftBb.length
  entryAnnotations.push(attSiteAnnotation('attL1', attInsertOffset, attInsertOffset + attL1Core.length))

  const insertOffset = attInsertOffset + attL1Core.length
  entryAnnotations.push(...transferAnnotations(insertDoc, insertStart, insertEnd, insertOffset))

  const attL2Start = insertOffset + insertSeq.length
  entryAnnotations.push(attSiteAnnotation('attL2', attL2Start, attL2Start + attL2Core.length))

  // Transfer right-backbone annotations (pRight..end at offset after attL2)
  const rightBbOffset = attL2Start + attL2Core.length
  entryAnnotations.push(...transferAnnotations(vectorDoc, pRight, vectorBases.length, rightBbOffset))

  const entryClone: CloningProduct = {
    name: `${vectorDoc.name}::${insertDoc.name}`,
    sequence: entrySeq,
    topology: 'circular',
    annotations: entryAnnotations,
    size: entrySeq.length,
    isExpected: true,
    description: `BP reaction: ${insertDoc.name} (attB) × ${vectorDoc.name} (attP)`,
  }

  // Byproduct: attR-flanked ccdB cassette (the segment between attP sites + attR sites)
  const byproductInsert = vectorBases.slice(pLeft, pRight)
  const byproductSeq = byproductInsert
  const byproduct: CloningProduct = {
    name: `Byproduct (${formatSize(byproductSeq.length)}, circular)`,
    sequence: byproductSeq,
    topology: 'circular',
    annotations: transferAnnotations(vectorDoc, pLeft, pRight, 0),
    size: byproductSeq.length,
    isExpected: false,
    description: `BP reaction byproduct (attR-flanked cassette)`,
  }

  return {
    products: [entryClone, byproduct],
    warnings,
    detectedSites,
  }
}

// ---------------------------------------------------------------------------
// LR Reaction: attL × attR → attB (expression clone) + attP (byproduct)
// ---------------------------------------------------------------------------

function runLR(sources: { doc: DocumentState }[]): GatewayResult {
  const warnings: string[] = []
  const detectedSites: GatewayResult['detectedSites'] = []

  if (sources.length < 2) {
    return {
      products: [],
      warnings: ['LR reaction requires 2 sources: an attL entry clone and an attR destination vector'],
      detectedSites: [],
    }
  }

  // Scan for attL and attR sites
  const allAttL: { srcIdx: number; match: AttSiteMatch; doc: DocumentState }[] = []
  const allAttR: { srcIdx: number; match: AttSiteMatch; doc: DocumentState }[] = []

  for (let i = 0; i < sources.length; i++) {
    const doc = sources[i].doc
    const bases = doc.sequence.bases

    const attLMatches = findAttSites(bases, ['attL'])
    const attRMatches = findAttSites(bases, ['attR'])

    detectedSites.push({
      sourceName: doc.name,
      sites: [...attLMatches, ...attRMatches],
    })

    for (const m of attLMatches) allAttL.push({ srcIdx: i, match: m, doc })
    for (const m of attRMatches) allAttR.push({ srcIdx: i, match: m, doc })
  }

  if (allAttL.length < 2) {
    warnings.push(`Found ${allAttL.length} attL site(s) – need 2 (attL1 + attL2) on the entry clone`)
    return { products: [], warnings, detectedSites }
  }

  if (allAttR.length < 2) {
    warnings.push(`Found ${allAttR.length} attR site(s) – need 2 (attR1 + attR2) on the destination vector`)
    return { products: [], warnings, detectedSites }
  }

  const attL1 = allAttL.find(a => a.match.site.number === 1)
  const attL2 = allAttL.find(a => a.match.site.number === 2)
  if (!attL1 || !attL2) {
    warnings.push('Could not find matched attL1/attL2 pair on the entry clone')
    return { products: [], warnings, detectedSites }
  }

  const attR1 = allAttR.find(a => a.match.site.number === 1)
  const attR2 = allAttR.find(a => a.match.site.number === 2)
  if (!attR1 || !attR2) {
    warnings.push('Could not find matched attR1/attR2 pair on the destination vector')
    return { products: [], warnings, detectedSites }
  }

  // Build expression clone: destination backbone + insert from entry clone
  const entryDoc = attL1.doc
  const destDoc = attR1.doc
  const entryBases = entryDoc.sequence.bases
  const destBases = destDoc.sequence.bases

  // Insert: between attL sites on entry clone
  const l1 = attL1.match
  const l2 = attL2.match
  const insertStart = Math.min(l1.end, l2.end)
  const insertEnd = Math.max(l1.start, l2.start)
  const insertSeq = entryBases.slice(insertStart, insertEnd)

  // Destination backbone: outside attR sites
  const r1 = attR1.match
  const r2 = attR2.match
  const rLeft = Math.min(r1.start, r2.start)
  const rRight = Math.max(r1.end, r2.end)

  // Product att sites (attB = recombination product of attL × attR)
  const attB1Core = productAttCore('attB1', entryBases.slice(l1.start, l1.end))
  const attB2Core = productAttCore('attB2', entryBases.slice(l2.start, l2.end))

  // Expression clone: leftBb + attB1 + insert + attB2 + rightBb
  // Splitting the backbone preserves the destination vector origin at position 0
  const leftBb = destBases.slice(0, rLeft)
  const rightBb = destBases.slice(rRight)
  const exprSeq = leftBb + attB1Core + insertSeq + attB2Core + rightBb
  const exprAnnotations: AnnotationData[] = []

  // Transfer left-backbone annotations (0..rLeft at offset 0)
  exprAnnotations.push(...transferAnnotations(destDoc, 0, rLeft, 0))

  // att site + insert region
  const attInsertOffset = leftBb.length
  exprAnnotations.push(attSiteAnnotation('attB1', attInsertOffset, attInsertOffset + attB1Core.length))

  const insertOffset = attInsertOffset + attB1Core.length
  exprAnnotations.push(...transferAnnotations(entryDoc, insertStart, insertEnd, insertOffset))

  const attB2Start = insertOffset + insertSeq.length
  exprAnnotations.push(attSiteAnnotation('attB2', attB2Start, attB2Start + attB2Core.length))

  // Transfer right-backbone annotations (rRight..end)
  const rightBbOffset = attB2Start + attB2Core.length
  exprAnnotations.push(...transferAnnotations(destDoc, rRight, destBases.length, rightBbOffset))

  const exprClone: CloningProduct = {
    name: `${destDoc.name}::${entryDoc.name}`,
    sequence: exprSeq,
    topology: 'circular',
    annotations: exprAnnotations,
    size: exprSeq.length,
    isExpected: true,
    description: `LR reaction: ${entryDoc.name} (attL) × ${destDoc.name} (attR)`,
  }

  // Byproduct
  const byproductInsert = destBases.slice(rLeft, rRight)
  const byproduct: CloningProduct = {
    name: `Byproduct (${formatSize(byproductInsert.length)}, circular)`,
    sequence: byproductInsert,
    topology: 'circular',
    annotations: transferAnnotations(destDoc, rLeft, rRight, 0),
    size: byproductInsert.length,
    isExpected: false,
    description: `LR reaction byproduct (attP-flanked cassette)`,
  }

  return {
    products: [exprClone, byproduct],
    warnings,
    detectedSites,
  }
}

// ---------------------------------------------------------------------------
// MultiSite Gateway
// ---------------------------------------------------------------------------

function runMultiSite(sources: { doc: DocumentState }[]): GatewayResult {
  const warnings: string[] = []
  const detectedSites: GatewayResult['detectedSites'] = []

  if (sources.length < 3) {
    return {
      products: [],
      warnings: ['MultiSite Gateway requires at least 3 sources: 2+ entry clones (attL) and 1 destination vector (attR)'],
      detectedSites: [],
    }
  }

  // Scan all sources
  type SiteInfo = { srcIdx: number; match: AttSiteMatch; doc: DocumentState }
  const allAttL: SiteInfo[] = []
  const allAttR: SiteInfo[] = []

  for (let i = 0; i < sources.length; i++) {
    const doc = sources[i].doc
    const bases = doc.sequence.bases

    const attLMatches = findAttSites(bases, ['attL'])
    const attRMatches = findAttSites(bases, ['attR'])

    detectedSites.push({
      sourceName: doc.name,
      sites: [...attLMatches, ...attRMatches],
    })

    for (const m of attLMatches) allAttL.push({ srcIdx: i, match: m, doc })
    for (const m of attRMatches) allAttR.push({ srcIdx: i, match: m, doc })
  }

  // Need attR1 and attR2 on the destination vector
  const attR1 = allAttR.find(a => a.match.site.number === 1)
  const attR2 = allAttR.find(a => a.match.site.number === 2)
  if (!attR1 || !attR2) {
    warnings.push('Could not find attR1/attR2 pair on the destination vector')
    return { products: [], warnings, detectedSites }
  }

  // Group attL sites by source to identify entry clones
  const entryClones = new Map<number, SiteInfo[]>()
  for (const site of allAttL) {
    const list = entryClones.get(site.srcIdx) ?? []
    list.push(site)
    entryClones.set(site.srcIdx, list)
  }

  // Each entry clone should have exactly 2 attL sites.
  // When multiple sites are detected (e.g., attL3 and attL4 overlap due to
  // sequence similarity), prefer exact matches and pick the two most
  // spatially separated sites with the fewest mismatches.
  const validEntries: { doc: DocumentState; left: AttSiteMatch; right: AttSiteMatch; leftNum: number; rightNum: number }[] = []
  for (const [, sites] of entryClones) {
    if (sites.length < 2) {
      warnings.push(`Source "${sites[0].doc.name}" has only ${sites.length} attL site – need 2`)
      continue
    }

    // Deduplicate overlapping sites: group by position (within 5bp), keep lowest mismatch
    const deduped: SiteInfo[] = []
    const sorted = [...sites].sort((a, b) => a.match.start - b.match.start || a.match.mismatches - b.match.mismatches)
    for (const s of sorted) {
      const dominated = deduped.some(
        d => Math.abs(d.match.start - s.match.start) < 5 && d.match.mismatches <= s.match.mismatches
      )
      if (!dominated) deduped.push(s)
    }

    if (deduped.length < 2) {
      warnings.push(`Source "${sites[0].doc.name}" has only ${deduped.length} distinct attL site – need 2`)
      continue
    }

    // Pick the leftmost and rightmost distinct sites
    const left = deduped[0]
    const right = deduped[deduped.length - 1]

    validEntries.push({
      doc: left.doc,
      left: left.match,
      right: right.match,
      leftNum: left.match.site.number,
      rightNum: right.match.site.number,
    })
  }

  if (validEntries.length < 2) {
    warnings.push(`Found ${validEntries.length} valid entry clone(s) – need at least 2 for MultiSite`)
    return { products: [], warnings, detectedSites }
  }

  // Sort entry clones to form a chain: attR1 → entry1(attL_a/attL_b) → entry2(attL_b/attL_c) → attR2
  // The chain is: attR1.number matches first entry's left attL number,
  // each entry's right attL number matches the next entry's left attL number,
  // and the last entry's right attL number matches attR2.number.
  validEntries.sort((a, b) => a.leftNum - b.leftNum)

  // Validate chain
  const chainValid = validEntries[0].leftNum === attR1.match.site.number
  const lastEntry = validEntries[validEntries.length - 1]
  const chainEndsValid = lastEntry.rightNum === attR2.match.site.number

  if (!chainValid) {
    warnings.push(`First entry clone's left attL site (attL${validEntries[0].leftNum}) doesn't match attR1`)
  }
  if (!chainEndsValid) {
    warnings.push(`Last entry clone's right attL site (attL${lastEntry.rightNum}) doesn't match attR2`)
  }

  // Check internal chain continuity
  for (let i = 0; i < validEntries.length - 1; i++) {
    if (validEntries[i].rightNum !== validEntries[i + 1].leftNum) {
      warnings.push(
        `Chain break: entry ${i + 1} ends with attL${validEntries[i].rightNum} but entry ${i + 2} starts with attL${validEntries[i + 1].leftNum}`
      )
    }
  }

  if (!chainValid || !chainEndsValid) {
    return { products: [], warnings, detectedSites }
  }

  // Build the multi-fragment product
  const destDoc = attR1.doc
  const destBases = destDoc.sequence.bases

  // Destination backbone: outside attR sites
  const r1 = attR1.match
  const r2 = attR2.match
  const rLeft = Math.min(r1.start, r2.start)
  const rRight = Math.max(r1.end, r2.end)

  // Assemble: leftBb + attB1 + insert1 + ... + attBn + rightBb
  // Splitting the backbone preserves the destination vector origin at position 0
  const leftBb = destBases.slice(0, rLeft)
  const rightBb = destBases.slice(rRight)

  let assembled = leftBb
  const allAnnotations: AnnotationData[] = []

  // Transfer left-backbone annotations (0..rLeft at offset 0)
  allAnnotations.push(...transferAnnotations(destDoc, 0, rLeft, 0))

  for (let i = 0; i < validEntries.length; i++) {
    const entry = validEntries[i]
    const entryBases = entry.doc.sequence.bases

    // att site at the left boundary (use product attB core sequence)
    const leftName = `attB${entry.leftNum}`
    const leftSiteSeq = productAttCore(leftName, entryBases.slice(entry.left.start, entry.left.end))
    const siteStart = assembled.length
    assembled += leftSiteSeq
    allAnnotations.push(attSiteAnnotation(leftName, siteStart, assembled.length))

    // Insert between att sites
    const insertStart = Math.min(entry.left.end, entry.right.end)
    const insertEnd = Math.max(entry.left.start, entry.right.start)
    const insertSeq = entryBases.slice(insertStart, insertEnd)
    const insertOffset = assembled.length
    assembled += insertSeq
    allAnnotations.push(...transferAnnotations(entry.doc, insertStart, insertEnd, insertOffset))

    // Last entry: add right att site
    if (i === validEntries.length - 1) {
      const rightName = `attB${entry.rightNum}`
      const rightSiteSeq = productAttCore(rightName, entryBases.slice(entry.right.start, entry.right.end))
      const rSiteStart = assembled.length
      assembled += rightSiteSeq
      allAnnotations.push(attSiteAnnotation(rightName, rSiteStart, assembled.length))
    }
  }

  // Append right-backbone and transfer its annotations
  const rightBbOffset = assembled.length
  assembled += rightBb
  allAnnotations.push(...transferAnnotations(destDoc, rRight, destBases.length, rightBbOffset))

  const product: CloningProduct = {
    name: `${destDoc.name}::${validEntries.map(e => e.doc.name).join('-')}`,
    sequence: assembled,
    topology: 'circular',
    annotations: allAnnotations,
    size: assembled.length,
    isExpected: true,
    description: `MultiSite Gateway: ${validEntries.map(e => e.doc.name).join(' + ')} into ${destDoc.name}`,
  }

  // Byproduct: segment between attR sites on destination
  const byproductSeq = destBases.slice(rLeft, rRight)
  const byproduct: CloningProduct = {
    name: `Byproduct (${formatSize(byproductSeq.length)}, circular)`,
    sequence: byproductSeq,
    topology: 'circular',
    annotations: transferAnnotations(destDoc, rLeft, rRight, 0),
    size: byproductSeq.length,
    isExpected: false,
    description: 'MultiSite Gateway byproduct',
  }

  return {
    products: [product, byproduct],
    warnings,
    detectedSites,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a Gateway cloning reaction.
 */
export function gatewayClone(input: GatewayInput): GatewayResult {
  switch (input.reaction) {
    case 'BP': return runBP(input.sources)
    case 'LR': return runLR(input.sources)
    case 'MultiSite': return runMultiSite(input.sources)
  }
}
