import { describe, it, expect } from 'vitest'
import type { TraceData } from '../io/trace'
import type { BaseEdit, SequencingRead } from '../store'
import { clearMixedCalls, countMixedCalls, planMixedCalls } from './mixed'
import { DEFAULT_PROCESS, planRead } from './process'

/** Clean Gaussian peaks per call, plus a second peak where asked. */
function read(bases: string, second: Record<number, ['A' | 'C' | 'G' | 'T', number]> = {}): TraceData {
  const spacing = 12
  const len = bases.length * spacing + spacing
  const traces = { A: new Array(len).fill(0), C: new Array(len).fill(0), G: new Array(len).fill(0), T: new Array(len).fill(0) }
  const peaks = [...bases].map((_, i) => spacing + i * spacing)
  const bump = (ch: number[], at: number, h: number) => {
    for (let s = at - 5; s <= at + 5; s++) ch[s] += Math.round(h * Math.exp(-((s - at) ** 2) / 8))
  }
  ;[...bases].forEach((b, i) => bump(traces[b as 'A'], peaks[i], 1000))
  for (const [i, [b, h]] of Object.entries(second)) bump(traces[b], peaks[Number(i)], h)
  return { name: 'r', bases, peakLocations: peaks, qualityScores: new Array(bases.length).fill(40), traces, metadata: {} }
}

describe('mixed-base calling', () => {
  const data = read('ACGTACGTAC', { 2: ['A', 600], 5: ['T', 200], 8: ['C', 500] })

  it('calls the IUPAC code where the second peak is strong enough', () => {
    const p = planMixedCalls(data, [], 0, 10, { ratio: 0.33, keepUserEdits: true })
    expect(p.calls).toBe(2)
    expect(p.edits).toEqual([
      { type: 'substitute', pos: 2, original: 'G', base: 'R', by: 'mixed' },
      { type: 'substitute', pos: 8, original: 'A', base: 'M', by: 'mixed' },
    ])
  })

  it('only calls inside the trim', () => {
    expect(planMixedCalls(data, [], 3, 10, { ratio: 0.33, keepUserEdits: true }).calls).toBe(1)
  })

  it('replaces its own earlier calls when run again', () => {
    const first = planMixedCalls(data, [], 0, 10, { ratio: 0.15, keepUserEdits: true })
    expect(first.calls).toBe(3)
    const again = planMixedCalls(data, first.edits, 0, 10, { ratio: 0.55, keepUserEdits: true })
    expect(again.cleared).toBe(3)
    expect(again.calls).toBe(1)
    expect(countMixedCalls(again.edits)).toBe(1)
  })

  it('leaves hand edits alone unless told otherwise', () => {
    const hand: BaseEdit[] = [{ type: 'substitute', pos: 2, original: 'G', base: 'C' }]
    const kept = planMixedCalls(data, hand, 0, 10, { ratio: 0.33, keepUserEdits: true })
    expect(kept.edits.find(e => e.pos === 2)).toEqual(hand[0])
    const replaced = planMixedCalls(data, hand, 0, 10, { ratio: 0.33, keepUserEdits: false })
    expect(replaced.edits.filter(e => e.pos === 2)).toEqual([{ type: 'substitute', pos: 2, original: 'G', base: 'R', by: 'mixed' }])
  })

  it('clears mixed calls and keeps everything else', () => {
    const edits: BaseEdit[] = [
      { type: 'substitute', pos: 2, original: 'G', base: 'R', by: 'mixed' },
      { type: 'delete', pos: 4, original: 'A' },
    ]
    expect(clearMixedCalls(edits)).toEqual([edits[1]])
  })
})

describe('read plan', () => {
  const r = (data: TraceData, over: Partial<SequencingRead> = {}): SequencingRead => ({
    id: 'r1', data, createdAt: 0, trimStart: 0, trimEnd: data.bases.length, edits: [], undoStack: [], redoStack: [], ...over,
  })

  it('trims, then calls mixed bases inside the new trim', () => {
    const data = { ...read('ACGTACGTAC', { 1: ['A', 700], 6: ['T', 700] }), qualityScores: [5, 5, 5, 40, 40, 40, 40, 40, 40, 40] }
    const plan = planRead(r(data), { ...DEFAULT_PROCESS, mixed: { enabled: true, ratio: 0.33, keepUserEdits: true } })
    expect([plan.trimStart, plan.trimEnd]).toEqual([3, 10])
    expect(plan.mixedCalls).toBe(1)
    expect(plan.changed).toBe(true)
  })

  it('reports no change when there is nothing to do', () => {
    const data = read('ACGTACGTAC')
    const plan = planRead(r(data), { ...DEFAULT_PROCESS, trim: { ...DEFAULT_PROCESS.trim, method: 'keep' } })
    expect(plan.changed).toBe(false)
  })
})
