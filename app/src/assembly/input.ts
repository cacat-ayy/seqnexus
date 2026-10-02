/**
 * What goes into an assembly from a read: its edited, trimmed bases with
 * the quality and trace position of each. Plain sequences can be assembled
 * too; they have no trace and count as confident bases.
 */

import type { SequencingRead } from '../store'
import { buildLayout, inTrim, KIND_DELETE, KIND_INSERT } from '../sanger/layout'
import { MANUAL_QUALITY } from '../sanger/edits'
import type { AssemblyInput } from './types'

export function readInput(read: SequencingRead): AssemblyInput {
  const { data, edits, trimStart, trimEnd } = read
  const L = buildLayout(data, edits)
  let seq = ''
  const qual: number[] = []
  const src: number[] = []
  for (let c = 0; c < L.n; c++) {
    const k = L.kind[c]
    if (k === KIND_DELETE || !inTrim(L, c, trimStart, trimEnd)) continue
    seq += L.bases[c]
    if (k === KIND_INSERT) { qual.push(MANUAL_QUALITY); src.push(-2) }
    else {
      qual.push(k === 0 && !data.metadata.qualityMissing ? (data.qualityScores[L.origin[c]] ?? 0) : MANUAL_QUALITY)
      src.push(L.origin[c])
    }
  }
  return { readId: read.id, name: data.name, seq, qual, src, preferReversed: !!read.reversed }
}

export function sequenceInput(name: string, bases: string): AssemblyInput {
  const seq = bases.toUpperCase().replace(/[^ACGTRYSWKMBDHVN]/g, '')
  return { readId: null, name, seq, qual: new Array(seq.length).fill(MANUAL_QUALITY), src: new Array(seq.length).fill(-2), preferReversed: false }
}
