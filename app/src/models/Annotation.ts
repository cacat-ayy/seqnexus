/**
 * Annotation (feature) on a sequence.
 *
 * Coordinates are 0-based, half-open [start, end).
 * For circular sequences, start > end indicates a feature spanning the origin.
 * Strand: 1 = forward, -1 = reverse, 0 = none.
 */

export type Strand = 1 | -1 | 0

export interface AnnotationData {
  id: string
  name: string
  type: string          // GenBank feature key: CDS, gene, promoter, etc.
  start: number
  end: number
  strand: Strand
  color?: string
  qualifiers?: Record<string, string[]>
  /** Set when the annotation was truncated at a cloning junction. */
  truncated?: boolean
}

/** Strip HTML tags from a string. Handles SnapGene rich-text names. */
function sanitize(s: string): string {
  if (!s.includes('<')) return s
  return s.replace(/<[^>]*>/g, '').trim()
}

/** Default colors per annotation type. */
const TYPE_COLORS: Record<string, string> = {
  CDS:              '#4dabf7',  // blue
  gene:             '#339af0',  // darker blue
  promoter:         '#51cf66',  // green
  terminator:       '#ff6b6b',  // red
  rep_origin:       '#ffd43b',  // gold
  primer_bind:      '#20c997',  // teal
  misc_feature:     '#adb5bd',  // gray
  misc_binding:     '#cc5de8',  // purple
  protein_bind:     '#845ef7',  // violet
  regulatory:       '#ff922b',  // orange
  enhancer:         '#f06595',  // pink
  silencer:         '#d6336c',  // dark pink
  sig_peptide:      '#e64980',  // magenta
  transit_peptide:  '#c2255c',  // deep magenta
  mat_peptide:      '#f06595',  // pink
  mRNA:             '#22b8cf',  // cyan
  rRNA:             '#15aabf',  // dark cyan
  tRNA:             '#3bc9db',  // light cyan
  ncRNA:            '#66d9e8',  // pale cyan
  intron:           '#dee2e6',  // light gray
  exon:             '#74b816',  // lime
  "5'UTR":          '#a9e34b',  // yellow-green
  "3'UTR":          '#94d82d',  // lime-green
  polyA_signal:     '#fab005',  // amber
  TATA_signal:      '#f59f00',  // dark amber
  repeat_region:    '#fd7e14',  // dark orange
  LTR:              '#e8590c',  // burnt orange
  mobile_element:   '#f76707',  // orange-red
  STS:              '#868e96',  // medium gray
  variation:        '#fab005',  // amber
  source:           '#ced4da',  // silver
  misc_difference:  '#ffa94d',  // light orange
  misc_recomb:      '#da77f2',  // light purple
}

/** Get the default color for an annotation type. */
export function defaultColorForType(type: string): string {
  return TYPE_COLORS[type] ?? '#4dabf7'
}

export class Annotation implements AnnotationData {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly start: number
  readonly end: number
  readonly strand: Strand
  readonly color: string
  readonly qualifiers: Record<string, string[]>

  constructor(data: AnnotationData) {
    this.id = data.id
    this.name = sanitize(data.name)
    this.type = data.type
    this.start = data.start
    this.end = data.end
    this.strand = data.strand
    this.color = data.color ?? defaultColorForType(data.type)
    this.qualifiers = data.qualifiers ?? {}
  }

  /** Span length, accounting for origin-spanning features. */
  span(seqLength: number): number {
    if (this.start <= this.end) {
      return this.end - this.start
    }
    // wraps origin
    return seqLength - this.start + this.end
  }

  /** Whether this annotation spans the origin (circular). */
  spansOrigin(): boolean {
    return this.start > this.end
  }

  /** Return a new Annotation with updated fields. */
  with(patch: Partial<Omit<AnnotationData, 'id'>>): Annotation {
    return new Annotation({ ...this.toData(), ...patch })
  }

  toData(): AnnotationData {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      start: this.start,
      end: this.end,
      strand: this.strand,
      color: this.color,
      qualifiers: this.qualifiers,
    }
  }
}

/**
 * Adjust annotation coordinates after a sequence edit.
 *
 * editPos:    position where the edit occurs
 * editDelta:  positive = insertion length, negative = deletion length
 * seqLength:  sequence length BEFORE the edit
 * circular:   whether the sequence has circular topology
 *
 * Returns a new Annotation with adjusted coordinates, or null if the
 * annotation was fully deleted.
 */
export function adjustAnnotation(
  ann: Annotation,
  editPos: number,
  editDelta: number,
  seqLength: number,
  circular: boolean = false,
): Annotation | null {
  // Origin-spanning annotations on circular sequences need special handling
  if (circular && ann.spansOrigin()) {
    return adjustOriginSpanning(ann, editPos, editDelta, seqLength)
  }

  let { start, end } = ann

  if (editDelta > 0) {
    // Insertion at editPos
    if (start >= editPos) start += editDelta
    if (end > editPos) end += editDelta
  } else {
    // Deletion: remove [editPos, editPos + |editDelta|)
    const delStart = editPos
    const delEnd = editPos + Math.abs(editDelta)

    start = adjustCoordForDeletion(start, delStart, delEnd)
    end = adjustCoordForDeletion(end, delStart, delEnd)

    // Annotation fully within deleted region
    if (start === end && ann.start !== ann.end) {
      return null
    }
  }

  return ann.with({ start, end })
}

