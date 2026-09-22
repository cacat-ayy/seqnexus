/**
 * TOPO Cloning simulation.
 *
 * Supports three variants:
 * - TOPO-TA: requires 3' A-overhangs on the PCR product (Taq polymerase)
 * - TOPO-Blunt: blunt-ended PCR products (proofreading polymerases)
 * - Directional TOPO: 5' CACC overhang enforces forward orientation
 *
 * The vector is scanned for the TOPO recognition motif (CCCTT) to identify
 * the cleavage/insertion site.
 */

import { reverseComplement } from '../models/complement'
import type { AnnotationData } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import type { CloningProduct } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TopoVariant = 'TA' | 'Blunt' | 'Directional'

export interface TopoInput {
  variant: TopoVariant
  /** The PCR product to insert. */
  insert: { doc: DocumentState }
  /** The TOPO vector. */
  vector: { doc: DocumentState }
}

export interface TopoResult {
  products: CloningProduct[]
  warnings: string[]
  /** Detected TOPO site position on the vector (for UI display). */
  topoSite: { start: number; end: number } | null
  /** Insert end validation result. */
  insertValidation: {
    valid: boolean
    message: string
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** TOPO recognition motif (vaccinia topoisomerase I). */
const TOPO_MOTIF = 'CCCTT'

/** Directional TOPO overhang on the vector (anneals to CACC on the insert). */
const DIRECTIONAL_VECTOR_OVERHANG = 'GTGG'

/** Required 5' overhang on the insert for Directional TOPO. */
const DIRECTIONAL_INSERT_OVERHANG = 'CACC'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Transfer annotations from a source document, adjusting coordinates
 * to the given output offset.
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
    if (data.start > data.end) continue

    if (data.end > start && data.start < end) {
      const clampStart = Math.max(data.start, start)
      const clampEnd = Math.min(data.end, end)
      const truncated = clampStart !== data.start || clampEnd !== data.end
      if (clampEnd > clampStart) {
        result.push({
          ...data,
          id: `${data.id}_topo_${outputOffset}`,
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
 * Find all occurrences of the TOPO motif (CCCTT) in a sequence.
 * Returns positions on the sense strand.
 */
function findTopoSites(bases: string): { start: number; end: number }[] {
  const sites: { start: number; end: number }[] = []
  const seq = bases.toUpperCase()

  let pos = 0
  while (pos <= seq.length - TOPO_MOTIF.length) {
    const idx = seq.indexOf(TOPO_MOTIF, pos)
    if (idx === -1) break
    sites.push({ start: idx, end: idx + TOPO_MOTIF.length })
    pos = idx + 1
  }

  return sites
}

/**
 * Validate insert ends for the given TOPO variant.
 */
function validateInsertEnds(
  insertBases: string,
  variant: TopoVariant,
): { valid: boolean; message: string } {
  const seq = insertBases.toUpperCase()

  switch (variant) {
    case 'TA': {
      // Check for 3' A-overhangs: last base should be A (added by Taq)
      const lastBase = seq[seq.length - 1]
      // For TA cloning, both 3' ends need A overhangs.
      // On the sense strand, the 3' end is the last base.
      // On the antisense strand, the 3' end corresponds to the complement of the first base.
      const hasThreePrimeA = lastBase === 'A'
      const hasThreePrimeARC = seq[0] === 'T' // complement of A on the other strand

      if (hasThreePrimeA && hasThreePrimeARC) {
        return { valid: true, message: "Insert has 3' A-overhangs (compatible with TOPO-TA)" }
      }
      // A-overhangs are added by Taq polymerase during PCR and are typically
      // not present in the designed sequence. Treat as informational.
      return { valid: true, message: "Note: TOPO-TA requires 3' A-overhangs added by Taq polymerase during PCR. The simulation assumes overhangs are present." }
    }

    case 'Blunt': {
      // Blunt ends: no overhangs expected. Warn if it looks like TA-compatible.
      const lastBase = seq[seq.length - 1]
      const firstBase = seq[0]
      if (lastBase === 'A' && firstBase === 'T') {
        return { valid: true, message: "Insert appears to have A-overhangs – consider TOPO-TA instead for higher efficiency" }
      }
      return { valid: true, message: 'Insert has blunt ends (compatible with TOPO-Blunt)' }
    }

    case 'Directional': {
      // Check for 5' CACC overhang on the forward strand
      const prefix = seq.slice(0, DIRECTIONAL_INSERT_OVERHANG.length)
      if (prefix === DIRECTIONAL_INSERT_OVERHANG) {
        return { valid: true, message: "Insert has 5' CACC overhang (compatible with Directional TOPO)" }
      }
      return { valid: false, message: `Insert lacks 5' CACC overhang – Directional TOPO requires CACC at the 5' end of the forward primer (found: ${prefix})` }
    }
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Build a TOPO cloning product by inserting the PCR product into the
 * vector at the TOPO site.
 */
function buildTopoProduct(
  insertDoc: DocumentState,
  vectorDoc: DocumentState,
  topoSite: { start: number; end: number },
  reverse: boolean,
  variant: TopoVariant,
): CloningProduct {
  const vectorBases = vectorDoc.sequence.bases
  const vectorCircular = vectorDoc.sequence.topology === 'circular'
  let insertBases = insertDoc.sequence.bases

  // For Directional TOPO, trim the CACC overhang from the insert
  // (it anneals to the vector's GTGG, not incorporated as extra bases)
  let insertStart = 0
  let insertEnd = insertBases.length
  if (variant === 'Directional' && !reverse) {
    insertStart = DIRECTIONAL_INSERT_OVERHANG.length
  }

  let insertSeq = insertBases.slice(insertStart, insertEnd)
  if (reverse) {
    insertSeq = reverseComplement(insertSeq)
  }

  // The TOPO site is where the vector is cut. The insert goes between
  // the cut position (end of CCCTT motif).
  const cutPos = topoSite.end

  let productSeq: string
  let vectorLeftEnd: number
  let vectorRightStart: number

  if (vectorCircular) {
    // For circular vector: linearize at the TOPO site, insert, re-circularize
    const vectorLeft = vectorBases.slice(0, cutPos)
    const vectorRight = vectorBases.slice(cutPos)
    productSeq = vectorLeft + insertSeq + vectorRight
    vectorLeftEnd = cutPos
    vectorRightStart = cutPos
  } else {
    const vectorLeft = vectorBases.slice(0, cutPos)
    const vectorRight = vectorBases.slice(cutPos)
    productSeq = vectorLeft + insertSeq + vectorRight
    vectorLeftEnd = cutPos
    vectorRightStart = cutPos
  }

  // Transfer annotations
  const annotations: AnnotationData[] = []

  // Vector annotations before the cut
  annotations.push(...transferAnnotations(vectorDoc, 0, vectorLeftEnd, 0))

  // Insert annotations
  const insertOffset = vectorLeftEnd
  if (reverse) {
    // For reverse orientation, annotations need to be mirrored
    const rcAnns = transferAnnotations(insertDoc, insertStart, insertEnd, 0)
    const insertLen = insertSeq.length
    for (const ann of rcAnns) {
      annotations.push({
        ...ann,
        id: `${ann.id}_rc`,
        start: insertOffset + insertLen - ann.end,
        end: insertOffset + insertLen - ann.start,
        strand: ann.strand === 1 ? -1 : ann.strand === -1 ? 1 : ann.strand,
      })
    }
  } else {
    annotations.push(...transferAnnotations(insertDoc, insertStart, insertEnd, insertOffset))
  }

  // Vector annotations after the cut
  const rightOffset = vectorLeftEnd + insertSeq.length
  annotations.push(...transferAnnotations(vectorDoc, vectorRightStart, vectorBases.length, rightOffset))

  // Add TOPO insertion site annotation
  annotations.push({
    id: `topo_site_${cutPos}`,
    name: 'TOPO insertion',
    type: 'misc_feature',
    start: vectorLeftEnd,
    end: vectorLeftEnd + insertSeq.length,
    strand: reverse ? -1 : 1,
    color: '#0ea5e9',
  })

  const orientation = reverse ? 'reverse' : 'forward'
  const topology = vectorCircular ? 'circular' : 'linear'

  return {
    name: `${vectorDoc.name}::${insertDoc.name}${reverse ? ' (rev)' : ''}`,
    sequence: productSeq,
    topology,
    annotations,
    size: productSeq.length,
    isExpected: variant === 'Directional' ? !reverse : false, // Directional: only forward is expected
    description: `TOPO-${variant}: ${insertDoc.name} into ${vectorDoc.name} (${orientation})`,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determine the TOPO cloning insertion site on the vector.
 *
 * Commercial TOPO vectors are supplied linearized with topoisomerase I
 * covalently bound to a single CCCTT site at the cloning position.
 * Other CCCTT occurrences in the backbone are incidental and inactive.
 *
 * Strategy:
 * 1. **Linear vector**: The vector is already cut at the cloning site.
 *    Insert at position 0 (the linearization point) regardless of
 *    internal CCCTT motifs.
 * 2. **Circular vector**: Scan for CCCTT sites. If only one exists,
 *    use it. If multiple exist, prefer one near an annotated MCS,
 *    lacZ, or cloning-related feature. Fall back to the first site.
 */
function findActiveSite(
  vectorBases: string,
  topology: 'linear' | 'circular',
  annotations: readonly { name: string; type: string; start: number; end: number }[],
  variant: TopoVariant,
): { site: { start: number; end: number } | null; info: string[] } {
  const info: string[] = []

  // Linear vector: the manufacturer linearized the plasmid at the TOPO
  // site, so the CCCTT motif should be at one of the ends.
  if (topology === 'linear') {
    const sites = findTopoSites(vectorBases)
    const len = vectorBases.length

    // Check for CCCTT near the start (within 30 bp)
    const nearStart = sites.find(s => s.end <= 30)
    // Check for CCCTT near the end (within 30 bp)
    const nearEnd = sites.find(s => s.start >= len - 30)

    if (nearStart) {
      info.push(`Linear vector detected – TOPO site (CCCTT) found near the 5' end at position ${nearStart.start}. Inserting at this site.`)
      return { site: nearStart, info }
    }
    if (nearEnd) {
      info.push(`Linear vector detected – TOPO site (CCCTT) found near the 3' end at position ${nearEnd.start}. Inserting at this site.`)
      return { site: nearEnd, info }
    }

    // No CCCTT near the ends – the vector may not be linearized at the
    // TOPO site, or it may not be a TOPO vector at all.
    if (sites.length > 0) {
      info.push(`Linear vector has no CCCTT near either end – it may not be linearized at the TOPO site. Found ${sites.length} internal CCCTT occurrence${sites.length > 1 ? 's' : ''}; inserting at the first one (position ${sites[0].start}). Commercial TOPO vectors are supplied pre-linearized at the activated site.`)
      return { site: sites[0], info }
    }

    info.push('No TOPO recognition site (CCCTT) found on the vector')
    return { site: null, info }
  }

  // Circular vector: scan for CCCTT sites
  const sites = findTopoSites(vectorBases)

  if (sites.length === 0) {
    info.push('No TOPO recognition site (CCCTT) found on the vector')
    return { site: null, info }
  }

  if (sites.length === 1) {
    return { site: sites[0], info }
  }

  // Multiple sites – try to identify the cloning site by proximity
  // to MCS/lacZ/cloning-related annotations
  const cloningKeywords = /mcs|multiple.cloning|cloning.site|lacz|lac.alpha|topo|insertion/i
  const cloningAnns = annotations.filter(a =>
    cloningKeywords.test(a.name) || cloningKeywords.test(a.type)
  )

  if (cloningAnns.length > 0) {
    // Find the CCCTT site closest to any cloning-related annotation
    let bestSite = sites[0]
    let bestDist = Infinity
    for (const site of sites) {
      for (const ann of cloningAnns) {
        const mid = (ann.start + ann.end) / 2
        const dist = Math.min(
          Math.abs(site.start - mid),
          Math.abs(site.end - mid),
        )
        if (dist < bestDist) {
          bestDist = dist
          bestSite = site
        }
      }
    }
    info.push(`Multiple CCCTT sites found (${sites.length}). Using the site at position ${bestSite.start} (nearest to cloning-related annotation). In a real TOPO reaction, only the manufacturer-activated site is used.`)
    return { site: bestSite, info }
  }

  // For Directional TOPO, prefer a site followed by GTGG
  if (variant === 'Directional') {
    const dirSite = sites.find(s => {
      const after = vectorBases.slice(s.end, s.end + DIRECTIONAL_VECTOR_OVERHANG.length).toUpperCase()
      return after === DIRECTIONAL_VECTOR_OVERHANG
    })
    if (dirSite) {
      info.push(`Multiple CCCTT sites found (${sites.length}). Using the site at position ${dirSite.start} (followed by GTGG directional overhang). In a real TOPO reaction, only the manufacturer-activated site is used.`)
      return { site: dirSite, info }
    }
  }

  // Fallback: use the first site
  info.push(`Multiple CCCTT sites found (${sites.length}) – using the first one at position ${sites[0].start}. In a real TOPO reaction, only the manufacturer-activated site is used; the other occurrences are incidental.`)
  return { site: sites[0], info }
}

/**
 * Simulate TOPO cloning.
 */
export function topoClone(input: TopoInput): TopoResult {
  const { variant, insert, vector } = input
  const warnings: string[] = []

  const vectorBases = vector.doc.sequence.bases
  const insertBases = insert.doc.sequence.bases
  const vectorTopology = vector.doc.sequence.topology

  // Find the active TOPO site
  const { site: topoSite, info: siteInfo } = findActiveSite(
    vectorBases, vectorTopology, vector.doc.annotations, variant,
  )
  warnings.push(...siteInfo)

  if (!topoSite) {
    return {
      products: [],
      warnings,
      topoSite: null,
      insertValidation: validateInsertEnds(insertBases, variant),
    }
  }

  // For Directional TOPO on circular vectors, verify the GTGG overhang
  if (variant === 'Directional' && vectorTopology === 'circular') {
    const afterSite = vectorBases.slice(topoSite.end, topoSite.end + DIRECTIONAL_VECTOR_OVERHANG.length).toUpperCase()
    if (afterSite !== DIRECTIONAL_VECTOR_OVERHANG) {
      warnings.push(`Directional TOPO vector lacks ${DIRECTIONAL_VECTOR_OVERHANG} overhang after TOPO site (found: ${afterSite || 'nothing'})`)
    }
  }

  // Validate insert ends
  const insertValidation = validateInsertEnds(insertBases, variant)
  if (!insertValidation.valid) {
    warnings.push(insertValidation.message)
  }

  // Build products
  const products: CloningProduct[] = []

  if (variant === 'Directional') {
    products.push(buildTopoProduct(insert.doc, vector.doc, topoSite, false, variant))
  } else {
    products.push(buildTopoProduct(insert.doc, vector.doc, topoSite, false, variant))
    products.push(buildTopoProduct(insert.doc, vector.doc, topoSite, true, variant))
  }

  return {
    products,
    warnings,
    topoSite,
    insertValidation,
  }
}
