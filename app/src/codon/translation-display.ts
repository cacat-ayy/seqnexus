/**
 * How the sequence view draws a translation.
 *
 * Three independent choices: which reading frames to show, how to colour the
 * amino acids, and whether to spell them with one letter or three. None of
 * them touch the optimizer, which has its own genetic code setting; this is
 * purely what the linear view renders.
 */

export type TranslationFrameId =
  | 'selection-or-annotation'
  | 'annotation'
  | 'all'
  | 'forward'
  | 'reverse'
  | 'f1' | 'f2' | 'f3'
  | 'r1' | 'r2' | 'r3'
  | 'f12' | 'f13' | 'f23'
  | 'r12' | 'r13' | 'r23'

/** One reading frame: a strand and an offset of 0, 1 or 2 from its 5' end. */
export interface ReadingFrame {
  strand: 1 | -1
  offset: 0 | 1 | 2
}

interface FrameOption {
  id: TranslationFrameId
  label: string
  /** Empty for the two annotation-driven modes, which follow features instead. */
  frames: ReadingFrame[]
  /** Start a new group in the menu, as the screenshot's separators do. */
  startsGroup?: boolean
}

const F = (offset: 0 | 1 | 2): ReadingFrame => ({ strand: 1, offset })
const R = (offset: 0 | 1 | 2): ReadingFrame => ({ strand: -1, offset })

export const TRANSLATION_FRAMES: FrameOption[] = [
  { id: 'selection-or-annotation', label: 'By selection or annotation', frames: [] },
  { id: 'annotation', label: 'By annotation', frames: [] },

  { id: 'all', label: 'All frames', frames: [F(0), F(1), F(2), R(0), R(1), R(2)], startsGroup: true },
  { id: 'forward', label: 'Forward frames', frames: [F(0), F(1), F(2)] },
  { id: 'reverse', label: 'Reverse frames', frames: [R(0), R(1), R(2)] },

  { id: 'f1', label: 'Frame +1', frames: [F(0)], startsGroup: true },
  { id: 'f2', label: 'Frame +2', frames: [F(1)] },
  { id: 'f3', label: 'Frame +3', frames: [F(2)] },
  { id: 'r1', label: 'Frame −1', frames: [R(0)] },
  { id: 'r2', label: 'Frame −2', frames: [R(1)] },
  { id: 'r3', label: 'Frame −3', frames: [R(2)] },

  { id: 'f12', label: 'Frames +1 & +2', frames: [F(0), F(1)], startsGroup: true },
  { id: 'f13', label: 'Frames +1 & +3', frames: [F(0), F(2)] },
  { id: 'f23', label: 'Frames +2 & +3', frames: [F(1), F(2)] },
  { id: 'r12', label: 'Frames −1 & −2', frames: [R(0), R(1)] },
  { id: 'r13', label: 'Frames −1 & −3', frames: [R(0), R(2)] },
  { id: 'r23', label: 'Frames −2 & −3', frames: [R(1), R(2)] },
]

export const DEFAULT_TRANSLATION_FRAME: TranslationFrameId = 'selection-or-annotation'

const FRAME_BY_ID = new Map(TRANSLATION_FRAMES.map(f => [f.id, f]))

/** The reading frames an option asks for. Empty means "follow the features". */
export function framesFor(id: TranslationFrameId): ReadingFrame[] {
  return FRAME_BY_ID.get(id)?.frames ?? []
}

/** True for the two options that translate annotated features, not frames. */
export function followsAnnotations(id: TranslationFrameId): boolean {
  return framesFor(id).length === 0
}

export function frameLabel(id: TranslationFrameId): string {
  return FRAME_BY_ID.get(id)?.label ?? id
}

/** True for the option that also translates the selection. */
export function translatesSelection(id: TranslationFrameId): boolean {
  return id === 'selection-or-annotation'
}

/**
 * How many translation rows an option needs.
 *
 * The annotation modes get two, which is what the view has always reserved for
 * overlapping features, and the selection mode one more for the selection's
 * own translation. The frame modes get exactly the frames they ask for.
 */
export function translationRowCount(id: TranslationFrameId): number {
  const frames = framesFor(id)
  if (frames.length > 0) return frames.length
  return translatesSelection(id) ? 3 : 2
}

// --- Translating a selection ---

/** One codon of a translated selection. */
export interface SelectionCodon {
  /** Codon number counted from where the selection starts reading: 0, 1, 2... */
  index: number
  /**
   * Genomic positions of its bases, in reading order: three, or one or two
   * for the codon still being selected at the far end.
   */
  bases: number[]
  /** Fewer than three bases selected so far, so there is no residue yet. */
  partial: boolean
}

