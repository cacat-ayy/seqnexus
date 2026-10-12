import { describe, it, expect } from 'vitest'
import { EVALUES, MAX_HITS, evalueParam, maxHitsParam, taxidIn } from './params'

describe('evalueParam', () => {
  it('writes an accepted threshold as EMBL-EBI does', () => {
    expect(evalueParam(10)).toBe('10')
    expect(evalueParam(1e-5)).toBe('1e-5')
    expect(evalueParam(0.1)).toBe('1e-1')
    expect(evalueParam(1)).toBe('1.0')
  })

  it('takes the closest accepted threshold for anything else', () => {
    expect(evalueParam(3e-6)).toBe('1e-5')
    expect(evalueParam(1e-30)).toBe('1e-50')
    expect(EVALUES).toContain(evalueParam(42))
  })
})

describe('maxHitsParam', () => {
  it('rounds up to a number EMBL-EBI accepts, capped at its largest', () => {
    expect(maxHitsParam(50)).toBe(50)
    expect(maxHitsParam(25)).toBe(50)
    expect(maxHitsParam(5000)).toBe(MAX_HITS[MAX_HITS.length - 1])
  })
})

describe('taxidIn', () => {
  it('reads a bare number or a "(taxid:N)" as a taxid, and a name as none', () => {
    expect(taxidIn('562')).toBe('562')
    expect(taxidIn('Escherichia coli (taxid:562)')).toBe('562')
    expect(taxidIn('Escherichia coli')).toBeNull()
  })
})
