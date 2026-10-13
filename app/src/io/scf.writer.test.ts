import { describe, it, expect } from 'vitest'
import { parseScf, writeScf } from './scf'
import type { TraceData } from './trace'
import { buildLayout } from '../sanger/layout'
import { deleteColumns, editedTrace, insertBefore, MANUAL_QUALITY } from '../sanger/edits'

/** A read of `bases` with a peak every 10 samples and a made-up trace. */
function read(bases: string): TraceData {
  const n = bases.length * 10 + 10
  const wave = (shift: number) => Array.from({ length: n }, (_, i) => Math.round(500 + 400 * Math.sin((i + shift) / 3)))
  return {
    name: 'clone 7 F',
    bases,
    peakLocations: [...bases].map((_, i) => 10 + i * 10),
    qualityScores: [...bases].map((_, i) => 20 + i),
    traces: { A: wave(0), C: wave(1), G: wave(2), T: wave(3) },
    metadata: { machineName: '3730xl-A', lane: 12 },
  }
}

describe('writeScf', () => {
  it('writes an SCF v3 file that reads back as the same trace', () => {
    const data = read('ACGTNACGTA')
    const back = parseScf(writeScf(data))
    expect(back.name).toBe('clone 7 F')
    expect(back.bases).toBe(data.bases)
    expect(back.peakLocations).toEqual(data.peakLocations)
    expect(back.qualityScores).toEqual(data.qualityScores)
    for (const b of ['A', 'C', 'G', 'T'] as const) expect(back.traces[b]).toEqual(data.traces[b])
    expect(back.metadata).toMatchObject({ format: 'scf', machineName: '3730xl-A', lane: 12 })
  })
})

describe('editedTrace', () => {
  it('carries the calls as edited, an inserted base between its neighbours', () => {
    const data = read('ACGTA')
    let edits = insertBefore(data, [], buildLayout(data, []), 2, 'T')
    edits = deleteColumns(data, edits, buildLayout(data, edits), 4, 5)
    const t = editedTrace(data, edits)
    expect(t.bases).toBe('ACTGA')
    expect(t.peakLocations[2]).toBeGreaterThan(t.peakLocations[1])
    expect(t.peakLocations[2]).toBeLessThan(t.peakLocations[3])
    expect(t.qualityScores[2]).toBe(MANUAL_QUALITY)
    expect(parseScf(writeScf(t)).bases).toBe('ACTGA')
  })
})
