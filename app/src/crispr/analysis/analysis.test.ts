import { describe, it, expect } from 'vitest'
import { nnls, rSquared } from './nnls'
import { decomposeTraces, findOffset, spectrumCsv, DEFAULT_DECOMPOSE, CONTROL_FIT_FLOOR } from './decompose'
import { callRead, callAlleles, conversionByPosition, alleleCsv, DEFAULT_ALLELES } from './alleles'
import type { TraceData } from '../../io/trace'

// ---------------------------------------------------------------------------
// Synthetic data
// ---------------------------------------------------------------------------

let seed = 20261010
function rnd() {
  seed ^= seed << 13; seed |= 0
  seed ^= seed >>> 17
  seed ^= seed << 5; seed |= 0
  return (seed >>> 8) / 0x1000000 + 0.5
}
function randomSequence(n: number): string {
  let out = ''
  for (let i = 0; i < n; i++) out += 'ACGT'[Math.floor(rnd() * 4) % 4]
  return out
}

const CHANNELS = ['A', 'C', 'G', 'T'] as const

/** Samples between one called base and the next, as a real run has. */
const SPACING = 12

/**
 * A trace with its peaks spaced out as a sequencer spaces them, so the peak
 * reader (which takes the tallest sample near each call) reads back exactly
 * the heights given here instead of borrowing from the next base.
 * `heights[i][c]` is channel c at base i.
 */
function traceFrom(bases: string, heights: number[][]): TraceData {
  const samples = bases.length * SPACING
  const traces = {
    A: new Array<number>(samples).fill(0),
    C: new Array<number>(samples).fill(0),
    G: new Array<number>(samples).fill(0),
    T: new Array<number>(samples).fill(0),
  }
  const peakLocations: number[] = []
  for (let i = 0; i < bases.length; i++) {
    const at = i * SPACING + SPACING / 2
    peakLocations.push(at)
    CHANNELS.forEach((ch, c) => {
      const height = heights[i]?.[c] ?? 0
      if (height === 0) return
      // A narrow peak, well inside its own base's share of the run.
      traces[ch][at] = height
      traces[ch][at - 1] = height * 0.6
      traces[ch][at + 1] = height * 0.6
    })
  }
  return {
    name: 'synthetic',
    bases,
    peakLocations,
    qualityScores: Array.from({ length: bases.length }, () => 40),
    traces,
    metadata: { averageSpacing: SPACING } as TraceData['metadata'],
  }
}

/** A clean trace of a sequence: one tall channel per base. */
function cleanTrace(sequence: string): TraceData {
  const heights = [...sequence].map(base => {
    const row = [0, 0, 0, 0]
    const c = CHANNELS.indexOf(base as typeof CHANNELS[number])
    if (c >= 0) row[c] = 1000
    return row
  })
  return traceFrom(sequence, heights)
}

/**
 * A mixture: the same sequence read at several offsets at once, which is
 * what an edited pool gives after the cut.
 */
function mixedTrace(sequence: string, cut: number, mixture: { size: number; fraction: number }[]): TraceData {
  const clean = cleanTrace(sequence)
  const heights: number[][] = []
  for (let i = 0; i < sequence.length; i++) {
    const row = [0, 0, 0, 0]
    if (i < cut) {
      const c = CHANNELS.indexOf(sequence[i] as typeof CHANNELS[number])
      if (c >= 0) row[c] = 1000
    } else {
      for (const part of mixture) {
        const j = i + part.size
        if (j < 0 || j >= sequence.length) continue
        const c = CHANNELS.indexOf(sequence[j] as typeof CHANNELS[number])
        if (c >= 0) row[c] += 1000 * part.fraction
      }
    }
    heights.push(row)
  }
  return { ...traceFrom(sequence, heights), name: 'edited', bases: clean.bases }
}

// ---------------------------------------------------------------------------

describe('non-negative least squares', () => {
  it('recovers a mixture of columns', () => {
    const a = Float64Array.from([1, 0, 0, 1])
    const b = Float64Array.from([0, 1, 1, 0])
    const observed = Float64Array.from([0.3, 0.7, 0.7, 0.3])
    const x = nnls([a, b], observed)
    expect(x[0]).toBeCloseTo(0.3, 5)
    expect(x[1]).toBeCloseTo(0.7, 5)
  })

  it('never returns a negative part', () => {
    const a = Float64Array.from([1, 1, 1])
    const b = Float64Array.from([1, 0, 0])
    // The best unconstrained fit for this wants a negative b.
    const x = nnls([a, b], Float64Array.from([0, 1, 1]))
    for (const v of x) expect(v).toBeGreaterThanOrEqual(0)
  })

  it('measures how much of the variation a fit explains', () => {
    const observed = Float64Array.from([1, 2, 3, 4])
    expect(rSquared(observed, observed)).toBe(1)
    expect(rSquared(observed, Float64Array.from([2.5, 2.5, 2.5, 2.5]))).toBe(0)
  })
})

