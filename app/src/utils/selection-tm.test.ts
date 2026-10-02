import { describe, it, expect } from 'vitest'
import { selectionTm, SELECTION_TM_MAX } from './selection-tm'
import { formatBasesPerRow } from '../components/sequence-view-controls'

describe('selectionTm', () => {
  it('uses the Wallace rule up to 14 bp', () => {
    // 2 °C per A/T, 4 °C per G/C
    expect(selectionTm('ATGC')).toBe(12)
    expect(selectionTm('gggggggggg')).toBe(40)
  })

  it('uses nearest-neighbour above 14 bp', () => {
    const tm = selectionTm('ATGACCATGATTACGCCAAGC')
    expect(tm).not.toBeNull()
    expect(tm!).toBeGreaterThan(40)
    expect(tm!).toBeLessThan(80)
  })

  it('gives nothing outside oligo length', () => {
    expect(selectionTm('ATG')).toBeNull()
    expect(selectionTm('A'.repeat(SELECTION_TM_MAX + 1))).toBeNull()
  })
})

describe('formatBasesPerRow', () => {
  it('writes bases below a kilobase and kilobases above', () => {
    expect(formatBasesPerRow(60)).toBe('60 bp')
    expect(formatBasesPerRow(1000)).toBe('1 kb')
    expect(formatBasesPerRow(1500)).toBe('1.5 kb')
    expect(formatBasesPerRow(15000)).toBe('15 kb')
  })
})
