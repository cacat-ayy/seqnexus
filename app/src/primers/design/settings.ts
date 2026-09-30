/**
 * Design settings, presets and the buffer the Tm is calculated for.
 *
 * Presets set the numbers but leave every field editable; touching a field
 * turns the preset label into "Custom" so it never claims to be something it
 * no longer is. Buffers only change the salt and oligo concentrations that
 * feed the Tm model; they are not polymerase-specific Tm calculators.
 */

import type { PrimerConstraints } from '../scoring'
import type { ProbeConstraints } from './types'

export interface DesignSettings {
  preset: PresetId | 'custom'
  minTm: number
  maxTm: number
  optTm: number
  minLen: number
  maxLen: number
  minGC: number
  maxGC: number
  maxHomopolymer: number
  minProduct: number
  maxProduct: number
  probe: boolean
  probeMinTm: number
  probeMaxTm: number
  probeOptTm: number
  buffer: BufferId | 'custom'
  /** Monovalent cations, mM. */
  naConc: number
  /** Mg²⁺, mM. */
  mgConc: number
  /** Total dNTPs, mM. */
  dntpConc: number
  /** Each oligo, nM. */
  primerConc: number
}

export type PresetId = 'standard' | 'high-gc' | 'long' | 'qpcr'
export type BufferId = 'standard' | 'high-fidelity'

type PresetFields = Pick<DesignSettings,
  'minTm' | 'maxTm' | 'optTm' | 'minLen' | 'maxLen' | 'minGC' | 'maxGC'
  | 'minProduct' | 'maxProduct' | 'probe' | 'probeMinTm' | 'probeMaxTm' | 'probeOptTm'>

export const PRESETS: { id: PresetId; label: string; hint: string; values: PresetFields }[] = [
  {
    id: 'standard', label: 'Standard PCR', hint: '150–1000 bp, Tm around 60 °C',
    values: {
      minTm: 57, maxTm: 63, optTm: 60, minLen: 18, maxLen: 25, minGC: 40, maxGC: 60,
      minProduct: 150, maxProduct: 1000, probe: false, probeMinTm: 68, probeMaxTm: 72, probeOptTm: 70,
    },
  },
  {
    id: 'high-gc', label: 'GC-rich template', hint: 'Higher Tm and GC limits',
    values: {
      minTm: 60, maxTm: 68, optTm: 64, minLen: 18, maxLen: 28, minGC: 45, maxGC: 70,
      minProduct: 150, maxProduct: 1000, probe: false, probeMinTm: 70, probeMaxTm: 76, probeOptTm: 73,
    },
  },
  {
    id: 'long', label: 'Long amplicon', hint: '1–5 kb, slightly longer primers',
    values: {
      minTm: 58, maxTm: 65, optTm: 62, minLen: 20, maxLen: 28, minGC: 40, maxGC: 60,
      minProduct: 1000, maxProduct: 5000, probe: false, probeMinTm: 68, probeMaxTm: 72, probeOptTm: 70,
    },
  },
  {
    id: 'qpcr', label: 'qPCR with probe', hint: '70–150 bp amplicon, TaqMan probe',
    values: {
      minTm: 58, maxTm: 62, optTm: 60, minLen: 18, maxLen: 24, minGC: 35, maxGC: 65,
      minProduct: 70, maxProduct: 150, probe: true, probeMinTm: 68, probeMaxTm: 72, probeOptTm: 70,
    },
  },
]

type BufferFields = Pick<DesignSettings, 'naConc' | 'mgConc' | 'dntpConc' | 'primerConc'>

export const BUFFERS: { id: BufferId; label: string; hint: string; values: BufferFields }[] = [
  {
    id: 'standard', label: 'Standard (Taq-type)',
    hint: '50 mM K⁺, 1.5 mM Mg²⁺, 0.8 mM dNTPs, 250 nM primers',
    values: { naConc: 50, mgConc: 1.5, dntpConc: 0.8, primerConc: 250 },
  },
  {
    id: 'high-fidelity', label: 'High-fidelity (Q5/Phusion-type)',
    hint: '2 mM Mg²⁺, 0.8 mM dNTPs, 500 nM primers',
    values: { naConc: 50, mgConc: 2, dntpConc: 0.8, primerConc: 500 },
  },
]

export const DEFAULT_SETTINGS: DesignSettings = {
  preset: 'standard',
  ...PRESETS[0].values,
  maxHomopolymer: 4,
  buffer: 'standard',
  ...BUFFERS[0].values,
}

export function applyPreset(s: DesignSettings, id: PresetId): DesignSettings {
  const p = PRESETS.find(x => x.id === id)
  return p ? { ...s, ...p.values, preset: id } : s
}

export function applyBuffer(s: DesignSettings, id: BufferId): DesignSettings {
  const b = BUFFERS.find(x => x.id === id)
  return b ? { ...s, ...b.values, buffer: id } : s
}

/** A manual change: the preset (or buffer) no longer describes the settings. */
export function editSettings(s: DesignSettings, patch: Partial<DesignSettings>): DesignSettings {
  const next = { ...s, ...patch }
  const touchesBuffer = ['naConc', 'mgConc', 'dntpConc', 'primerConc'].some(k => k in patch)
  const touchesPreset = Object.keys(patch).some(k => k in PRESETS[0].values)
  if (touchesBuffer) next.buffer = 'custom'
  if (touchesPreset) next.preset = 'custom'
  return next
}

export function primerConstraints(s: DesignSettings): PrimerConstraints {
  return {
    minLength: s.minLen,
    maxLength: s.maxLen,
    optLength: Math.round((s.minLen + s.maxLen) / 2),
    minTm: s.minTm,
    maxTm: s.maxTm,
    optTm: s.optTm,
    minGC: s.minGC,
    maxGC: s.maxGC,
    maxHomopolymer: s.maxHomopolymer,
    primerConc: s.primerConc,
    naConc: s.naConc,
    mgConc: s.mgConc,
    dntpConc: s.dntpConc,
  }
}

export function probeConstraints(s: DesignSettings): ProbeConstraints {
  return {
    ...primerConstraints(s),
    minLength: 18,
    maxLength: 30,
    optLength: 24,
    minTm: s.probeMinTm,
    maxTm: s.probeMaxTm,
    optTm: s.probeOptTm,
    minGC: 30,
    maxGC: 80,
  }
}

/** Anything the settings cannot run with, as a sentence; null when fine. */
export function settingsProblem(s: DesignSettings): string | null {
  if (s.minLen > s.maxLen) return 'The minimum primer length is above the maximum.'
  if (s.minLen < 10) return 'Primers need at least 10 nt to bind specifically.'
  if (s.minTm > s.maxTm) return 'The minimum Tm is above the maximum.'
  if (s.optTm < s.minTm || s.optTm > s.maxTm) return 'The optimal Tm lies outside the Tm range.'
  if (s.minProduct > s.maxProduct) return 'The minimum product size is above the maximum.'
  if (s.minGC > s.maxGC) return 'The minimum GC is above the maximum.'
  if (s.probe && s.probeMinTm > s.probeMaxTm) return 'The minimum probe Tm is above the maximum.'
  return null
}

const STORAGE_KEY = 'seqnexus:primer-design'

export function loadSettings(): DesignSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: DesignSettings): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* private mode, quota */ }
}
