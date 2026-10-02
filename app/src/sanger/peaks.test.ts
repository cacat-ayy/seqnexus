import { describe, it, expect } from 'vitest'
import type { TraceData } from '../io/trace'
import { computePeakTable, secondaryRatio } from './peaks'

/** A trace with Gaussian peaks: one per call, plus optional extra peaks. */
function synth(bases: string, extra: { at: number; base: 'A' | 'C' | 'G' | 'T'; height: number }[] = []): TraceData {
  const spacing = 12
  const len = bases.length * spacing + spacing
  const traces = { A: new Array(len).fill(0), C: new Array(len).fill(0), G: new Array(len).fill(0), T: new Array(len).fill(0) }
  const add = (ch: number[], centre: number, h: number) => {
    for (let s = 0; s < len; s++) ch[s] += Math.round(h * Math.exp(-((s - centre) ** 2) / (2 * 2.5 ** 2)))
  }
  const peakLocations = [...bases].map((_, i) => spacing + i * spacing)
  ;[...bases].forEach((b, i) => add(traces[b as 'A'], peakLocations[i], 1000))
  for (const e of extra) add(traces[e.base], peakLocations[e.at], e.height)
  return { name: 't', bases, peakLocations, qualityScores: new Array(bases.length).fill(40), traces, metadata: {} }
}

describe('peak table', () => {
  it('measures the called channel as the primary peak', () => {
    const t = computePeakTable(synth('ACGT'))
    expect(t.length).toBe(4)
    expect([...t.primaryBase]).toEqual([0, 1, 2, 3])
    for (let i = 0; i < 4; i++) expect(t.primary[i]).toBe(1000)
  })

  it('finds a real secondary peak under a call', () => {
    const t = computePeakTable(synth('ACGTA', [{ at: 2, base: 'A', height: 500 }]))
    expect(t.secondaryBase[2]).toBe(0)
    expect(secondaryRatio(t, 2)).toBeCloseTo(0.5, 1)
  })

  // A neighbour's peak still rising at the window edge is a shoulder, not a
  // second peak at this call.
  it('does not count a neighbouring peak as a secondary one', () => {
    const t = computePeakTable(synth('AAGGTT'))
    for (let i = 0; i < 6; i++) expect(secondaryRatio(t, i)).toBeLessThan(0.1)
  })

  it('uses the tallest channel for an N call', () => {
    const data = synth('ACGT')
    data.bases = 'ANGT'
    const t = computePeakTable(data)
    expect(t.primaryBase[1]).toBe(1)
  })
})
