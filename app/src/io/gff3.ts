/**
 * GFF3 writer.
 *
 * Exports annotations as GFF3 (Generic Feature Format version 3).
 * Coordinates are converted from 0-based half-open to 1-based inclusive.
 * See: https://github.com/The-Sequence-Ontology/Specifications/blob/master/gff3.md
 */

import type { DocumentState } from '../models/Document'

/** Characters that must be percent-encoded in GFF3 column 9 values. */
function encodeGff3(s: string): string {
  return s
    .replace(/%/g, '%25')
    .replace(/;/g, '%3B')
    .replace(/=/g, '%3D')
    .replace(/&/g, '%26')
    .replace(/,/g, '%2C')
    .replace(/\t/g, '%09')
    .replace(/\n/g, '%0A')
    .replace(/\r/g, '%0D')
}

export function writeGff3(doc: DocumentState): string {
  const lines: string[] = []
  lines.push('##gff-version 3')

  const seqLen = doc.sequence.bases.length
  const seqId = doc.name.replace(/\s+/g, '_')

  // ##sequence-region directive
  lines.push(`##sequence-region ${seqId} 1 ${seqLen}`)

  for (const ann of doc.annotations) {
    // GFF3 uses 1-based inclusive coordinates
    let start: number
    let end: number

    if (ann.start <= ann.end) {
      start = ann.start + 1
      end = ann.end
    } else {
      // Origin-spanning feature on circular sequence – GFF3 doesn't natively
      // support wrapping, so we emit the full span as [start+1, seqLen] and
      // note the wrap in attributes. Tools can reconstruct from Is_circular.
      start = ann.start + 1
      end = seqLen
    }

    const strand = ann.strand === 1 ? '+' : ann.strand === -1 ? '-' : '.'
    const type = ann.type || 'region'

    // Build column 9 attributes
    const attrs: string[] = []
    attrs.push(`ID=${encodeGff3(ann.id)}`)
    attrs.push(`Name=${encodeGff3(ann.name)}`)

    if (ann.color) {
      attrs.push(`color=${encodeGff3(ann.color)}`)
    }

    if (ann.start > ann.end) {
      // Mark origin-spanning features
      attrs.push('Is_circular=true')
      attrs.push(`circular_end=${ann.end}`)
    }

    // Include qualifiers
    if (ann.qualifiers) {
      for (const [key, values] of Object.entries(ann.qualifiers)) {
        if (key === 'label' || key === 'gene') continue // already in Name
        for (const val of values) {
          attrs.push(`${encodeGff3(key)}=${encodeGff3(val)}`)
        }
      }
    }

    // seqid  source  type  start  end  score  strand  phase  attributes
    lines.push(`${seqId}\tSeqEditor\t${type}\t${start}\t${end}\t.\t${strand}\t.\t${attrs.join(';')}`)
  }

  lines.push('')
  return lines.join('\n')
}
