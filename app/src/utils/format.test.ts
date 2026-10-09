import { describe, it, expect } from 'vitest'
import { formatBp, formatBytes } from './format'

describe('formatBp', () => {
  it('uses bp below a thousand', () => {
    expect(formatBp(0)).toBe('0 bp')
    expect(formatBp(812)).toBe('812 bp')
    expect(formatBp(999)).toBe('999 bp')
  })

  it('switches to kb with one decimal at a thousand', () => {
    expect(formatBp(1000)).toBe('1.0 kb')
    expect(formatBp(4231)).toBe('4.2 kb')
    expect(formatBp(12_345)).toBe('12.3 kb')
  })

  it('switches to Mbp with two decimals at a million, and Gbp at a billion', () => {
    expect(formatBp(1_400_000)).toBe('1.40 Mbp')
    expect(formatBp(248_956_422)).toBe('248.96 Mbp')
    expect(formatBp(3_200_000_000)).toBe('3.20 Gbp')
  })
})

describe('formatBytes', () => {
  it('steps through B, KB, MB and GB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(24 * 1024)).toBe('24 KB')
    expect(formatBytes(3.5 * 1024 ** 2)).toBe('3.5 MB')
    expect(formatBytes(120 * 1024 ** 2)).toBe('120 MB')
    expect(formatBytes(1.2 * 1024 ** 3)).toBe('1.2 GB')
  })
})
