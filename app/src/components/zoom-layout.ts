/**
 * Zoom-dependent layout for SequenceView.
 *
 * Each zoom level 0-20 is a width per base in pixels (CELL_W); the pane width
 * divided by it gives the bases per row. One curve for every level means each
 * step in shows fewer bases per row, whatever the width of the pane. The
 * render mode follows from the width a base gets, not from the level number:
 *   under 5 px:    "line"    - backbone, no individual bases
 *   5 to 9.6 px:   "dots"    - a coloured dot per base
 *   9.6 px and up: "letters" - base letters + complement, the letters
 *                              growing with the cell
 */

export type RenderMode = 'line' | 'dots' | 'letters'

export interface ZoomLayout {
  mode: RenderMode
  basesPerRow: number
  bpWidth: number
  groupGap: number
  basesPerGroup: number
  leftMargin: number
  rulerHeight: number
  seqLineHeight: number
  strandGap: number
  showComplement: boolean
  /** Letters zoom: height of one strand of letters; 0 in the other modes. */
  letterH: number
  /** Letters zoom: font size of the bases in pixels; 0 in the other modes. */
  letterFont: number
  annotationRowH: number
  annotationGap: number
  maxAnnotationRows: number
  maxTranslationRows: number
  translationRowH: number
  translationGap: number
  rowPaddingBottom: number
  rowHeight: number
  /** Height of one row of cut-site names above the ruler. */
  enzymeLabelTierH: number
  /**
   * Most rows of names a line may have; 0 when sites are hidden. Each line
   * has only the rows its own names need (RowLayoutMap.tiers), plus one for
   * "+N" chips when even this many cannot hold them all.
   */
  maxEnzymeTiers: number
  /** Height of one lane of recognition-site bars under the ruler. */
  siteLaneH: number
  /** Most lanes of site bars a line may have; 0 when there are no bars. */
  maxSiteLanes: number
  /** Space under the bars, before the sequence. */
  siteBandPad: number
  /**
   * Height of the graph track under a protein's feature lanes (a windowed
   * scale such as hydropathy); 0 when none is shown. Every row carries it.
   */
  graphH: number
}

/**
 * Width of a base in pixels at each level. Steps of about 1.55x while the
 * bases are a line, so ten steps reach from a row of a few hundred bases to
 * one of 15 kb on a typical pane; then finer steps once each base is a mark
 * the eye follows (about 1.25x for dots, 1.1x for letters). Level 14, the
 * default, is 10.8 px.
 */
const CELL_W = [
  0.06, 0.093, 0.145, 0.226, 0.35, 0.55, 0.85, 1.3, 2.05, 3.2, // 0-9: line
  5, 6.4, 8,                                                    // 10-12: dots
  9.6, 10.8, 12, 13.5, 15, 16.5, 18, 20,                        // 13-20: letters
]

/** The highest zoom level. */
export const MAX_ZOOM = CELL_W.length - 1
/** A base this wide gets a dot of its own; narrower, the dots merge into a stripe. */
export const DOT_MIN_CELL = 5
/** A base this wide holds a 14px monospace letter with a little air either side. */
export const LETTER_MIN_CELL = 9.6
/**
 * A base this wide gives a six-base recognition site a bar of 6 px or more;
 * narrower, the site bars and the graph track are left out.
 */
const DETAIL_MIN_CELL = 1

/** The width per base, in pixels, that a zoom level asks for. */
export function cellWidth(z: number): number {
  return CELL_W[Math.max(0, Math.min(MAX_ZOOM, Math.round(z)))]
}

/** The render mode at a zoom level, from the width it gives a base. */
export function getRenderMode(z: number): RenderMode {
  const cell = cellWidth(z)
  if (cell >= LETTER_MIN_CELL) return 'letters'
  if (cell >= DOT_MIN_CELL) return 'dots'
  return 'line'
}

/** The first zoom level that shows letters. */
export const LETTERS_FROM = CELL_W.findIndex(c => c >= LETTER_MIN_CELL)

/**
 * The size of the base letters for a cell: 14px up to the default level's
 * 10.8 px cell, then growing with the cell, so a zoom in makes the letters
 * bigger rather than only spacing them further apart.
 */
export function letterFontSize(cell: number): number {
  return Math.max(14, Math.round(cell * 1.3))
}

