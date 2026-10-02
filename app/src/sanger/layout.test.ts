import { describe, it, expect } from 'vitest'
import type { TraceData } from '../io/trace'
import type { BaseEdit } from '../store'
import {
  buildLayout, forwardRange, inTrim, KIND_DELETE, KIND_INSERT, KIND_SUBSTITUTE, posOfSample, sampleOfPos,
  trimColumns, trimForColumns,
} from './layout'

function read(bases: string, spacing = 10): TraceData {
  const n = bases.length
  const len = n * spacing + spacing
  const flat = new Array(len).fill(0)
  return {
    name: 'r', bases,
    peakLocations: [...bases].map((_, i) => spacing + i * spacing),
    qualityScores: new Array(n).fill(30),
    traces: { A: flat, C: flat, G: flat, T: flat },
    metadata: {},
  }
}

describe('read layout', () => {
  it('gives each call a column centred on its peak', () => {
    const l = buildLayout(read('ACGT'), [])
    expect(l.n).toBe(4)
    expect(l.bases).toBe('ACGT')
    expect(posOfSample(l, 10)).toBeCloseTo(0.5)
    expect(posOfSample(l, 40)).toBeCloseTo(3.5)
    // Halfway between two peaks is the column boundary.
    expect(posOfSample(l, 15)).toBeCloseTo(1)
    expect(sampleOfPos(l, 2.5)).toBeCloseTo(30)
  })

  it('gives inserted bases their own columns and spreads the trace over them', () => {
    const edits: BaseEdit[] = [
      { type: 'insert', pos: 2, offset: 0, base: 'T' },
      { type: 'insert', pos: 2, offset: 1, base: 'T' },
    ]
    const l = buildLayout(read('ACGT'), edits)
    expect(l.bases).toBe('ACTTGT')
    expect(l.kind[2]).toBe(KIND_INSERT)
    expect(l.kind[3]).toBe(KIND_INSERT)
    expect(l.origin[2]).toBe(2)
    expect(l.columnOfBase[2]).toBe(4)
    // C's peak (20) is still on C's column, G's (30) on G's.
    expect(posOfSample(l, 20)).toBeCloseTo(1.5)
    expect(posOfSample(l, 30)).toBeCloseTo(4.5)
    // The inserts share the gap evenly.
    expect(l.sample[2]).toBeCloseTo(20 + 10 / 3)
  })

  it('keeps a deleted base as a column and marks substitutions', () => {
    const edits: BaseEdit[] = [
      { type: 'delete', pos: 1, original: 'C' },
      { type: 'substitute', pos: 3, original: 'T', base: 'A' },
    ]
    const l = buildLayout(read('ACGT'), edits)
    expect(l.bases).toBe('ACGA')
    expect(l.kind[1]).toBe(KIND_DELETE)
    expect(l.kind[3]).toBe(KIND_SUBSTITUTE)
    expect(l.edited).toBe(2)
  })

  it('appends inserts past the last base', () => {
    const l = buildLayout(read('AC'), [{ type: 'insert', pos: 2, offset: 0, base: 'G' }])
    expect(l.bases).toBe('ACG')
    expect(l.origin[2]).toBe(2)
    expect(l.sample[2]).toBeGreaterThan(l.sample[1])
  })

  it('mirrors display ranges for a reversed view', () => {
    const l = buildLayout(read('ACGTA'), [])
    expect(forwardRange(l, 0, 2, true)).toEqual([3, 5])
    expect(forwardRange(l, 0, 2, false)).toEqual([0, 2])
  })

  it('counts inserts at the trim edges as kept', () => {
    const l = buildLayout(read('ACGTA'), [{ type: 'insert', pos: 1, offset: 0, base: 'G' }])
    // Columns: A G* C G T A; trim keeps bases 1..3 (C G T).
    expect(inTrim(l, 1, 1, 4)).toBe(true)
    expect(inTrim(l, 0, 1, 4)).toBe(false)
    expect(trimColumns(l, 1, 4, false)).toEqual([1, 5])
    expect(trimColumns(l, 1, 4, true)).toEqual([1, 5])
  })

  it('turns a kept column range back into trim bounds', () => {
    const l = buildLayout(read('ACGTA'), [])
    expect(trimForColumns(l, 1, 4, false, 5)).toEqual([1, 4])
    // Reversed: display columns 0..2 are forward columns 3..5.
    expect(trimForColumns(l, 0, 2, true, 5)).toEqual([3, 5])
  })
})
