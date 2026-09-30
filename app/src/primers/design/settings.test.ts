import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SETTINGS, PRESETS, applyPreset, applyBuffer, editSettings, settingsProblem,
  primerConstraints, probeConstraints,
} from './settings'

describe('design settings', () => {
  it('applies a preset\'s numbers and names it', () => {
    const s = applyPreset(DEFAULT_SETTINGS, 'qpcr')
    expect(s.preset).toBe('qpcr')
    expect(s.maxProduct).toBe(150)
    expect(s.probe).toBe(true)
  })

  it('stops claiming a preset once a preset field is edited by hand', () => {
    const s = editSettings(applyPreset(DEFAULT_SETTINGS, 'long'), { minTm: 55 })
    expect(s.preset).toBe('custom')
    expect(s.minTm).toBe(55)
  })

  it('keeps the preset when only the buffer changes, and vice versa', () => {
    const s = editSettings(DEFAULT_SETTINGS, { mgConc: 3 })
    expect(s.preset).toBe('standard')
    expect(s.buffer).toBe('custom')
    expect(applyBuffer(s, 'high-fidelity')).toMatchObject({ buffer: 'high-fidelity', mgConc: 2, primerConc: 500 })
  })

  it('names the first thing that makes the settings unusable', () => {
    expect(settingsProblem(DEFAULT_SETTINGS)).toBeNull()
    expect(settingsProblem({ ...DEFAULT_SETTINGS, minLen: 30, maxLen: 20 })).toMatch(/length/)
    expect(settingsProblem({ ...DEFAULT_SETTINGS, optTm: 70 })).toMatch(/optimal Tm/)
    expect(settingsProblem({ ...DEFAULT_SETTINGS, minProduct: 900, maxProduct: 100 })).toMatch(/product/)
  })

  it('every preset is usable as is', () => {
    for (const p of PRESETS) expect(settingsProblem(applyPreset(DEFAULT_SETTINGS, p.id))).toBeNull()
  })

  it('feeds the buffer into both primer and probe constraints', () => {
    const s = applyBuffer(DEFAULT_SETTINGS, 'high-fidelity')
    expect(primerConstraints(s).mgConc).toBe(2)
    expect(probeConstraints(s)).toMatchObject({ mgConc: 2, minTm: s.probeMinTm })
  })
})
