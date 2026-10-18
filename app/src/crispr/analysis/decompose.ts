/**
 * What happened at the cut, from two chromatograms.
 *
 * An edited pool is a mixture: most molecules carry one of a handful of
 * small insertions or deletions, and the rest are untouched. Downstream of
 * the break the trace is therefore the sum of the same sequence read at
 * several different offsets, which looks like noise and is not. Given the
 * same amplicon from an unedited control, the mixture can be taken apart:
 * for every offset, how much of the edited signal is the control shifted by
 * that much?
 *
 * The steps, in order:
 *
 * 1. Line the two traces up on their base calls before the cut, where they
 *    should be identical, and say how well they agree. If they do not, the
 *    comparison is not valid and no amount of fitting will make it so.
 * 2. Over a window after the cut, build one column per candidate offset from
 *    the control, and fit the edited signal as a non-negative mixture of
 *    them (see nnls.ts).
 * 3. Report the mixture as a spectrum, with the share that shifts the
 *    reading frame and the quality of the fit.
 *
 * What this does not do: separate two different indels of the same length,
 * or say anything about which allele is which. It reports lengths and their
 * shares, which is what a trace can support.
 */

import { peakTable } from '../../sanger/peaks'
import type { TraceData } from '../../io/trace'
import { nnls, rSquared } from './nnls'

export interface DecomposeSettings {
  /** Largest insertion and deletion modelled, in bases. */
  maxIndel: number
  /** Bases before the cut used to check that the traces agree. */
  controlWindow: number
  /** Bases after the cut used for the fit. */
  decomposeWindow: number
  /** Bases right after the cut to leave out, where the trace is worst. */
  skipAfterCut: number
}

export const DEFAULT_DECOMPOSE: DecomposeSettings = {
  maxIndel: 10,
  controlWindow: 70,
  decomposeWindow: 90,
  skipAfterCut: 0,
}

/** Below this, the two traces disagree before the cut and nothing follows. */
export const CONTROL_FIT_FLOOR = 0.8

export interface IndelShare {
  /** Negative for a deletion, positive for an insertion, 0 for unedited. */
  size: number
  /** Share of the signal, 0 to 1. */
  fraction: number
}

export interface DecomposeResult {
  spectrum: IndelShare[]
  /** Everything that is not the unedited peak. */
  edited: number
  /** Share of the whole mixture whose length is not a multiple of three. */
  frameshift: number
  /** Fit of the mixture over the window after the cut. */
  fit: number
  /** Agreement between the two traces before the cut. */
  controlFit: number
  /** Where the control trace was read, in its own base coordinates. */
  window: { start: number; end: number }
  /** Offset of the edited trace against the control, in bases. */
  offset: number
  warnings: string[]
}

/** Per-base channel heights, scaled so the mean base sums to one. */
function normalised(trace: TraceData, from: number, to: number): Float64Array {
  const table = peakTable(trace)
  const n = Math.max(0, to - from)
  const out = new Float64Array(n * 4)
  let total = 0
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 4; c++) {
      const v = table.heights[(from + i) * 4 + c] ?? 0
      out[i * 4 + c] = v
      total += v
    }
  }
  const mean = n > 0 ? total / n : 0
  if (mean > 0) for (let i = 0; i < out.length; i++) out[i] /= mean
  return out
}

/**
 * How far the edited trace is shifted against the control, found on the base
 * calls before the cut. The two are the same amplicon, so they differ only
 * by where the read began.
 */
export function findOffset(control: TraceData, edited: TraceData, cut: number, window: number): { offset: number; agreement: number } {
  const from = Math.max(0, cut - window)
  const to = Math.min(control.bases.length, cut)
  const ref = control.bases.slice(from, to).toUpperCase()
  if (ref.length === 0) return { offset: 0, agreement: 0 }

  let best = 0
  let bestScore = -1
  const reach = 60
  for (let offset = -reach; offset <= reach; offset++) {
    let matched = 0
    let counted = 0
    for (let i = 0; i < ref.length; i++) {
      const j = from + i + offset
      if (j < 0 || j >= edited.bases.length) continue
      counted++
      if (edited.bases[j].toUpperCase() === ref[i]) matched++
    }
    if (counted < ref.length / 2) continue
    const score = matched / counted
    if (score > bestScore) { bestScore = score; best = offset }
  }
  return { offset: best, agreement: Math.max(0, bestScore) }
}