/**
 * The selection's codons that have a base in one row.
 *
 * The selection is read in the direction it was dragged: left to right reads
 * the top strand from its first base, right to left reads the bottom strand
 * from its last base, so the protein starts wherever the drag started. A
 * selection that is not a multiple of three ends in a partial codon of one
 * or two bases at the far end, the end the drag is on; it is returned too, so
 * the view can show the next codon taking shape before its third base.
 *
 * `segments` are the selected [start, end) spans in reading order, as
 * joinedSegments gives them: one, two for a range across the origin, more
 * for several ranges. They are read as one sequence, joined the way exons
 * are, so a codon can take bases from two of them. The walk is over the
 * row, not the selection, so the cost is one row's width however long the
 * selection is.
 */
export function selectionCodonsInRow(
  segments: [number, number][], reverse: boolean,
  rowStart: number, rowEnd: number,
): SelectionCodon[] {
  // Where each segment begins in the joined sequence.
  const offsets: number[] = []
  let length = 0
  for (const [s, e] of segments) { offsets.push(length); length += e - s }
  if (length <= 0) return []
  const whole = Math.floor(length / 3)
  // u counts bases from the end reading starts at; a codon is three of them.
  const posAt = (u: number) => {
    const t = reverse ? length - 1 - u : u
    let i = segments.length - 1
    while (offsets[i] > t) i--
    return segments[i][0] + t - offsets[i]
  }
  // The segments in the row, left to right, so codons come out in row order.
  const inRow = segments
    .map(([s, e], i) => [Math.max(s, rowStart), Math.min(e, rowEnd), offsets[i] - s] as const)
    .filter(([from, to]) => from < to)
    .sort((a, b) => a[0] - b[0])
  const out: SelectionCodon[] = []
  // A set, not a check against the previous codon: the row can meet the
  // selection's later bases before its earlier ones (a range across the
  // origin, or ranges joined out of position order), so a codon's bases
  // need not arrive together.
  const seen = new Set<number>()
  for (const [from, to, shift] of inRow) {
    for (let p = from; p < to; p++) {
      const t = p + shift
      const k = Math.floor((reverse ? length - 1 - t : t) / 3)
      if (seen.has(k)) continue
      seen.add(k)
      const count = k < whole ? 3 : length - 3 * k
      const bases: number[] = []
      for (let i = 0; i < count; i++) bases.push(posAt(3 * k + i))
      out.push({ index: k, bases, partial: count < 3 })
    }
  }
  return out
}

/**
 * Joined spans less `n` bases at the end reading starts from: the first
 * span's start read forwards, the last span's end read backwards. For a
 * feature's /codon_start, which skips bases before the first codon.
 */
export function trimReadingStart(segments: [number, number][], n: number, reverse: boolean): [number, number][] {
  const out = segments.map(([s, e]) => [s, e] as [number, number])
  while (n > 0 && out.length > 0) {
    const i = reverse ? out.length - 1 : 0
    const [s, e] = out[i]
    const take = Math.min(n, e - s)
    n -= take
    if (take === e - s) out.splice(i, 1)
    else out[i] = reverse ? [s, e - take] : [s + take, e]
  }
  return out
}

// --- Amino acid colouring ---

export type AminoAcidStyleId =
  | 'none' | 'hydrophobicity' | 'polarity' | 'rasmol' | 'clustal' | 'macclade' | 'annotation'

export interface AminoAcidStyle {
  id: AminoAcidStyleId
  label: string
  description: string
}

export const AMINO_ACID_STYLES: AminoAcidStyle[] = [
  { id: 'none', label: 'Plain', description: 'One colour for every residue, stops in red' },
  { id: 'hydrophobicity', label: 'Hydrophobicity', description: 'Kyte-Doolittle, blue polar to orange hydrophobic' },
  { id: 'polarity', label: 'Polarity', description: 'Charged, polar and non-polar groups' },
  { id: 'rasmol', label: 'RasMol', description: 'The RasMol amino acid palette' },
  { id: 'clustal', label: 'Clustal', description: 'Clustal X residue colours' },
  { id: 'macclade', label: 'MacClade', description: 'MacClade residue colours' },
  { id: 'annotation', label: 'By annotation', description: "Each translation takes its feature's colour" },
]

export const DEFAULT_AMINO_ACID_STYLE: AminoAcidStyleId = 'none'

const STOP = '#c0392b'