describe('taking an edited trace apart', () => {
  const sequence = randomSequence(400)
  const cut = 150

  it('calls a clean control unedited', () => {
    const control = cleanTrace(sequence)
    const result = decomposeTraces(control, cleanTrace(sequence), cut)!
    expect(result).not.toBeNull()
    expect(result.edited).toBeLessThan(0.02)
    expect(result.spectrum.find(s => s.size === 0)?.fraction).toBeGreaterThan(0.98)
    expect(result.fit).toBeGreaterThan(0.99)
    expect(result.controlFit).toBeGreaterThan(0.99)
  })

  it('recovers the shares of a known mixture', () => {
    const mixture = [
      { size: 0, fraction: 0.4 },
      { size: -1, fraction: 0.35 },
      { size: 2, fraction: 0.25 },
    ]
    const result = decomposeTraces(cleanTrace(sequence), mixedTrace(sequence, cut, mixture), cut)!
    const share = (size: number) => result.spectrum.find(s => s.size === size)?.fraction ?? 0
    expect(share(0)).toBeCloseTo(0.4, 1)
    expect(share(-1)).toBeCloseTo(0.35, 1)
    expect(share(2)).toBeCloseTo(0.25, 1)
    expect(result.edited).toBeCloseTo(0.6, 1)
    expect(result.fit).toBeGreaterThan(0.9)
  })

  it('counts only the lengths that shift the frame as frameshifts', () => {
    const result = decomposeTraces(
      cleanTrace(sequence),
      mixedTrace(sequence, cut, [
        { size: 0, fraction: 0.2 },
        { size: 3, fraction: 0.4 },
        { size: 1, fraction: 0.4 },
      ]),
      cut,
    )!
    // The 3 is in frame, the 1 is not.
    expect(result.frameshift).toBeCloseTo(0.4, 1)
    expect(result.edited).toBeCloseTo(0.8, 1)
  })

  it('finds a trace that starts at a different place', () => {
    const control = cleanTrace(sequence)
    const shifted = cleanTrace(sequence.slice(7))
    const { offset, agreement } = findOffset(control, shifted, cut, 70)
    expect(offset).toBe(-7)
    expect(agreement).toBeGreaterThan(0.95)
  })

  it('says when the two traces disagree before the cut', () => {
    const other = randomSequence(400)
    const result = decomposeTraces(cleanTrace(sequence), cleanTrace(other), cut)
    expect(result).not.toBeNull()
    expect(result!.controlFit).toBeLessThan(CONTROL_FIT_FLOOR)
    expect(result!.warnings.some(w => /disagree before the cut/.test(w))).toBe(true)
  })

  it('refuses a cut with too little sequence after it', () => {
    expect(decomposeTraces(cleanTrace(sequence), cleanTrace(sequence), 395)).toBeNull()
    expect(decomposeTraces(cleanTrace(sequence), cleanTrace(sequence), 0)).toBeNull()
  })

  it('models only as far as it is asked to', () => {
    const result = decomposeTraces(cleanTrace(sequence), cleanTrace(sequence), cut, {
      ...DEFAULT_DECOMPOSE, maxIndel: 3,
    })!
    expect(result.spectrum.map(s => s.size)).toEqual([-3, -2, -1, 0, 1, 2, 3])
  })

  it('writes the spectrum out, biggest share first', () => {
    const result = decomposeTraces(
      cleanTrace(sequence),
      mixedTrace(sequence, cut, [{ size: 0, fraction: 0.3 }, { size: -2, fraction: 0.7 }]),
      cut,
    )!
    const lines = spectrumCsv(result).split('\n')
    expect(lines[0]).toBe('indel,share')
    expect(lines[1].startsWith('-2,')).toBe(true)
  })
})

