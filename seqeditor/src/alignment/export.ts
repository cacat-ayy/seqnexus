/**
 * Export aligned sequences in FASTA and Clustal formats,
 * and generate difference annotations for pairwise alignments.
 */

import type { AlignmentResult } from './types'
import type { AnnotationData } from '../models/Annotation'

// ── FASTA ───────────────────────────────────────────────────────────────────

/** Format alignment result as aligned FASTA (with gap characters). */
export function toAlignedFasta(result: AlignmentResult, lineWidth = 80): string {
  return result.sequences.map(seq => {
    const lines: string[] = [`>${seq.name}`]
    for (let i = 0; i < seq.alignedBases.length; i += lineWidth) {
      lines.push(seq.alignedBases.slice(i, i + lineWidth))
    }
    return lines.join('\n')
  }).join('\n')
}

// ── Clustal ─────────────────────────────────────────────────────────────────

/** Format alignment result in Clustal ALN format. */
export function toClustal(result: AlignmentResult, blockWidth = 60): string {
  const { sequences, conservation } = result
  const alnLen = result.alignmentLength
  const maxNameLen = Math.max(...sequences.map(s => s.name.length), 10)

  const lines: string[] = ['CLUSTAL W (SeqNexus) multiple sequence alignment', '']

  for (let start = 0; start < alnLen; start += blockWidth) {
    const end = Math.min(start + blockWidth, alnLen)

    for (const seq of sequences) {
      const name = seq.name.padEnd(maxNameLen + 2)
      const block = seq.alignedBases.slice(start, end)
      lines.push(`${name}${block}`)
    }

    // Conservation line: * for identical, : for similar, . for weakly similar, space for mismatch
    const consLine = ' '.repeat(maxNameLen + 2) + Array.from({ length: end - start }, (_, i) => {
      const col = start + i
      const cv = conservation[col] ?? 0
      if (cv >= 1) return '*'
      if (cv >= 0.8) return ':'
      if (cv >= 0.5) return '.'
      return ' '
    }).join('')
    lines.push(consLine)
    lines.push('')
  }

  return lines.join('\n')
}

// ── PHYLIP ───────────────────────────────────────────────────────────────────

/** Format alignment result in relaxed PHYLIP format. */
export function toPhylip(result: AlignmentResult): string {
  const { sequences, alignmentLength } = result
  const lines: string[] = [`${sequences.length} ${alignmentLength}`]
  for (const seq of sequences) {
    // Relaxed PHYLIP: name followed by spaces then sequence
    const name = seq.name.replace(/\s+/g, '_').slice(0, 50)
    lines.push(`${name}  ${seq.alignedBases}`)
  }
  return lines.join('\n') + '\n'
}

// ── NEXUS ────────────────────────────────────────────────────────────────────

/** Format alignment result in NEXUS format. */
export function toNexus(result: AlignmentResult, seqType: 'dna' | 'protein' = 'dna'): string {
  const { sequences, alignmentLength } = result
  const dataType = seqType === 'protein' ? 'protein' : 'dna'
  const lines: string[] = [
    '#NEXUS',
    '',
    'BEGIN DATA;',
    `  DIMENSIONS NTAX=${sequences.length} NCHAR=${alignmentLength};`,
    `  FORMAT DATATYPE=${dataType} GAP=- MISSING=?;`,
    '  MATRIX',
  ]
  const maxNameLen = Math.max(...sequences.map(s => s.name.length), 10)
  for (const seq of sequences) {
    const name = seq.name.replace(/\s+/g, '_')
    lines.push(`    ${name.padEnd(maxNameLen + 2)}${seq.alignedBases}`)
  }
  lines.push('  ;')
  lines.push('END;')
  lines.push('')
  return lines.join('\n')
}

// ── Annotate differences ────────────────────────────────────────────────────

/**
 * Generate annotations for differences in a pairwise alignment.
 * Annotations are placed on the reference (first) sequence's coordinate system.
 *
 * Contiguous runs of mismatches become one annotation; contiguous gap regions
 * (insertions in query / deletions in reference) become another.
 *
 * Returns annotations in the reference sequence's coordinate space (ungapped).
 */
export function generateDiffAnnotations(result: AlignmentResult): AnnotationData[] {
  if (result.sequences.length < 2) return []

  const refAligned = result.sequences[0].alignedBases
  const qryAligned = result.sequences[1].alignedBases
  const alnLen = result.alignmentLength
  const annotations: AnnotationData[] = []

  let refPos = 0 // position in ungapped reference
  let runType: 'mismatch' | 'gap_in_ref' | 'gap_in_qry' | null = null
  let runStart = 0
  let _annId = 0

  function flushRun(endRefPos: number) {
    if (runType === null) return
    const start = runStart
    const end = endRefPos
    if (start >= end && runType !== 'gap_in_ref') return

    const id = `aln_diff_${++_annId}`
    if (runType === 'mismatch') {
      annotations.push({
        id,
        name: `Mismatch (${end - start} bp)`,
        type: 'misc_difference',
        start,
        end,
        strand: 0,
        color: '#f97316', // orange
      })
    } else if (runType === 'gap_in_ref') {
      // Deletion in reference - mark at the position where the gap occurs
      annotations.push({
        id,
        name: `Deletion in ref`,
        type: 'misc_difference',
        start: Math.max(0, start),
        end: Math.max(1, start + 1), // at least 1 bp wide for visibility
        strand: 0,
        color: '#ef4444', // red
      })
    } else if (runType === 'gap_in_qry') {
      // Insertion in reference (gap in query)
      annotations.push({
        id,
        name: `Insertion (${end - start} bp)`,
        type: 'misc_difference',
        start,
        end,
        strand: 0,
        color: '#ef4444', // red
      })
    }
    runType = null
  }

  for (let i = 0; i < alnLen; i++) {
    const r = refAligned[i]
    const q = qryAligned[i]

    let currentType: 'mismatch' | 'gap_in_ref' | 'gap_in_qry' | null = null

    if (r === '-') {
      currentType = 'gap_in_ref'
    } else if (q === '-') {
      currentType = 'gap_in_qry'
    } else if (r.toUpperCase() !== q.toUpperCase()) {
      currentType = 'mismatch'
    }

    if (currentType !== runType) {
      flushRun(refPos)
      runType = currentType
      runStart = refPos
    }

    if (r !== '-') refPos++
  }

  flushRun(refPos)

  return annotations
}
