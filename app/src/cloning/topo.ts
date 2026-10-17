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

/** Required 5' clamp on the insert for Directional TOPO. */
const DIRECTIONAL_INSERT_OVERHANG = 'CACC'

/**
 * How the insert's clamp can read on the vector beside the cut.
 *
 * The vector's four-base overhang and the insert's CACC are two strands of
 * the same four base pairs, not two stretches to be put end to end, so in
 * the product those bases appear once. Depending on which strand the vector
 * is stored on, they read either as the clamp itself or as its complement.
 */
const DIRECTIONAL_VECTOR_CLAMPS = [
  DIRECTIONAL_INSERT_OVERHANG,
  reverseComplement(DIRECTIONAL_INSERT_OVERHANG),
]

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
        return { valid: true, message: "Insert appears to have A-overhangs: consider TOPO-TA instead for higher efficiency" }
      }
      return { valid: true, message: 'Insert has blunt ends (compatible with TOPO-Blunt)' }
    }

    case 'Directional': {
      // Check for 5' CACC overhang on the forward strand
      const prefix = seq.slice(0, DIRECTIONAL_INSERT_OVERHANG.length)
      if (prefix === DIRECTIONAL_INSERT_OVERHANG) {
        return { valid: true, message: "Insert has 5' CACC overhang (compatible with Directional TOPO)" }
      }
      return { valid: false, message: `Insert lacks 5' CACC overhang: Directional TOPO requires CACC at the 5' end of the forward primer (found: ${prefix})` }
    }
  }
  // Only reachable from untyped input; say so rather than return nothing.
  return { valid: false, message: `Unknown TOPO variant: ${String(variant)}` }
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
  const insertBases = insertDoc.sequence.bases

  const insertStart = 0
  const insertEnd = insertBases.length

  let insertSeq = insertBases.slice(insertStart, insertEnd)
  if (reverse) {
    insertSeq = reverseComplement(insertSeq)
  }

  // The TOPO site is where the vector is cut. The insert goes in at the end
  // of the CCCTT motif.
  const cutPos = topoSite.end

  // Directional TOPO: the insert's CACC pairs with the vector's four-base
  // overhang, so those bases belong to both and must appear once. The clamp
  // is kept (it is part of the finished construct, and the translation
  // context downstream of it depends on being there), and the vector's
  // matching bases are consumed instead of being written out again.
  let clampConsumed = 0
  if (variant === 'Directional' && !reverse) {
    const beside = vectorBases.slice(cutPos, cutPos + DIRECTIONAL_INSERT_OVERHANG.length).toUpperCase()
    if (DIRECTIONAL_VECTOR_CLAMPS.includes(beside)) {
      clampConsumed = DIRECTIONAL_INSERT_OVERHANG.length
    }
  }

  // A circular vector is opened at the TOPO site, takes the insert, and
  // closes again; a linear one is already open there. Either way the insert
  // goes in at the cut, and the stored origin stays at position 1.
  const vectorLeftEnd = cutPos
  const vectorRightStart = cutPos + clampConsumed
  const productSeq = vectorBases.slice(0, vectorLeftEnd) + insertSeq + vectorBases.slice(vectorRightStart)

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
      info.push(`Linear vector detected: TOPO site (CCCTT) found near the 5' end at position ${nearStart.start}. Inserting at this site.`)
      return { site: nearStart, info }
    }
    if (nearEnd) {
      info.push(`Linear vector detected: TOPO site (CCCTT) found near the 3' end at position ${nearEnd.start}. Inserting at this site.`)
      return { site: nearEnd, info }
    }

    // No CCCTT near the ends: the vector may not be linearized at the
    // TOPO site, or it may not be a TOPO vector at all.
    if (sites.length > 0) {
      info.push(`Linear vector has no CCCTT near either end: it may not be linearized at the TOPO site. Found ${sites.length} internal CCCTT occurrence${sites.length > 1 ? 's' : ''}; inserting at the first one (position ${sites[0].start}). Commercial TOPO vectors are supplied pre-linearized at the activated site.`)
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

  // Multiple sites: try to identify the cloning site by proximity
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

  // For Directional TOPO, prefer a site whose next bases are the clamp the
  // insert's CACC pairs with, on whichever strand the vector is stored.
  if (variant === 'Directional') {
    const dirSite = sites.find(s => {
      const after = vectorBases.slice(s.end, s.end + DIRECTIONAL_INSERT_OVERHANG.length).toUpperCase()
      return DIRECTIONAL_VECTOR_CLAMPS.includes(after)
    })
    if (dirSite) {
      info.push(`Multiple CCCTT sites found (${sites.length}). Using the site at position ${dirSite.start} (followed by GTGG directional overhang). In a real TOPO reaction, only the manufacturer-activated site is used.`)
      return { site: dirSite, info }
    }
  }

  // Fallback: use the first site
  info.push(`Multiple CCCTT sites found (${sites.length}): using the first one at position ${sites[0].start}. In a real TOPO reaction, only the manufacturer-activated site is used; the other occurrences are incidental.`)
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

  // Directional TOPO: the bases beside the cut should be the ones the
  // insert's clamp pairs with. Without them the clamp has nothing to hold on
  // to, and the product is written out with the clamp left in place rather
  // than quietly shifted by four bases.
  if (variant === 'Directional') {
    const afterSite = vectorBases
      .slice(topoSite.end, topoSite.end + DIRECTIONAL_INSERT_OVERHANG.length)
      .toUpperCase()
    if (!DIRECTIONAL_VECTOR_CLAMPS.includes(afterSite)) {
      warnings.push(
        `This vector does not carry the ${DIRECTIONAL_VECTOR_CLAMPS.join(' or ')} overhang beside its TOPO ` +
        `site (found ${afterSite || 'nothing'}), so there is nothing for the insert's ` +
        `${DIRECTIONAL_INSERT_OVERHANG} to pair with: the insert could go in either way round.`,
      )
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
