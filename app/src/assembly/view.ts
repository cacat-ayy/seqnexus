/**
 * How a contig is shown. Kept per contig (it is part of the saved item) but
 * not part of its undo history.
 */

import { DEFAULT_CONSENSUS, type ConsensusSettings } from './consensus'
import { DEFAULT_VARIANT_SETTINGS, type VariantSettings } from './variants'

/** Column widths in pixels; letters are drawn from LETTER_MIN up. */
export const CONTIG_ZOOM = [2, 3, 4, 6, 8, 10, 12, 14, 17, 20] as const
export const CONTIG_LETTER_MIN = 8

export interface ContigView {
  zoom: number
  /** Draw each read's trace under its row. */
  traces: boolean
  /** Trace strip height in pixels. */
  traceHeight: number
  consensus: ConsensusSettings
  /** Mark read bases that differ from the consensus (or the reference). */
  highlight: 'consensus' | 'reference' | 'none'
  /** Shade low-quality bases. */
  quality: boolean
  translate: boolean
  frame: 0 | 1 | 2
  /** Draw the reference sequence's features under it. */
  features: boolean
  variants: VariantSettings
}

export const DEFAULT_CONTIG_VIEW: ContigView = {
  zoom: 7,
  traces: true,
  traceHeight: 56,
  consensus: DEFAULT_CONSENSUS,
  highlight: 'consensus',
  quality: true,
  translate: false,
  frame: 0,
  features: true,
  variants: DEFAULT_VARIANT_SETTINGS,
}

/** A saved view read back, with anything missing or out of range set to the default. */
export function sanitizeContigView(v: unknown): ContigView {
  const d = DEFAULT_CONTIG_VIEW
  if (!v || typeof v !== 'object') return d
  const x = v as Partial<ContigView>
  const c = (x.consensus ?? {}) as Partial<ConsensusSettings>
  return {
    zoom: typeof x.zoom === 'number' ? Math.max(0, Math.min(CONTIG_ZOOM.length - 1, Math.round(x.zoom))) : d.zoom,
    traces: typeof x.traces === 'boolean' ? x.traces : d.traces,
    traceHeight: typeof x.traceHeight === 'number' ? Math.max(30, Math.min(200, x.traceHeight)) : d.traceHeight,
    consensus: {
      method: c.method === 'majority' ? 'majority' : 'quality',
      ambiguity: typeof c.ambiguity === 'number' ? Math.max(0, Math.min(0.5, c.ambiguity)) : 0,
    },
    highlight: x.highlight === 'reference' || x.highlight === 'none' ? x.highlight : 'consensus',
    quality: typeof x.quality === 'boolean' ? x.quality : d.quality,
    translate: typeof x.translate === 'boolean' ? x.translate : d.translate,
    frame: x.frame === 1 || x.frame === 2 ? x.frame : 0,
    features: typeof x.features === 'boolean' ? x.features : d.features,
    variants: sanitizeVariants(x.variants),
  }
}

function sanitizeVariants(v: unknown): VariantSettings {
  const d = DEFAULT_VARIANT_SETTINGS
  if (!v || typeof v !== 'object') return d
  const x = v as Partial<VariantSettings>
  const num = (n: unknown, lo: number, hi: number, def: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def)
  return {
    minCoverage: Math.round(num(x.minCoverage, 1, 1000, d.minCoverage)),
    minFrequency: num(x.minFrequency, 0, 1, d.minFrequency),
    maxPValue: num(x.maxPValue, 1e-12, 1, d.maxPValue),
    codingOnly: typeof x.codingOnly === 'boolean' ? x.codingOnly : d.codingOnly,
    excludeStrandBias: typeof x.excludeStrandBias === 'boolean' ? x.excludeStrandBias : d.excludeStrandBias,
  }
}