describe('calling alleles from reads', () => {
  const amplicon = randomSequence(300)
  const cut = 150
  const unedited = amplicon
  const deletion = amplicon.slice(0, cut - 2) + amplicon.slice(cut + 1)       // 3 bases gone
  const insertion = amplicon.slice(0, cut) + 'TTTT' + amplicon.slice(cut)     // 4 in
  const inFrame = amplicon.slice(0, cut - 1) + amplicon.slice(cut + 2)        // 3 gone, in frame
  const oneGone = amplicon.slice(0, cut) + amplicon.slice(cut + 1)            // 1 gone, out of frame
  const substituted = amplicon.slice(0, cut) + (amplicon[cut] === 'A' ? 'C' : 'A') + amplicon.slice(cut + 1)

  it('calls each kind of read', () => {
    expect(callRead(unedited, amplicon, cut)).toMatchObject({ kind: 'unmodified', indel: 0 })
    expect(callRead(deletion, amplicon, cut)).toMatchObject({ kind: 'deletion', indel: -3 })
    expect(callRead(insertion, amplicon, cut)).toMatchObject({ kind: 'insertion', indel: 4 })
    expect(callRead(substituted, amplicon, cut)).toMatchObject({ kind: 'substitution', indel: 0, substitutions: 1 })
  })

  it('ignores a change outside the window', () => {
    const farAway = amplicon.slice(0, 10) + 'TTTTT' + amplicon.slice(10)
    expect(callRead(farAway, amplicon, cut)).toMatchObject({ kind: 'unmodified' })
  })

  it('throws out a read too short to span the window', () => {
    expect(callRead(amplicon.slice(0, 10), amplicon, cut)).toEqual({ skip: 'tooShort' })
  })

  it('throws out a read that is not this amplicon', () => {
    expect(callRead(randomSequence(300), amplicon, cut)).toEqual({ skip: 'unaligned' })
  })

  it('groups reads into alleles with their shares', () => {
    const reads = [
      ...Array(50).fill(unedited),
      ...Array(30).fill(deletion),
      ...Array(20).fill(insertion),
    ]
    const table = callAlleles(reads, amplicon, cut)
    expect(table.counted).toBe(100)
    expect(table.alleles).toHaveLength(3)
    expect(table.alleles[0].kind).toBe('unmodified')
    expect(table.alleles[0].fraction).toBeCloseTo(0.5, 2)
    expect(table.edited).toBeCloseTo(0.5, 2)
    expect(table.spectrum.map(s => s.size).sort((a, b) => a - b)).toEqual([-3, 0, 4])
  })

  it('counts a frameshift only when the length change makes one', () => {
    const table = callAlleles(
      [...Array(10).fill(inFrame), ...Array(10).fill(oneGone), ...Array(10).fill(unedited)],
      amplicon, cut,
    )
    expect(table.edited).toBeCloseTo(2 / 3, 2)
    // Three bases out keeps the frame; one base out does not.
    expect(table.frameshift).toBeCloseTo(1 / 3, 2)
  })

  it('counts reads carrying the donor as their own allele', () => {
    const payload = 'GGATCCGGATCC'
    const knockIn = amplicon.slice(0, cut) + payload + amplicon.slice(cut)
    const table = callAlleles(
      [...Array(20).fill(knockIn), ...Array(80).fill(unedited)],
      amplicon, cut, { ...DEFAULT_ALLELES, window: 30 }, payload,
    )
    expect(table.donor).toBeCloseTo(0.2, 2)
    expect(table.alleles.some(a => a.kind === 'donor')).toBe(true)
  })

  it('reports what it threw out', () => {
    const table = callAlleles([unedited, 'ACGT', randomSequence(300)], amplicon, cut)
    expect(table.counted).toBe(1)
    expect(table.skipped.tooShort).toBe(1)
    expect(table.skipped.unaligned).toBe(1)
  })

  it('keeps only as many alleles as asked, while the totals count them all', () => {
    const reads = Array.from({ length: 12 }, (_, i) =>
      amplicon.slice(0, cut) + 'T'.repeat(i + 1) + amplicon.slice(cut))
    const table = callAlleles(reads, amplicon, cut, { ...DEFAULT_ALLELES, keep: 3 })
    expect(table.alleles).toHaveLength(3)
    expect(table.counted).toBe(12)
    expect(table.edited).toBeCloseTo(1, 5)
  })

  it('writes the alleles out as a table', () => {
    const table = callAlleles([unedited, deletion], amplicon, cut)
    const lines = alleleCsv(table).trimEnd().split('\n')
    expect(lines[0]).toBe('kind,indel,substitutions,reads,share,sequence')
    expect(lines).toHaveLength(3)
  })
})

describe('conversion by position', () => {
  const amplicon = randomSequence(120)
  const cut = 60

  it('finds where reads differ from the reference, and how often', () => {
    const target = cut - 5
    const from = amplicon[target]
    const to = from === 'C' ? 'T' : 'C'
    const edited = amplicon.slice(0, target) + to + amplicon.slice(target + 1)
    const rows = conversionByPosition(
      [...Array(3).fill(edited), ...Array(1).fill(amplicon)],
      amplicon, cut, { ...DEFAULT_ALLELES, window: 20 },
    )
    const row = rows.find(r => r.position === target)!
    expect(row.reference).toBe(from)
    expect(row.converted[to]).toBeCloseTo(0.75, 2)
    expect(row.depth).toBe(4)
  })

  it('says nothing changed where nothing changed', () => {
    const rows = conversionByPosition([amplicon, amplicon], amplicon, cut)
    expect(rows.every(r => Object.keys(r.converted).length === 0)).toBe(true)
    expect(rows.every(r => r.depth === 2)).toBe(true)
  })
})
