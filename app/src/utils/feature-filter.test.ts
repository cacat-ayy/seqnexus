import { describe, it, expect } from 'vitest'
import { Annotation, type AnnotationData } from '../models/Annotation'
import { isEmptyQuery, matchesFeatureQuery, parseFeatureQuery } from './feature-filter'

const ann = (data: Partial<AnnotationData>) => new Annotation({
  id: 'a', name: 'lacZ alpha', type: 'CDS', start: 100, end: 400, strand: 1, ...data,
})
const match = (q: string, a: Annotation, seqLen = 1000) => matchesFeatureQuery(a, parseFeatureQuery(q), seqLen)

describe('parseFeatureQuery', () => {
  it('reads words, quoted phrases and terms', () => {
    expect(parseFeatureQuery('Lac "operon x" type:CDS strand:- len>500')).toEqual({
      words: ['lac', 'operon x'], types: ['cds'], strand: -1, minLen: 501, maxLen: null,
    })
  })

  it('reads lengths with k, ranges and every comparison', () => {
    expect(parseFeatureQuery('len<=1.5k')).toMatchObject({ minLen: null, maxLen: 1500 })
    expect(parseFeatureQuery('length:1k-100')).toMatchObject({ minLen: 100, maxLen: 1000 })
    expect(parseFeatureQuery('len=300')).toMatchObject({ minLen: 300, maxLen: 300 })
    expect(parseFeatureQuery('len<10')).toMatchObject({ maxLen: 9 })
  })

  it('keeps a term it cannot read as a word, so a typo matches nothing', () => {
    expect(parseFeatureQuery('len>abc strand:up').words).toEqual(['len>abc', 'strand:up'])
    expect(match('len>abc', ann({}))).toBe(false)
  })

  it('knows an empty query', () => {
    expect(isEmptyQuery(parseFeatureQuery('   '))).toBe(true)
    expect(isEmptyQuery(parseFeatureQuery('strand:none'))).toBe(false)
  })
})

describe('matchesFeatureQuery', () => {
  it('matches words against name, type and qualifiers, all of them', () => {
    const a = ann({ qualifiers: { product: ['beta-galactosidase'] } })
    expect(match('lacz galacto', a)).toBe(true)
    expect(match('lacz bla', a)).toBe(false)
    expect(match('cds', a)).toBe(true)
  })

  it('filters by type fragment, strand and span', () => {
    const a = ann({ type: 'misc_feature', strand: -1 })
    expect(match('type:misc', a)).toBe(true)
    expect(match('type:cds type:misc', a)).toBe(true)
    expect(match('type:cds', a)).toBe(false)
    expect(match('strand:rev', a)).toBe(true)
    expect(match('strand:+', a)).toBe(false)
    expect(match('len:300', a)).toBe(true)
    expect(match('len>300', a)).toBe(false)
  })

  it('measures a feature across the origin by its wrapped span', () => {
    expect(match('len:150', ann({ start: 900, end: 50 }))).toBe(true)
  })
})