/**
 * Adjust an origin-spanning annotation (start > end) on a circular sequence.
 *
 * The feature occupies two segments in the linear representation:
 *   tail = [start, seqLength)   (before the origin)
 *   head = [0, end)             (after the origin)
 *
 * We adjust each segment independently, then recombine.
 */
function adjustOriginSpanning(
  ann: Annotation,
  editPos: number,
  editDelta: number,
  seqLength: number,
): Annotation | null {
  const { start, end } = ann
  const newSeqLength = seqLength + editDelta

  if (newSeqLength <= 0) return null

  if (editDelta > 0) {
    // Insertion
    let newStart = start
    let newEnd = end

    if (editPos <= end) {
      // Insertion inside the head segment [0, end) - shifts both end and start
      newStart = start + editDelta
      newEnd = end + editDelta
    } else if (editPos >= start) {
      // Insertion inside the tail segment [start, seqLength) - only end of
      // sequence grows; start stays, end stays
      // (start is before editPos so unchanged; end is in [0, end) so unchanged)
    } else {
      // Insertion in the gap [end, start) - shifts start only
      newStart = start + editDelta
    }

    // Check if the annotation still needs to span the origin
    if (newStart >= newSeqLength) {
      // Shouldn't happen with insertions, but guard anyway
      newStart = newStart % newSeqLength
    }

    return ann.with({ start: newStart, end: newEnd })
  }

  // Deletion: remove [delStart, delEnd)
  const delStart = editPos
  const delEnd = editPos + Math.abs(editDelta)

  // Compute how much of the tail [start, seqLength) survives
  const tailStart = start
  const tailEnd = seqLength
  const tailSurvival = segmentAfterDeletion(tailStart, tailEnd, delStart, delEnd)

  // Compute how much of the head [0, end) survives
  const headSurvival = segmentAfterDeletion(0, end, delStart, delEnd)

  // Both segments fully deleted
  if (tailSurvival === null && headSurvival === null) {
    return null
  }

  // Only head survives - no longer spans origin
  if (tailSurvival === null) {
    const [hs, he] = headSurvival!
    const newStart = adjustCoordForDeletion(hs, delStart, delEnd)
    const newEnd = adjustCoordForDeletion(he, delStart, delEnd)
    if (newStart === newEnd) return null
    return ann.with({ start: newStart, end: newEnd })
  }

  // Only tail survives - no longer spans origin
  if (headSurvival === null) {
    const [ts, te] = tailSurvival
    const newStart = adjustCoordForDeletion(ts, delStart, delEnd)
    const newEnd = adjustCoordForDeletion(te, delStart, delEnd)
    if (newStart === newEnd) return null
    return ann.with({ start: newStart, end: newEnd })
  }

  // Both segments survive - still spans origin
  const newStart = adjustCoordForDeletion(tailSurvival[0], delStart, delEnd)
  const newEnd = adjustCoordForDeletion(headSurvival[1], delStart, delEnd)

  // If the annotation no longer needs to wrap (start <= end after adjustment
  // and both segments are contiguous at the origin), it becomes a normal annotation
  if (newStart <= newEnd) {
    // The segments merged - no longer spans origin
    if (newStart === newEnd) return null
    return ann.with({ start: newStart, end: newEnd })
  }

  return ann.with({ start: newStart, end: newEnd })
}

/**
 * Compute the surviving portion of segment [segStart, segEnd) after
 * deleting [delStart, delEnd).
 *
 * Returns the surviving bounds in *pre-deletion* coordinates (the caller
 * must apply `adjustCoordForDeletion` to shift them). Returns null if
 * the segment is fully deleted.
 */
function segmentAfterDeletion(
  segStart: number,
  segEnd: number,
  delStart: number,
  delEnd: number,
): [number, number] | null {
  // No overlap
  if (delEnd <= segStart || delStart >= segEnd) {
    return [segStart, segEnd]
  }
  // Fully contained
  if (delStart <= segStart && delEnd >= segEnd) {
    return null
  }
  // Deletion in the middle – both sides survive; return original bounds
  // (adjustCoordForDeletion will shrink the end coordinate)
  if (delStart > segStart && delEnd < segEnd) {
    return [segStart, segEnd]
  }
  // Deletion overlaps the start – surviving portion starts after deletion
  if (delStart <= segStart) {
    return [Math.max(segStart, delEnd), segEnd]
  }
  // Deletion overlaps the end – surviving portion ends before deletion
  return [segStart, Math.min(segEnd, delStart)]
}

function adjustCoordForDeletion(
  coord: number,
  delStart: number,
  delEnd: number,
): number {
  if (coord <= delStart) return coord
  if (coord >= delEnd) return coord - (delEnd - delStart)
  // coord is inside the deleted region - collapse to delStart
  return delStart
}