/**
 * Bases per row away from letters, rounded down to two significant figures
 * (1,600 rather than 1,667), so rows start on round positions in the margin.
 * Rounding down keeps the row inside the pane. Line and dot levels are at
 * least 1.2x apart and the rounding loses under 10%, so no two levels round
 * to the same length.
 */
function roundRowLength(n: number): number {
  if (n < 100) return Math.max(1, Math.floor(n))
  const unit = 10 ** (Math.floor(Math.log10(n)) - 1)
  return Math.floor(n / unit) * unit
}

export interface LayoutToggles {
  /** Reserve and draw the complement strand under the forward one. */
  showComplement?: boolean
  /** Reserve lanes for annotation bars beneath the sequence. */
  showAnnotations?: boolean
  /**
   * Translation rows to reserve. Zero hides the translation entirely; the
   * frame modes ask for one row per frame, up to all six.
   */
  translationRows?: number
  /**
   * Letters zoom only: this many bases per row instead of as many as fit.
   * The PDF export sets the line length and sizes the page to it.
   */
  basesPerRow?: number
  /** Reserve this many pixels per row for a graph track; 0 or absent for none. */
  graphHeight?: number
}

export function getLayout(
  zoomLevel: number,
  containerWidth: number,
  showEnzymes = false,
  seqLen = 0,
  toggles: LayoutToggles = {},
): ZoomLayout {
  const wantComplement = toggles.showComplement ?? true
  const wantAnnotations = toggles.showAnnotations ?? true
  const wantTranslationRows = Math.max(0, Math.min(6, toggles.translationRows ?? 2))
  const z = Math.max(0, Math.min(MAX_ZOOM, zoomLevel))
  const cell = cellWidth(z)
  const mode = getRenderMode(z)
  // Dynamic left margin based on the widest position label
  const maxLabel = seqLen > 0 ? seqLen.toLocaleString('en-US') : '99,999'
  // ~7.5px per char at 12px monospace + 16px padding (8px gap to sequence + 8px left edge)
  const labelW = maxLabel.length * 7.5 + 16
  const leftMargin = mode === 'letters' ? Math.max(70, Math.ceil(labelW)) : Math.max(50, Math.ceil(labelW))
  const available = Math.max(200, containerWidth - leftMargin - 20)
  const basesPerGroup = 10
  const groupGap = 0

  // As many bases as fit at the level's width; the row then fills the pane
  // exactly, so a base is never narrower than its level asks for.
  const basesPerRow = mode === 'letters'
    ? (toggles.basesPerRow && toggles.basesPerRow > 0
      ? Math.round(toggles.basesPerRow)
      : Math.max(10, Math.floor(available / cell)))
    : roundRowLength(available / cell)
  const bpWidth = available / basesPerRow

  const rulerHeight = 18
  const annotationRowH = mode === 'line' ? 12 : 14
  const annotationGap = 2
  // The complement only exists at letters zoom; below that there are no
  // letters to draw it with.
  const showComplement = mode === 'letters' && wantComplement
  const strandGap = showComplement ? 2 : 0
  // Only letters zoom has room for residues; below that the row is a few
  // pixels tall and there is nothing to align them to.
  const maxTranslationRows = mode === 'letters' ? wantTranslationRows : 0
  // A strand is its letters plus 2px: 16px at the default 14px letters. Two
  // strands stack with a gap between them. Dropping the complement has to
  // shrink the row, not just skip the draw, or every row carries a blank
  // strand's worth of space.
  const letterFont = mode === 'letters' ? letterFontSize(cell) : 0
  const letterH = mode === 'letters' ? letterFont + 2 : 0
  const seqLineHeight = mode === 'letters'
    ? (showComplement ? letterH * 2 + strandGap : letterH)
    : mode === 'dots' ? 8 : 4

  const enzymeLabelTierH = 14
  const maxEnzymeTiers = showEnzymes ? 5 : 0
  // A bar per recognition site, in lanes where sites overlap. Not zoomed so
  // far out that a six-base site is only a few pixels wide.
  const detail = cell >= DETAIL_MIN_CELL
  const siteLaneH = 3
  const maxSiteLanes = showEnzymes && detail ? 3 : 0
  const siteBandPad = 2

  // Zero lanes means the annotation area collapses entirely: stackAnnotations
  // places nothing, and rowHeightForLanes reserves no space for it.
  const maxAnnotationRows = wantAnnotations ? 4 : 0

  // Letter rows get a little more air: rows without features now end right
  // under the complement, and the selection handle reaches below it.
  const rowPaddingBottom = mode === 'letters' ? 10 : 6
  // The graph wants room for a curve; zoomed far out a row is thousands of
  // bases and the track would be most of its height, so it starts where
  // the site bars do.
  const graphH = detail ? Math.max(0, Math.round(toggles.graphHeight ?? 0)) : 0

  // A line with no cut sites: no names, no bars.
  const rowHeight = rulerHeight + seqLineHeight
    + (maxAnnotationRows > 0 ? annotationGap + maxAnnotationRows * (annotationRowH + annotationGap) : 0)
    + maxTranslationRows * (12 + 1) + graphH + rowPaddingBottom

  return {
    mode, basesPerRow, bpWidth, groupGap, basesPerGroup, leftMargin,
    rulerHeight, seqLineHeight, strandGap, showComplement, letterH, letterFont,
    annotationRowH, annotationGap, maxAnnotationRows,
    maxTranslationRows, translationRowH: 12, translationGap: 1,
    rowPaddingBottom, rowHeight,
    enzymeLabelTierH, maxEnzymeTiers, siteLaneH, maxSiteLanes, siteBandPad,
    graphH,
  }
}

