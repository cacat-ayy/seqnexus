import { describe, it, expect } from 'vitest'
import { enzymeGroupKey, type GroupedCutSite } from './SequenceView'

const group = (label: string, recognitionStart: number): GroupedCutSite => ({
  sites: [],
  recognitionStart,
  recognitionEnd: recognitionStart + 6,
  label,
  fwdCut: recognitionStart + 1,
  methEffect: null,
})

describe('enzymeGroupKey', () => {
  it('is stable across separately-built objects for the same site', () => {
    // Grouped sites are rebuilt on every enzyme scan, so identity comparison
    // would restart the hover delay on each rescan.
    expect(enzymeGroupKey(group('EcoRI', 42))).toBe(enzymeGroupKey(group('EcoRI', 42)))
  })

  it('distinguishes the same enzyme at different positions', () => {
    expect(enzymeGroupKey(group('EcoRI', 42))).not.toBe(enzymeGroupKey(group('EcoRI', 43)))
  })

  it('distinguishes different enzymes at the same position', () => {
    expect(enzymeGroupKey(group('EcoRI', 42))).not.toBe(enzymeGroupKey(group('BamHI', 42)))
  })

  it('keeps isoschizomer groups distinct from single enzymes', () => {
    expect(enzymeGroupKey(group('EcoRI', 10))).not.toBe(enzymeGroupKey(group('EcoRI/Bsp68I', 10)))
  })
})
