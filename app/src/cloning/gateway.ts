/**
 * Gateway Cloning simulation.
 *
 * Supports three reaction types:
 * - BP reaction: attB × attP → entry clone (attL) + byproduct (attR)
 * - LR reaction: attL × attR → expression clone (attB) + byproduct (attP)
 * - MultiSite: 2-3 entry clones (attL) × destination vector (attR) → multi-fragment clone
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
import { betweenSites, outsideSites, sitesAgree } from './gateway-segments'

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
    warnings.push(`Found ${allAttB.length} attB site(s): need 2 (attB1 + attB2) flanking the insert`)
    return { products: [], warnings, detectedSites }
  }

  if (allAttP.length < 2) {
    warnings.push(`Found ${allAttP.length} attP site(s): need 2 (attP1 + attP2) on the donor vector`)
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
    warnings.push('attB and attP sites found on the same source: expected them on different sequences')
  }

  // Build the entry clone: vector backbone (outside attP sites) + insert (between attB sites)
  // The recombination swaps the segments between the att sites
  const insertDoc = attB1.doc
  const vectorDoc = attP1.doc
  const insertBases = insertDoc.sequence.bases

  const b1 = attB1.match
  const b2 = attB2.match
  const p1 = attP1.match
  const p2 = attP2.match

  if (!sitesAgree(b1, b2)) {
    warnings.push(
      `The attB sites on ${insertDoc.name} face opposite ways, so the stretch between them is inverted.`,
    )
  }
  if (!sitesAgree(p1, p2)) {
    warnings.push(`The attP sites on ${vectorDoc.name} face opposite ways.`)
  }

  // The insert as it will read in the entry clone, and the donor backbone
  // running from attP2 round to attP1. Both cope with sites on the bottom
  // strand and with a stretch that crosses the origin.
  const cassette = betweenSites(insertDoc, b1, b2)
  const backbone = outsideSites(vectorDoc, p1, p2)
  const insertSeq = cassette.bases

  // attL is what attB × attP leaves behind; its sequence comes from the site
  // table, since the arms that cross over lie outside the cores stored here.
  const attL1Core = productAttCore('attL1', insertBases.slice(b1.start, b1.end))
  const attL2Core = productAttCore('attL2', insertBases.slice(b2.start, b2.end))

  const entrySeq = attL1Core + insertSeq + attL2Core + backbone.bases
  const entryAnnotations: AnnotationData[] = []

  entryAnnotations.push(attSiteAnnotation('attL1', 0, attL1Core.length))

  const insertOffset = attL1Core.length
  entryAnnotations.push(
    ...cassette.annotations.map(ann => ({
      ...ann,
      id: `${ann.id}_gw`,
      start: ann.start + insertOffset,
      end: ann.end + insertOffset,
    })),
  )

  const attL2Start = insertOffset + insertSeq.length
  entryAnnotations.push(attSiteAnnotation('attL2', attL2Start, attL2Start + attL2Core.length))

  const backboneOffset = attL2Start + attL2Core.length
  entryAnnotations.push(
    ...backbone.annotations.map(ann => ({
      ...ann,
      id: `${ann.id}_bb`,
      start: ann.start + backboneOffset,
      end: ann.end + backboneOffset,
    })),
  )

  const entryClone: CloningProduct = {
    name: `${vectorDoc.name}::${insertDoc.name}`,
    sequence: entrySeq,
    topology: 'circular',
    annotations: entryAnnotations,
    size: entrySeq.length,
    isExpected: true,
    description: `BP reaction: ${insertDoc.name} (attB) × ${vectorDoc.name} (attP)`,
  }

  // The byproduct carries off what the donor gave up: the attR-flanked ccdB
  // cassette, whose loss is what lets the entry clone grow.
  const discarded = betweenSites(vectorDoc, p1, p2)
  const byproduct: CloningProduct = {
    name: `Byproduct (${formatSize(discarded.bases.length)}, circular)`,
    sequence: discarded.bases,
    topology: 'circular',
    annotations: discarded.annotations,
    size: discarded.bases.length,
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
    warnings.push(`Found ${allAttL.length} attL site(s): need 2 (attL1 + attL2) on the entry clone`)
    return { products: [], warnings, detectedSites }
  }

  if (allAttR.length < 2) {
    warnings.push(`Found ${allAttR.length} attR site(s): need 2 (attR1 + attR2) on the destination vector`)
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

  const l1 = attL1.match
  const l2 = attL2.match
  const r1 = attR1.match
  const r2 = attR2.match

  if (!sitesAgree(l1, l2)) {
    warnings.push(
      `The attL sites on ${entryDoc.name} face opposite ways, so the cassette between them is inverted: ` +
      'the entry clone will not recombine as it stands.',
    )
  }
  if (!sitesAgree(r1, r2)) {
    warnings.push(
      `The attR sites on ${destDoc.name} face opposite ways: the destination vector will not accept a cassette.`,
    )
  }

  // The cassette as it will read in the product, and the backbone running
  // from attR2 round to attR1. Both handle sites on the bottom strand and a
  // stretch that crosses the origin of a circular source.
  const cassette = betweenSites(entryDoc, l1, l2)
  const backbone = outsideSites(destDoc, r1, r2)
  const insertSeq = cassette.bases

  // Product att sites. attB is what attL × attR leaves behind; its sequence
  // is taken from the site table rather than rebuilt from the two parents,
  // because the arms that actually cross over lie outside the cores stored
  // here. The flanks on either side are the real parents' sequence.
  const attB1Core = productAttCore('attB1', entryBases.slice(l1.start, l1.end))
  const attB2Core = productAttCore('attB2', entryBases.slice(l2.start, l2.end))

  const exprSeq = attB1Core + insertSeq + attB2Core + backbone.bases
  const exprAnnotations: AnnotationData[] = []

  exprAnnotations.push(attSiteAnnotation('attB1', 0, attB1Core.length))

  const insertOffset = attB1Core.length
  exprAnnotations.push(
    ...cassette.annotations.map(ann => ({
      ...ann,
      id: `${ann.id}_gw`,
      start: ann.start + insertOffset,
      end: ann.end + insertOffset,
    })),
  )

  const attB2Start = insertOffset + insertSeq.length
  exprAnnotations.push(attSiteAnnotation('attB2', attB2Start, attB2Start + attB2Core.length))

  const backboneOffset = attB2Start + attB2Core.length
  exprAnnotations.push(
    ...backbone.annotations.map(ann => ({
      ...ann,
      id: `${ann.id}_bb`,
      start: ann.start + backboneOffset,
      end: ann.end + backboneOffset,
    })),
  )

  const exprClone: CloningProduct = {
    name: `${destDoc.name}::${entryDoc.name}`,
    sequence: exprSeq,
    topology: 'circular',
    annotations: exprAnnotations,
    size: exprSeq.length,
    isExpected: true,
    description: `LR reaction: ${entryDoc.name} (attL) × ${destDoc.name} (attR)`,
  }

  // The byproduct carries off the cassette the destination vector gave up:
  // the ccdB counter-selection marker, which is why only the product grows.
  const discarded = betweenSites(destDoc, r1, r2)
  const byproduct: CloningProduct = {
    name: `Byproduct (${formatSize(discarded.bases.length)}, circular)`,
    sequence: discarded.bases,
    topology: 'circular',
    annotations: discarded.annotations,
    size: discarded.bases.length,
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
      warnings.push(`Source "${sites[0].doc.name}" has only ${sites.length} attL site: need 2`)
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
      warnings.push(`Source "${sites[0].doc.name}" has only ${deduped.length} distinct attL site: need 2`)
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
    warnings.push(`Found ${validEntries.length} valid entry clone(s): need at least 2 for MultiSite`)
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

  const r1 = attR1.match
  const r2 = attR2.match
  if (!sitesAgree(r1, r2)) {
    warnings.push(`The attR sites on ${destDoc.name} face opposite ways.`)
  }

  // The backbone, running from attR2 round to attR1, across the origin if
  // that is where it falls, and read on the bottom strand if the sites are.
  const backbone = outsideSites(destDoc, r1, r2)

  // attB1 + insert1 + ... + attBn + backbone
  let assembled = ''
  const allAnnotations: AnnotationData[] = []

  for (let i = 0; i < validEntries.length; i++) {
    const entry = validEntries[i]
    const entryBases = entry.doc.sequence.bases

    // att site at the left boundary (use product attB core sequence)
    const leftName = `attB${entry.leftNum}`
    const leftSiteSeq = productAttCore(leftName, entryBases.slice(entry.left.start, entry.left.end))
    const siteStart = assembled.length
    assembled += leftSiteSeq
    allAnnotations.push(attSiteAnnotation(leftName, siteStart, assembled.length))

    // The cassette, read in the direction its own att sites point.
    if (!sitesAgree(entry.left, entry.right)) {
      warnings.push(`The att sites on ${entry.doc.name} face opposite ways: its cassette is inverted.`)
    }
    const cassette = betweenSites(entry.doc, entry.left, entry.right)
    const insertSeq = cassette.bases
    const insertOffset = assembled.length
    assembled += insertSeq
    allAnnotations.push(
      ...cassette.annotations.map(ann => ({
        ...ann,
        id: `${ann.id}_gw${i}`,
        start: ann.start + insertOffset,
        end: ann.end + insertOffset,
      })),
    )

    // Last entry: add right att site
    if (i === validEntries.length - 1) {
      const rightName = `attB${entry.rightNum}`
      const rightSiteSeq = productAttCore(rightName, entryBases.slice(entry.right.start, entry.right.end))
      const rSiteStart = assembled.length
      assembled += rightSiteSeq
      allAnnotations.push(attSiteAnnotation(rightName, rSiteStart, assembled.length))
    }
  }

  const backboneOffset = assembled.length
  assembled += backbone.bases
  allAnnotations.push(
    ...backbone.annotations.map(ann => ({
      ...ann,
      id: `${ann.id}_bb`,
      start: ann.start + backboneOffset,
      end: ann.end + backboneOffset,
    })),
  )

  const product: CloningProduct = {
    name: `${destDoc.name}::${validEntries.map(e => e.doc.name).join('-')}`,
    sequence: assembled,
    topology: 'circular',
    annotations: allAnnotations,
    size: assembled.length,
    isExpected: true,
    description: `MultiSite Gateway: ${validEntries.map(e => e.doc.name).join(' + ')} into ${destDoc.name}`,
  }

  // The cassette the destination vector gave up.
  const discarded = betweenSites(destDoc, r1, r2)
  const byproduct: CloningProduct = {
    name: `Byproduct (${formatSize(discarded.bases.length)}, circular)`,
    sequence: discarded.bases,
    topology: 'circular',
    annotations: discarded.annotations,
    size: discarded.bases.length,
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