/** Height of a line's cut-site names: as many rows as it uses, one more for chips. */
export function labelAreaHeight(L: ZoomLayout, tiers: number): number {
  if (L.maxEnzymeTiers === 0) return 0
  return Math.max(0, Math.min(tiers, L.maxEnzymeTiers + 1)) * L.enzymeLabelTierH
}

/** Height of a line's band of recognition-site bars. */
export function siteBandHeight(L: ZoomLayout, lanes: number): number {
  const n = Math.max(0, Math.min(lanes, L.maxSiteLanes))
  return n > 0 ? n * L.siteLaneH + L.siteBandPad : 0
}

/**
 * Height of a row with a specific number of annotation lanes, translation
 * rows, rows of cut-site names and lanes of site bars. The translation count
 * defaults to the layout's maximum, which is what every row needs when whole
 * reading frames are shown.
 */
export function rowHeightForLanes(
  L: ZoomLayout, annLanes: number, translationRows = L.maxTranslationRows,
  tiers = 0, siteLanes = 0,
): number {
  const clampedLanes = Math.min(annLanes, L.maxAnnotationRows)
  const annArea = clampedLanes > 0
    ? L.annotationGap + clampedLanes * (L.annotationRowH + L.annotationGap)
    : 0
  const clampedTranslations = Math.max(0, Math.min(translationRows, L.maxTranslationRows))
  return labelAreaHeight(L, tiers) + L.rulerHeight + siteBandHeight(L, siteLanes) + L.seqLineHeight + annArea
    + clampedTranslations * (L.translationRowH + L.translationGap) + L.graphH + L.rowPaddingBottom
}

/**
 * Precomputed per-row Y offsets for variable-height rows.
 *
 * Replaces `rowIndex * L.rowHeight` with `rl.rowY(rowIndex)` and
 * `Math.floor(py / L.rowHeight)` with `rl.rowAtY(py)`.
 */
export class RowLayoutMap {
  /** Number of annotation lanes actually used per row. */
  readonly lanes: Uint8Array
  /**
   * Translation rows each row reserves, read only when perRowTranslations is
   * set. Feature translations exist only where a CDS does, so a row without
   * one should not carry their blank space.
   */
  readonly translations: Uint8Array
  /** Rows of cut-site names each line uses, counting the chip row (see layoutSiteRow). */
  readonly tiers: Uint8Array
  /** Lanes of recognition-site bars each line uses. */
  readonly siteLanes: Uint8Array
  perRowTranslations = false
  readonly totalRows: number
  totalHeight: number
  /** When all rows have the same height, use O(1) arithmetic. */
  private _uniformH: number
  /** Cumulative Y offsets for non-uniform case. null when uniform. */
  private _offsets: Float64Array | null

  constructor(totalRows: number) {
    this.totalRows = totalRows
    this.lanes = new Uint8Array(totalRows)
    this.translations = new Uint8Array(totalRows)
    this.tiers = new Uint8Array(totalRows)
    this.siteLanes = new Uint8Array(totalRows)
    this.totalHeight = 0
    this._uniformH = 0
    this._offsets = null
  }

  /** Translation rows reserved by one row under layout L. */
  translationRowsAt(rowIndex: number, L: ZoomLayout): number {
    if (!this.perRowTranslations) return L.maxTranslationRows
    return Math.min(this.translations[rowIndex] ?? 0, L.maxTranslationRows)
  }

