import { describe, it, expect } from 'vitest'
import { computeGcSeries, findMethylationSites, GC_WINDOWS } from './gc'

describe('computeGcSeries', () => {
  it('returns nothing for a sequence shorter than the window count', () => {
    expect(computeGcSeries('ATGC')).toBeNull()
  })

  it('samples to a fixed window count, so cost does not grow with the genome', () => {
    const short = computeGcSeries('ATGC'.repeat(200), 64)
    const long = computeGcSeries('ATGC'.repeat(200_000), 64)
    expect(short!.content).toHaveLength(64)
    expect(long!.content).toHaveLength(64)
  })

  it('reports GC content as a fraction', () => {
    const allGc = computeGcSeries('GC'.repeat(1000), 10)
    expect(allGc!.content.every(v => v === 1)).toBe(true)
    const noGc = computeGcSeries('AT'.repeat(1000), 10)
    expect(noGc!.content.every(v => v === 0)).toBe(true)
  })

  it('ignores case', () => {
    const upper = computeGcSeries('GGCCAATT'.repeat(200), 8)
    const lower = computeGcSeries('ggccaatt'.repeat(200), 8)
    expect(lower!.content).toEqual(upper!.content)
  })

  it('normalises skew so a typical plasmid is not a flat line', () => {
    // Half G-rich, half C-rich: the two halves must end up at the extremes.
    const bases = 'G'.repeat(1000) + 'C'.repeat(1000)
    const series = computeGcSeries(bases, 10)!
    expect(Math.max(...series.skew)).toBeCloseTo(1)
    expect(Math.min(...series.skew)).toBeCloseTo(-1)
  })

  it('leaves skew at zero when there is none to show', () => {
    const series = computeGcSeries('GC'.repeat(1000), 10)!
    expect(series.skew.every(v => v === 0)).toBe(true)
  })

  it('defaults to one sample per half degree', () => {
    expect(computeGcSeries('ATGC'.repeat(1000))!.content).toHaveLength(GC_WINDOWS)
  })
})

describe('findMethylationSites', () => {
  it('does no work when both flags are off', () => {
    expect(findMethylationSites('GATCCCAGG', false, false)).toEqual({ dam: [], dcm: [] })
  })

  it('finds GATC, reported at the methylated base', () => {
    expect(findMethylationSites('AAGATCAA', true, false).dam).toEqual([4])
  })

  it('finds CCWGG for both W bases', () => {
    const { dcm } = findMethylationSites('CCAGG' + 'TTT' + 'CCTGG', false, true)
    expect(dcm).toEqual([2, 10])
  })

  it('does not match CCGGG, which is not a Dcm site', () => {
    expect(findMethylationSites('CCGGG', false, true).dcm).toEqual([])
  })

  it('ignores case', () => {
    expect(findMethylationSites('aagatcaa', true, false).dam).toEqual([4])
  })

  it('finds overlapping GATC sites', () => {
    // GATCGATC has two, and a naive non-overlapping scan would miss the second.
    expect(findMethylationSites('GATCGATC', true, false).dam).toEqual([2, 6])
  })
})
