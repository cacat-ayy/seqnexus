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

  { id: 'f1', label: 'Frame 1', frames: [F(0)], startsGroup: true },
  { id: 'f2', label: 'Frame 2', frames: [F(1)] },
  { id: 'f3', label: 'Frame 3', frames: [F(2)] },
  { id: 'r1', label: 'Frame 1 reverse', frames: [R(0)] },
  { id: 'r2', label: 'Frame 2 reverse', frames: [R(1)] },
  { id: 'r3', label: 'Frame 3 reverse', frames: [R(2)] },

  { id: 'f12', label: 'Frames 1 & 2', frames: [F(0), F(1)], startsGroup: true },
  { id: 'f13', label: 'Frames 1 & 3', frames: [F(0), F(2)] },
  { id: 'f23', label: 'Frames 2 & 3', frames: [F(1), F(2)] },
  { id: 'r12', label: 'Frames 1 & 2 reverse', frames: [R(0), R(1)] },
  { id: 'r13', label: 'Frames 1 & 3 reverse', frames: [R(0), R(2)] },
  { id: 'r23', label: 'Frames 2 & 3 reverse', frames: [R(1), R(2)] },
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

/**
 * How many translation rows an option needs.
 *
 * The annotation modes get two, which is what the view has always reserved for
 * overlapping features; the frame modes get exactly the frames they ask for.
 */
export function translationRowCount(id: TranslationFrameId): number {
  const frames = framesFor(id)
  return frames.length > 0 ? frames.length : 2
}

// --- Amino acid colouring ---

export type AminoAcidStyleId =
  | 'none' | 'stop' | 'hydrophobicity' | 'polarity' | 'rasmol' | 'clustal' | 'macclade' | 'annotation'

export interface AminoAcidStyle {
  id: AminoAcidStyleId
  label: string
  description: string
}

export const AMINO_ACID_STYLES: AminoAcidStyle[] = [
  { id: 'none', label: 'Plain', description: 'One colour for every residue' },
  { id: 'stop', label: 'Stop codons', description: 'Only stops are coloured' },
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
  stop: null,
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
  if (aa === '*') return STOP
  const palette = PALETTES[style]
  if (!palette) return fallback
  return palette[aa.toUpperCase()] ?? fallback
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
