/** Test helpers: a chromatogram drawn from base fractions, as a whole-plasmid service makes one. */

import type { TraceBase, TraceData } from '../io/trace'

/**
 * A trace of `bases`, one Gaussian peak per base, with a second base at
 * some positions taking `fraction` of the height there.
 */
export function pileupTrace(bases: string, minor: ReadonlyMap<number, string> = new Map(), fraction = 0.3): TraceData {
  const spacing = 10
  const n = bases.length
  const len = n * spacing + 20
  const traces: Record<TraceBase, number[]> = { A: new Array(len).fill(0), C: new Array(len).fill(0), G: new Array(len).fill(0), T: new Array(len).fill(0) }
  const peakLocations: number[] = []
  const put = (b: string, centre: number, h: number) => {
    const ch = traces[b as TraceBase]
    if (!ch) return
    for (let x = Math.max(0, centre - 6); x <= Math.min(len - 1, centre + 6); x++) ch[x] += h * Math.exp(-((x - centre) ** 2) / 8)
  }
  for (let i = 0; i < n; i++) {
    const c = 10 + i * spacing
    peakLocations.push(c)
    const m = minor.get(i)
    put(bases[i], c, m ? 1000 * (1 - fraction) : 1000)
    if (m) put(m, c, 1000 * fraction)
  }
  return {
    name: 'trace', bases, peakLocations, qualityScores: new Array(n).fill(40),
    traces: { A: traces.A.map(Math.round), C: traces.C.map(Math.round), G: traces.G.map(Math.round), T: traces.T.map(Math.round) },
    metadata: { format: 'ab1' },
  }
}