/** Kyte-Doolittle, mapped onto a blue to orange ramp. */
const HYDROPHOBICITY: Record<string, string> = {
  I: '#e8590c', V: '#f76707', L: '#fd7e14', F: '#ff922b', C: '#ffa94d',
  M: '#ffc078', A: '#ffd8a8', W: '#c5bdb4', G: '#adb5bd', T: '#a5c8e1',
  S: '#8fbce0', Y: '#79b0df', P: '#63a4de', H: '#4d98dd', E: '#3b82f6',
  Q: '#3b82f6', D: '#2f74c9', N: '#2f74c9', K: '#2563a8', R: '#1d4f87',
}

/** Charge and polarity groups, the way most textbooks colour them. */
const POLARITY: Record<string, string> = {
  D: '#e03131', E: '#e03131',                                   // acidic
  K: '#1971c2', R: '#1971c2', H: '#4dabf7',                      // basic
  S: '#2f9e44', T: '#2f9e44', N: '#2f9e44', Q: '#2f9e44',        // polar
  Y: '#37b24d', C: '#37b24d',
  A: '#868e96', V: '#868e96', L: '#868e96', I: '#868e96',        // non-polar
  P: '#868e96', F: '#868e96', M: '#868e96', W: '#868e96', G: '#868e96',
}

/** RasMol amino acid colours. */
const RASMOL: Record<string, string> = {
  D: '#e60a0a', E: '#e60a0a', C: '#e6e600', M: '#e6e600',
  K: '#145aff', R: '#145aff', S: '#fa9600', T: '#fa9600',
  F: '#3232aa', Y: '#3232aa', N: '#00dcdc', Q: '#00dcdc',
  G: '#ebebeb', L: '#0f820f', V: '#0f820f', I: '#0f820f',
  A: '#c8c8c8', W: '#b45ab4', H: '#8282d2', P: '#dc9682',
}

/** Clustal X residue colouring, by physicochemical class. */
const CLUSTAL: Record<string, string> = {
  A: '#80a0f0', I: '#80a0f0', L: '#80a0f0', M: '#80a0f0',
  F: '#80a0f0', W: '#80a0f0', V: '#80a0f0', C: '#f08080',
  K: '#f01505', R: '#f01505', D: '#c048c0', E: '#c048c0',
  N: '#15c015', Q: '#15c015', S: '#15c015', T: '#15c015',
  G: '#f09048', P: '#c0c000', H: '#15a4a4', Y: '#15a4a4',
}

/** MacClade residue colouring. */
const MACCLADE: Record<string, string> = {
  A: '#33cc00', C: '#ffff00', D: '#cc0033', E: '#cc0033',
  F: '#00ff66', G: '#ff9900', H: '#0099ff', I: '#009900',
  K: '#0066ff', L: '#009933', M: '#00cc33', N: '#cc00cc',
  P: '#ffcc00', Q: '#cc00cc', R: '#0033ff', S: '#ff6600',
  T: '#ff3300', V: '#00cc00', W: '#00ccff', Y: '#00ff99',
}

const PALETTES: Record<AminoAcidStyleId, Record<string, string> | null> = {
  none: null,
  hydrophobicity: HYDROPHOBICITY,
  polarity: POLARITY,
  rasmol: RASMOL,
  clustal: CLUSTAL,
  macclade: MACCLADE,
  annotation: null,
}

/**
 * Colour for one residue.
 *
 * `fallback` is the theme foreground for styles that leave a residue plain,
 * or the feature's colour under "By annotation". Stops are always marked: a
 * stop the eye skips over is the one thing a translation must not hide.
 */
export function aminoAcidColor(
  style: AminoAcidStyleId, aa: string, fallback: string,
): string {
  return aminoAcidFill(style, aa) ?? fallback
}

/**
 * The residue's own colour, or null when the style leaves it plain.
 *
 * The sequence view fills the chip behind a coloured residue rather than
 * colouring the letter, so it needs to know which residues have a colour of
 * their own and which keep the plain codon block.
 */
export function aminoAcidFill(style: AminoAcidStyleId, aa: string): string | null {
  if (aa === '*') return STOP
  return PALETTES[style]?.[aa.toUpperCase()] ?? null
}

/** One-letter to three-letter, for the three-letter spelling. */
export const AA_THREE_LETTER: Record<string, string> = {
  A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu',
  G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe',
  P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val',
  '*': 'Stop', X: 'Xaa', '?': '?',
}

export function aminoAcidLabel(aa: string, threeLetter: boolean): string {
  if (!threeLetter) return aa
  return AA_THREE_LETTER[aa.toUpperCase()] ?? aa
}