/**
 * Take an edited trace apart against its control.
 *
 * `cut` is the expected break, in the control trace's base coordinates.
 */
export function decomposeTraces(
  control: TraceData,
  edited: TraceData,
  cut: number,
  settings: DecomposeSettings = DEFAULT_DECOMPOSE,
): DecomposeResult | null {
  const warnings: string[] = []
  const { maxIndel, controlWindow, decomposeWindow, skipAfterCut } = settings
  if (cut <= 0 || cut >= control.bases.length) return null

  const { offset, agreement } = findOffset(control, edited, cut, controlWindow)

  // The window after the cut, with room either side for the shifts.
  const start = cut + skipAfterCut
  const end = Math.min(
    control.bases.length - maxIndel - 1,
    start + decomposeWindow,
  )
  if (end - start < 20) {
    warnings.push('Too little readable sequence after the cut to take the trace apart.')
    return null
  }
  if (offset + end + maxIndel >= edited.bases.length) {
    warnings.push('The edited trace ends before the window does; the fit uses what there is.')
  }

  // Before the cut the two should be the same trace.
  const controlBefore = normalised(control, Math.max(0, cut - controlWindow), cut)
  const editedBefore = normalised(edited, Math.max(0, cut - controlWindow) + offset, cut + offset)
  const controlFit = rSquared(controlBefore, editedBefore)
  if (controlFit < CONTROL_FIT_FLOOR) {
    warnings.push(
      'The two traces disagree before the cut, where they should be identical. '
      + 'Check that they are the same amplicon and that the cut is where you think.',
    )
  }
  if (agreement < 0.9) {
    warnings.push('The base calls before the cut match poorly, so the alignment of the two traces is uncertain.')
  }

  // One column per offset: the control, shifted.
  const rows = (end - start) * 4
  const sizes: number[] = []
  const columns: Float64Array[] = []
  for (let size = -maxIndel; size <= maxIndel; size++) {
    const shifted = normalised(control, start + size, end + size)
    if (shifted.length !== rows) continue
    sizes.push(size)
    columns.push(shifted)
  }
  const observed = normalised(edited, start + offset, end + offset)
  if (observed.length !== rows || columns.length === 0) {
    warnings.push('The edited trace does not reach across the window.')
    return null
  }

  const solution = nnls(columns, observed)
  let total = 0
  for (const v of solution) total += v
  if (total <= 0) {
    warnings.push('Nothing in the edited trace matches the control here.')
    return null
  }

  const fitted = new Float64Array(rows)
  for (let c = 0; c < columns.length; c++) {
    if (solution[c] === 0) continue
    for (let r = 0; r < rows; r++) fitted[r] += columns[c][r] * solution[c]
  }
  const fit = rSquared(observed, fitted)

  const spectrum: IndelShare[] = sizes.map((size, i) => ({ size, fraction: solution[i] / total }))
  const unedited = spectrum.find(s => s.size === 0)?.fraction ?? 0
  const frameshift = spectrum.reduce((n, s) => n + (s.size !== 0 && s.size % 3 !== 0 ? s.fraction : 0), 0)

  if (fit < 0.5) {
    warnings.push('The mixture explains little of the edited trace. Treat the shares as a hint, not a measurement.')
  }

  return {
    spectrum,
    edited: 1 - unedited,
    frameshift,
    fit,
    controlFit,
    window: { start, end },
    offset,
    warnings,
  }
}

/** The spectrum as a table, biggest share first. */
export function spectrumCsv(result: DecomposeResult): string {
  const rows = [['indel', 'share'].join(',')]
  for (const entry of [...result.spectrum].sort((a, b) => b.fraction - a.fraction)) {
    rows.push([entry.size > 0 ? `+${entry.size}` : String(entry.size), (entry.fraction * 100).toFixed(2)].join(','))
  }
  return rows.join('\n') + '\n'
}
