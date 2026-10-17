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
  SPACER_LENGTH,
  findAttSites,
  spacerOffsetOf,
  type AttSiteMatch,
} from './gateway-sites'
import {
  crossoverOf,
  facing,
  readBetween,
  readOutside,
  spacerAsRead,
} from './gateway-segments'

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
/**
 * The site a junction has become, as an annotation laid over the product.
 *
 * The bases are the parents' own: an attB site is one parent's arm, the
 * shared spacer, then the other parent's arm. So the annotation is placed
 * from the spacer, reaching back and forward by as much as that site's core
 * carries on either side of its own spacer. On a circular product a site
 * sitting across the origin ends below its start, which is how the rest of
 * the app writes that.
 */
function attSiteAroundSpacer(
  siteName: string,
  spacerStart: number,
  productLength: number,
): AnnotationData[] {
  const site = ATT_SITES.find(s => s.name === siteName)
  if (!site || productLength === 0) return []
  const before = spacerOffsetOf(site)
  const after = site.core.length - before - SPACER_LENGTH
  const wrap = (x: number) => ((x % productLength) + productLength) % productLength
  const start = wrap(spacerStart - before)
  const end = wrap(spacerStart + SPACER_LENGTH + after) || productLength
  return [attSiteAnnotation(siteName, start, end)]
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

  const b1 = attB1.match
  const b2 = attB2.match
  const p1 = attP1.match
  const p2 = attP2.match

  if (!facing(b1, b2)) {
    warnings.push(
      `The attB sites on ${insertDoc.name} point the same way, so the stretch between them would be inverted.`,
    )
  }
  if (!facing(p1, p2)) {
    warnings.push(`The attP sites on ${vectorDoc.name} point the same way.`)
  }

  // As in the LR reaction, each junction is built around the spacer the two
  // parents cross over in: the donor gives everything outside its attP pair
  // and the attB product everything between its pair.
  const b1x = crossoverOf(b1)
  const b2x = crossoverOf(b2)
  const p1x = crossoverOf(p1)
  const p2x = crossoverOf(p2)

  const cassette = readBetween(insertDoc, b1x, b2x)
  const backbone = readOutside(vectorDoc, p1x, p2x)
  const insertSeq = cassette.bases

  const entrySeq = backbone.bases + p1x.spacer + insertSeq + spacerAsRead(b2x, b1x)
  const entryAnnotations: AnnotationData[] = []

  entryAnnotations.push(
    ...backbone.annotations.map(ann => ({ ...ann, id: `${ann.id}_bb` })),
  )

  const insertOffset = backbone.bases.length + p1x.length
  entryAnnotations.push(
    ...cassette.annotations.map(ann => ({
      ...ann,
      id: `${ann.id}_gw`,
      start: ann.start + insertOffset,
      end: ann.end + insertOffset,
    })),
  )

  entryAnnotations.push(
    ...attSiteAroundSpacer('attL1', backbone.bases.length, entrySeq.length),
    ...attSiteAroundSpacer('attL2', insertOffset + insertSeq.length, entrySeq.length),
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
  const discarded = readBetween(vectorDoc, p1x, p2x)
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

  const l1 = attL1.match
  const l2 = attL2.match
  const r1 = attR1.match
  const r2 = attR2.match

  if (!facing(l1, l2)) {
    warnings.push(
      `The attL sites on ${entryDoc.name} point the same way, so the stretch between them would be ` +
      'inverted rather than swapped: the entry clone will not recombine as it stands.',
    )
  }
  if (!facing(r1, r2)) {
    warnings.push(
      `The attR sites on ${destDoc.name} point the same way, so the destination vector will not ` +
      'accept a cassette.',
    )
  }

  // Recombination crosses over inside each site's spacer, so the product is
  // built around those seven bases: the destination gives everything outside
  // its pair, the entry clone everything between its pair, and each junction
  // reads one parent's arm, the spacer, then the other parent's arm. That is
  // what makes the product's attB sites: they are not pasted in from a table.
  const l1x = crossoverOf(l1)
  const l2x = crossoverOf(l2)
  const r1x = crossoverOf(r1)
  const r2x = crossoverOf(r2)

  const cassette = readBetween(entryDoc, l1x, l2x)
  const backbone = readOutside(destDoc, r1x, r2x)
  const insertSeq = cassette.bases

  const exprSeq = backbone.bases + r1x.spacer + insertSeq + spacerAsRead(l2x, l1x)
  const exprAnnotations: AnnotationData[] = []

  exprAnnotations.push(
    ...backbone.annotations.map(ann => ({ ...ann, id: `${ann.id}_bb` })),
  )

  const insertOffset = backbone.bases.length + r1x.length
  exprAnnotations.push(
    ...cassette.annotations.map(ann => ({
      ...ann,
      id: `${ann.id}_gw`,
      start: ann.start + insertOffset,
      end: ann.end + insertOffset,
    })),
  )

  exprAnnotations.push(
    ...attSiteAroundSpacer('attB1', backbone.bases.length, exprSeq.length),
    ...attSiteAroundSpacer('attB2', insertOffset + insertSeq.length, exprSeq.length),
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
  const discarded = readBetween(destDoc, r1x, r2x)
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
  if (!facing(r1, r2)) {
    warnings.push(`The attR sites on ${destDoc.name} point the same way.`)
  }

  const r1x = crossoverOf(r1)
  const r2x = crossoverOf(r2)

  // The backbone, running from attR2 round to attR1, across the origin if
  // that is where it falls, and read on the bottom strand if the sites are.
  const backbone = readOutside(destDoc, r1x, r2x)

  // backbone, then each cassette in chain order, each junction built around
  // the spacer its two parents cross over in.
  let assembled = backbone.bases
  const allAnnotations: AnnotationData[] = [
    ...backbone.annotations.map(ann => ({ ...ann, id: `${ann.id}_bb` })),
  ]
  const junctions: { name: string; at: number }[] = []

  for (let i = 0; i < validEntries.length; i++) {
    const entry = validEntries[i]
    const leftx = crossoverOf(entry.left)
    const rightx = crossoverOf(entry.right)

    if (!facing(entry.left, entry.right)) {
      warnings.push(`The att sites on ${entry.doc.name} point the same way: its cassette is inverted.`)
    }

    // The spacer this junction crosses over in, read in the direction the
    // product is being written.
    junctions.push({ name: `attB${entry.leftNum}`, at: assembled.length })
    assembled += leftx.spacer

    const cassette = readBetween(entry.doc, leftx, rightx)
    const insertOffset = assembled.length
    assembled += cassette.bases
    allAnnotations.push(
      ...cassette.annotations.map(ann => ({
        ...ann,
        id: `${ann.id}_gw${i}`,
        start: ann.start + insertOffset,
        end: ann.end + insertOffset,
      })),
    )

    // The last entry clone's far site closes the circle against the backbone.
    if (i === validEntries.length - 1) {
      junctions.push({ name: `attB${entry.rightNum}`, at: assembled.length })
      assembled += spacerAsRead(rightx, leftx)
    }
  }

  // The att sites can only be placed once the whole product is known, since
  // one of them runs across its origin.
  for (const junction of junctions) {
    allAnnotations.push(...attSiteAroundSpacer(junction.name, junction.at, assembled.length))
  }

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
  const discarded = readBetween(destDoc, r1x, r2x)
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
  // Only reachable from untyped input; say so rather than return nothing.
  return { products: [], warnings: [`Unknown Gateway reaction: ${String(input.reaction)}`], detectedSites: [] }
}
