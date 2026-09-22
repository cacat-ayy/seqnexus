/**
 * Zoom-dependent layout for SequenceView.
 *
 * zoomLevel 0–20 → three render modes:
 *   0–6:   "line"    - thin sequence line, no individual bases
 *   7–12:  "dots"    - colored dots per base
 *   13–20: "letters" - full base letters + complement
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
  /** Height of one enzyme label tier above the ruler */
  enzymeLabelTierH: number
  /** Max number of enzyme label tiers */
  maxEnzymeTiers: number
  /** Total height reserved for enzyme labels above the ruler */
  enzymeLabelAreaH: number
}

const ZOOM_BPR = [
  15000, 10000, 6000, 4000, 2500, 1500, 1000,  // 0–6: line
  600, 400, 300, 200, 150, 100,                  // 7–12: dots
  80, 60, 50, 40, 30, 25, 20, 15,               // 13–20: letters
]

export function getRenderMode(z: number): RenderMode {
  if (z <= 6) return 'line'
  if (z <= 12) return 'dots'
  return 'letters'
}

export function getLayout(zoomLevel: number, containerWidth: number, showEnzymes = false, seqLen = 0): ZoomLayout {
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
    // Target bpWidth increases with zoom (bigger chars at higher zoom)
    const targetBpWidth = 9.6 + (z - 13) * 1.2
    basesPerRow = Math.max(10, Math.floor(available / targetBpWidth))
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
  const strandGap = mode === 'letters' ? 2 : 0
  const maxTranslationRows = mode === 'letters' ? 2 : 0
  const seqLineHeight = mode === 'letters' ? 34 : mode === 'dots' ? 8 : 4

  const enzymeLabelTierH = 14
  const maxEnzymeTiers = showEnzymes ? 3 : 0
  const enzymeLabelAreaH = maxEnzymeTiers * enzymeLabelTierH

  const rowPaddingBottom = 6
  const rowHeight = enzymeLabelAreaH + rulerHeight + seqLineHeight + annotationGap
    + 4 * (annotationRowH + annotationGap)
    + maxTranslationRows * (12 + 1) + rowPaddingBottom

  return {
    mode, basesPerRow, bpWidth, groupGap, basesPerGroup, leftMargin,
    rulerHeight, seqLineHeight, strandGap, showComplement: mode === 'letters',
    annotationRowH, annotationGap, maxAnnotationRows: 4,
    maxTranslationRows, translationRowH: 12, translationGap: 1,
    rowPaddingBottom, rowHeight,
    enzymeLabelTierH, maxEnzymeTiers, enzymeLabelAreaH,
  }
}

/** Height of a row with a specific number of annotation lanes. */
export function rowHeightForLanes(L: ZoomLayout, annLanes: number): number {
  const clampedLanes = Math.min(annLanes, L.maxAnnotationRows)
  const annArea = clampedLanes > 0
    ? L.annotationGap + clampedLanes * (L.annotationRowH + L.annotationGap)
    : 0
  return L.enzymeLabelAreaH + L.rulerHeight + L.seqLineHeight + annArea
    + L.maxTranslationRows * (L.translationRowH + L.translationGap) + L.rowPaddingBottom
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
  readonly totalRows: number
  totalHeight: number
  /** When all rows have the same height, use O(1) arithmetic. */
  private _uniformH: number
  /** Cumulative Y offsets for non-uniform case. null when uniform. */
  private _offsets: Float64Array | null

  constructor(totalRows: number) {
    this.totalRows = totalRows
    this.lanes = new Uint8Array(totalRows)
    this.totalHeight = 0
    this._uniformH = 0
    this._offsets = null
  }

  /** Build layout from lanes array. Uses O(1) uniform path when all lanes are equal. */
  build(L: ZoomLayout): void {
    // Check if all lanes are the same value
    const first = this.totalRows > 0 ? this.lanes[0] : 0
    let uniform = true
    for (let i = 1; i < this.totalRows; i++) {
      if (this.lanes[i] !== first) { uniform = false; break }
    }
    if (uniform) {
      this._uniformH = rowHeightForLanes(L, first)
      this.totalHeight = this.totalRows * this._uniformH
      this._offsets = null
    } else {
      this._uniformH = 0
      // Precompute distinct heights (lanes 0..maxAnnotationRows)
      const heightByLane: number[] = []
      for (let l = 0; l <= L.maxAnnotationRows; l++) {
        heightByLane[l] = rowHeightForLanes(L, l)
      }
      const offsets = new Float64Array(this.totalRows + 1)
      let y = 0
      for (let i = 0; i < this.totalRows; i++) {
        offsets[i] = y
        y += heightByLane[this.lanes[i]] ?? heightByLane[L.maxAnnotationRows]
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


