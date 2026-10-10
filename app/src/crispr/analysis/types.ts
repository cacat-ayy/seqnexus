/**
 * What an editing analysis is, whichever way it was read.
 *
 * The two routes answer the same question from different evidence, and the
 * panel shows them side by side, so they share a shape: a spectrum of length
 * changes with their shares, the headline numbers, and the provenance of the
 * reading. What only one of them can say stays on its own branch rather than
 * being flattened into a common field that is empty half the time.
 */

import type { DecomposeResult } from './decompose'
import type { AlleleTable } from './alleles'
import type { conversionByPosition } from './alleles'

export interface AnalysisSource {
  /** What was read, named for the line above the result. */
  description: string
  /** Where the break was taken to be. */
  cut: number
  /** The guide it was done for, when one was selected. */
  spacer?: string
  when: number
}

export interface TraceAnalysis {
  kind: 'traces'
  source: AnalysisSource
  result: DecomposeResult
}

export interface ReadAnalysis {
  kind: 'reads'
  source: AnalysisSource
  table: AlleleTable
  conversion: ReturnType<typeof conversionByPosition> | null
  /** Reads looked at, and how many the set holds. */
  sample: { used: number; available: number; sampled: boolean }
}

export type EditingAnalysis = TraceAnalysis | ReadAnalysis

/** The spectrum both kinds carry, in one shape for the chart. */
export function spectrumOf(analysis: EditingAnalysis): { size: number; fraction: number }[] {
  return analysis.kind === 'traces'
    ? analysis.result.spectrum.map(s => ({ size: s.size, fraction: s.fraction }))
    : analysis.table.spectrum
}

/** The headline numbers, in the order the panel shows them. */
export function headlineOf(analysis: EditingAnalysis): { label: string; value: string; title?: string }[] {
  if (analysis.kind === 'traces') {
    const r = analysis.result
    return [
      { label: 'Edited', value: `${(r.edited * 100).toFixed(1)}%`, title: 'Everything that is not the unedited peak' },
      { label: 'Frameshift', value: `${(r.frameshift * 100).toFixed(1)}%`, title: 'Share whose length is not a multiple of three' },
      { label: 'Fit', value: r.fit.toFixed(2), title: 'How much of the edited trace the mixture explains' },
      { label: 'Control fit', value: r.controlFit.toFixed(2), title: 'Agreement between the two traces before the cut' },
    ]
  }
  const t = analysis.table
  return [
    { label: 'Edited', value: `${(t.edited * 100).toFixed(1)}%`, title: 'Reads that are not the reference across the window' },
    { label: 'Frameshift', value: `${(t.frameshift * 100).toFixed(1)}%` },
    ...(t.donor > 0 ? [{ label: 'Donor', value: `${(t.donor * 100).toFixed(1)}%` }] : []),
    { label: 'Reads', value: t.counted.toLocaleString(), title: 'Reads that spanned the window and were counted' },
  ]
}
