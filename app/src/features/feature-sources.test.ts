/**
 * Merging feature databases into one reference list for the scan.
 */
import { describe, it, expect } from 'vitest'
import {
  getScanReferences, sourceIdForMatch, enabledSourcesSignature, customCategories,
  BUILTIN_SOURCE_ID, type FeatureSource,
} from './feature-sources'
import type { CommonFeature } from './common-features'

const feat = (over: Partial<CommonFeature> = {}): CommonFeature => ({
  name: 'AmpR', type: 'CDS', color: '#ff0000', category: 'Resistance',
  sequence: 'ATGCGTACGTAGCTAGCTAGCATCG', ...over,
})

const source = (over: Partial<FeatureSource> = {}): FeatureSource => ({
  id: 'fsrc_1', name: 'lab parts', builtin: false, enabled: true, addedAt: 1,
  features: [feat()], ...over,
})

/** Stand-in for the bundled library, so the tests do not decode 841 entries. */
const builtinStub = (features: CommonFeature[]): FeatureSource => ({
  id: BUILTIN_SOURCE_ID, name: 'built-in', builtin: true, enabled: true, addedAt: 0, features,
})

describe('getScanReferences', () => {
  it('contributes only enabled sources', () => {
    const { references } = getScanReferences([
      builtinStub([feat({ name: 'lacZ' })]),
      source({ enabled: false, features: [feat({ name: 'myPart' })] }),
    ])
    expect(references.map(r => r.name)).toEqual(['lacZ'])
  })

  it('lets a custom entry displace the built-in one with the same name and type', () => {
    const builtinSeq = 'AAAAAAAAAAAAAAAAAAAA'
    const customSeq = 'TTTTTTTTTTTTTTTTTTTT'
    const { references } = getScanReferences([
      builtinStub([feat({ sequence: builtinSeq })]),
      source({ features: [feat({ sequence: customSeq })] }),
    ])
    expect(references).toHaveLength(1)
    expect(references[0].sequence).toBe(customSeq)
  })

  it('keeps a same-named entry of a different type as its own reference', () => {
    const { references } = getScanReferences([
      builtinStub([feat()]),
      source({ features: [feat({ type: 'promoter' })] }),
    ])
    expect(references).toHaveLength(2)
  })

  it('attributes each entry to the source it came from', () => {
    const { originBySource } = getScanReferences([
      builtinStub([feat({ name: 'lacZ' })]),
      source({ id: 'fsrc_7', features: [feat({ name: 'myPart' })] }),
    ])
    expect(sourceIdForMatch({ refName: 'myPart', refType: 'CDS' }, originBySource)).toBe('fsrc_7')
    expect(sourceIdForMatch({ refName: 'lacZ', refType: 'CDS' }, originBySource)).toBe(BUILTIN_SOURCE_ID)
    expect(sourceIdForMatch({ refName: 'nope', refType: 'CDS' }, originBySource)).toBeNull()
  })

  it('drops an empty colour so the type default can apply', () => {
    const { references } = getScanReferences([source({ features: [feat({ color: '' })] })])
    expect(references[0].color).toBeUndefined()
  })
})

describe('enabledSourcesSignature', () => {
  it('changes when a source is toggled or its contents change', () => {
    const a = source()
    const base = enabledSourcesSignature([a])
    expect(enabledSourcesSignature([{ ...a, enabled: false }])).not.toBe(base)
    expect(enabledSourcesSignature([{ ...a, features: [feat(), feat({ name: 'b' })] }])).not.toBe(base)
  })

  it('ignores a rename, which does not change what is scanned', () => {
    const a = source()
    expect(enabledSourcesSignature([{ ...a, name: 'renamed' }])).toBe(enabledSourcesSignature([a]))
  })

  it('does not decode the bundled library just to build a signature', () => {
    // The signature is recomputed on every render; the real built-in source
    // decodes ~700 packed sequences the first time its features are read.
    const trap: FeatureSource = {
      id: BUILTIN_SOURCE_ID, name: 'built-in', builtin: true, enabled: true, addedAt: 0,
      get features(): CommonFeature[] { throw new Error('decoded the library') },
    }
    expect(() => enabledSourcesSignature([trap])).not.toThrow()
  })
})

describe('customCategories', () => {
  it('lists the categories custom sources bring, ignoring the built-in ones', () => {
    expect(customCategories([
      builtinStub([feat({ category: 'Resistance' })]),
      source({ features: [feat({ category: 'lab parts' }), feat({ name: 'b', category: 'lab parts' })] }),
    ])).toEqual(['lab parts'])
  })
})
