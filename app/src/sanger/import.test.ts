import { describe, it, expect } from 'vitest'
import type { TraceData } from '../io/trace'
import { batchFolderName, initialTrim, isTraceFile } from './import'

function trace(name: string, metadata: TraceData['metadata'] = {}, quality: number[] = []): TraceData {
  return {
    name,
    bases: 'A'.repeat(quality.length),
    peakLocations: [],
    qualityScores: quality,
    traces: { A: [], C: [], G: [], T: [] },
    metadata,
  }
}

describe('trace import', () => {
  it('recognises trace files by extension', () => {
    expect(isTraceFile('A01_M13F.ab1')).toBe(true)
    expect(isTraceFile('read.SCF')).toBe(true)
    expect(isTraceFile('read.abi')).toBe(true)
    expect(isTraceFile('read.fastq')).toBe(false)
  })

  it('names a batch after its plate when all reads share one', () => {
    expect(batchFolderName([trace('a', { plateName: 'Run4582' }), trace('b', { plateName: 'Run4582' })])).toBe('Run4582')
  })

  it('otherwise names it after the common file-name prefix', () => {
    expect(batchFolderName([trace('pCAG-GFP_A01_F'), trace('pCAG-GFP_A02_R')])).toBe('pCAG-GFP_A0')
    expect(batchFolderName([trace('clone3_F'), trace('clone3_R')])).toBe('clone3')
  })

  it('falls back to a dated name', () => {
    expect(batchFolderName([trace('x1'), trace('y2')], new Date('2026-10-01T12:00:00Z'))).toBe('Sanger reads 2026-10-01')
  })

  it('quality-trims a new read', () => {
    const q = [...new Array(15).fill(5), ...new Array(200).fill(40), ...new Array(30).fill(5)]
    expect(initialTrim(trace('r', {}, q))).toEqual([15, 215])
  })

  // Trimming on an all-zero quality track would throw the whole read away.
  it('leaves a read without qualities untrimmed', () => {
    expect(initialTrim(trace('r', { qualityMissing: true }, new Array(300).fill(0)))).toEqual([0, 300])
  })
})
