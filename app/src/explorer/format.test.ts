import { describe, it, expect } from 'vitest'
import { formatBases, formatPercent, formatCount, meanQuality } from './format'

describe('formatBases', () => {
  it('uses bp below a thousand', () => {
    expect(formatBases(0)).toBe('0 bp')
    expect(formatBases(812)).toBe('812 bp')
    expect(formatBases(999)).toBe('999 bp')
  })

  it('switches to kb at a thousand', () => {
    expect(formatBases(1000)).toBe('1.0 kb')
    expect(formatBases(4231)).toBe('4.2 kb')
  })

  it('switches to Mb at a million', () => {
    expect(formatBases(1_400_000)).toBe('1.4 Mb')
  })
})

describe('formatPercent', () => {
  it('renders a fraction as a whole percent', () => {
    expect(formatPercent(0.9734)).toBe('97%')
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(0)).toBe('0%')
  })
})

describe('formatCount', () => {
  it('pluralises', () => {
    expect(formatCount(1, 'read')).toBe('1 read')
    expect(formatCount(2, 'read')).toBe('2 reads')
    expect(formatCount(0, 'feature')).toBe('0 features')
  })

  it('takes an explicit plural for words that do not take an s', () => {
    expect(formatCount(3, 'resolved', 'resolved')).toBe('3 resolved')
  })
})

describe('meanQuality', () => {
  it('averages the track', () => {
    expect(meanQuality([10, 20, 30])).toBe(20)
  })

  // Returning null rather than NaN is what lets the adapter drop the stat
  // instead of printing "Q NaN".
  it('returns null for an empty track', () => {
    expect(meanQuality([])).toBeNull()
  })
})
