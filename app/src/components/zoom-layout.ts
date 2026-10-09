/**
 * Zoom-dependent layout for SequenceView.
 *
 * zoomLevel 0-20 → three render modes:
 *   0-6:   "line"    - thin sequence line, no individual bases
 *   7-12:  "dots"    - colored dots per base
 *   13-20: "letters" - full base letters + complement
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
}

const ZOOM_BPR = [
  15000, 10000, 6000, 4000, 2500, 1500, 1000,  // 0-6: line
  600, 400, 300, 200, 150, 100,                  // 7-12: dots
  80, 60, 50, 40, 30, 25, 20, 15,               // 13-20: letters
]

export function getRenderMode(z: number): RenderMode {
  if (z <= 6) return 'line'
  if (z <= 12) return 'dots'
  return 'letters'
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
}

/** The width a base gets at a letters zoom level; it grows with the zoom. */
export function letterCellWidth(zoomLevel: number): number {
  return 9.6 + (Math.max(13, Math.min(20, zoomLevel)) - 13) * 1.2
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
  const z = Math.max(0, Math.min(20, zoomLevel))
  const mode = getRenderMode(z)
  // Dynamic left margin based on the widest position label
  const maxLabel = seqLen > 0 ? seqLen.toLocaleString() : '99,999'
  // ~7.5px per char at 12px monospace + 16px padding (8px gap to sequence + 8px left edge)
  const labelW = maxLabel.length * 7.5 + 16
  const leftMargin = mode === 'letters' ? Math.max(70, Math.ceil(labelW)) : Math.max(50, Math.ceil(labelW))
  const available = Math.max(200, containerWidth - leftMargin - 20)
  const basesPerGroup = 10

  let basesPerRow = ZOOM_BPR[z]
  let bpWidth: number
  let groupGap: number

  if (mode === 'letters') {
    groupGap = 0
    basesPerRow = toggles.basesPerRow && toggles.basesPerRow > 0
      ? Math.round(toggles.basesPerRow)
      : Math.max(10, Math.floor(available / letterCellWidth(z)))
    bpWidth = available / basesPerRow
  } else if (mode === 'dots') {
    groupGap = 0
    bpWidth = Math.max(0.5, available / basesPerRow)
  } else {
    groupGap = 0
    bpWidth = Math.max(0.1, available / basesPerRow)
  }

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
  // 34 = two 16px letter rows plus the 2px gap between them. Dropping the
  // complement has to shrink the row, not just skip the draw, or every row
  // carries a blank strand's worth of space.
  const LETTER_ROW_H = 16
  const seqLineHeight = mode === 'letters'
    ? (showComplement ? LETTER_ROW_H * 2 + strandGap : LETTER_ROW_H)
    : mode === 'dots' ? 8 : 4

  const enzymeLabelTierH = 14
  const maxEnzymeTiers = showEnzymes ? 5 : 0
  // A bar per recognition site, in lanes where sites overlap. Not at line
  // zoom, where a six-base site is under a pixel wide.
  const siteLaneH = 3
  const maxSiteLanes = showEnzymes && mode !== 'line' ? 3 : 0
  const siteBandPad = 2

  // Zero lanes means the annotation area collapses entirely: stackAnnotations
  // places nothing, and rowHeightForLanes reserves no space for it.
  const maxAnnotationRows = wantAnnotations ? 4 : 0

  // Letter rows get a little more air: rows without features now end right
  // under the complement, and the selection handle reaches below it.
  const rowPaddingBottom = mode === 'letters' ? 10 : 6
  // A line with no cut sites: no names, no bars.
  const rowHeight = rulerHeight + seqLineHeight
    + (maxAnnotationRows > 0 ? annotationGap + maxAnnotationRows * (annotationRowH + annotationGap) : 0)
    + maxTranslationRows * (12 + 1) + rowPaddingBottom

  return {
    mode, basesPerRow, bpWidth, groupGap, basesPerGroup, leftMargin,
    rulerHeight, seqLineHeight, strandGap, showComplement,
    annotationRowH, annotationGap, maxAnnotationRows,
    maxTranslationRows, translationRowH: 12, translationGap: 1,
    rowPaddingBottom, rowHeight,
    enzymeLabelTierH, maxEnzymeTiers, siteLaneH, maxSiteLanes, siteBandPad,
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
    + clampedTranslations * (L.translationRowH + L.translationGap) + L.rowPaddingBottom
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