  /** Height of the cut-site names at the top of a line. */
  labelAreaH(rowIndex: number, L: ZoomLayout): number {
    return labelAreaHeight(L, this.tiers[rowIndex] ?? 0)
  }

  /** Height of the band of site bars between a line's ruler and its bases. */
  siteBandH(rowIndex: number, L: ZoomLayout): number {
    return siteBandHeight(L, this.siteLanes[rowIndex] ?? 0)
  }

  /** From a line's top edge to the top of its bases. */
  seqTop(rowIndex: number, L: ZoomLayout): number {
    return this.labelAreaH(rowIndex, L) + L.rulerHeight + this.siteBandH(rowIndex, L)
  }

  /** Build layout from the per-row counts. Uses the O(1) uniform path when every row is the same height. */
  build(L: ZoomLayout): void {
    const heightAt = (i: number) =>
      rowHeightForLanes(L, this.lanes[i], this.translationRowsAt(i, L), this.tiers[i], this.siteLanes[i])
    const first = this.totalRows > 0 ? heightAt(0) : 0
    let uniform = true
    for (let i = 1; i < this.totalRows; i++) {
      if (heightAt(i) !== first) { uniform = false; break }
    }
    if (uniform) {
      this._uniformH = first
      this.totalHeight = this.totalRows * this._uniformH
      this._offsets = null
    } else {
      this._uniformH = 0
      const offsets = new Float64Array(this.totalRows + 1)
      let y = 0
      for (let i = 0; i < this.totalRows; i++) {
        offsets[i] = y
        y += heightAt(i)
      }
      offsets[this.totalRows] = y
      this.totalHeight = y
      this._offsets = offsets
    }
  }

  /** Y position of a row's top edge. */
  rowY(rowIndex: number): number {
    if (rowIndex < 0) return 0
    if (rowIndex >= this.totalRows) return this.totalHeight
    if (this._uniformH > 0) return rowIndex * this._uniformH
    return this._offsets![rowIndex]
  }

  /** Height of a specific row. */
  rowH(rowIndex: number): number {
    if (rowIndex < 0 || rowIndex >= this.totalRows) return 0
    if (this._uniformH > 0) return this._uniformH
    return this._offsets![rowIndex + 1] - this._offsets![rowIndex]
  }

  /**
   * The (fractional) base at pixel Y, interpolating within the row.
   *
   * Rows differ in height with their annotation lanes, so scroll fraction
   * and base fraction disagree wherever features are dense; anything that
   * maps between the two (the minimap) must go through these.
   */
  baseAtY(y: number, basesPerRow: number, seqLen: number): number {
    if (this.totalRows === 0 || y >= this.totalHeight) return seqLen
    const row = this.rowAtY(y)
    const h = this.rowH(row)
    const frac = h > 0 ? Math.max(0, Math.min(1, (y - this.rowY(row)) / h)) : 0
    return Math.min(seqLen, (row + frac) * basesPerRow)
  }

  /** Pixel Y of a (fractional) base; the inverse of baseAtY. */
  yAtBase(base: number, basesPerRow: number): number {
    if (this.totalRows === 0 || basesPerRow <= 0) return 0
    const row = Math.min(this.totalRows - 1, Math.max(0, Math.floor(base / basesPerRow)))
    const frac = Math.max(0, Math.min(1, base / basesPerRow - row))
    return this.rowY(row) + frac * this.rowH(row)
  }

  /** Find which row contains pixel Y. O(1) for uniform, O(log n) for non-uniform. */
  rowAtY(y: number): number {
    if (y <= 0) return 0
    if (y >= this.totalHeight) return this.totalRows - 1
    if (this._uniformH > 0) return Math.min(Math.floor(y / this._uniformH), this.totalRows - 1)
    // Binary search on cumulative offsets
    const offsets = this._offsets!
    let lo = 0, hi = this.totalRows - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (offsets[mid] <= y) lo = mid
      else hi = mid - 1
    }
    return lo
  }
}

export function baseX(i: number, rowStart: number, L: ZoomLayout): number {
  const col = i - rowStart
  if (L.groupGap === 0) return L.leftMargin + col * L.bpWidth
  return L.leftMargin + col * L.bpWidth + Math.floor(col / L.basesPerGroup) * L.groupGap
}


