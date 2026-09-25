import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadDisplaySettings, saveDisplaySettings, DEFAULT_DISPLAY_SETTINGS,
} from './display-settings'

const KEY = 'seqnexus:display-settings'

describe('display settings persistence', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to the app\'s existing appearance, so nothing changes on upgrade', () => {
    expect(loadDisplaySettings()).toEqual({
      colorScheme: 'nucleotide',
      colorTarget: 'letters',
      showComplement: true,
      showAnnotationTracks: true,
    })
  })

  it('round-trips a saved record', () => {
    const settings = {
      colorScheme: 'clustal' as const,
      colorTarget: 'background' as const,
      showComplement: false,
      showAnnotationTracks: false,
    }
    saveDisplaySettings(settings)
    expect(loadDisplaySettings()).toEqual(settings)
  })

  it('falls back to defaults on unparseable JSON', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadDisplaySettings()).toEqual(DEFAULT_DISPLAY_SETTINGS)
  })

  it('rejects a colour scheme id it does not recognise', () => {
    // A scheme removed in a later version must not reach the draw loop.
    localStorage.setItem(KEY, JSON.stringify({ colorScheme: 'by-translation' }))
    expect(loadDisplaySettings().colorScheme).toBe('nucleotide')
  })

  it('validates each field independently', () => {
    localStorage.setItem(KEY, JSON.stringify({
      colorScheme: 'gc-at',
      showComplement: 'yes',      // wrong type
      showAnnotationTracks: false,
    }))
    const loaded = loadDisplaySettings()
    expect(loaded.colorScheme).toBe('gc-at')            // kept
    expect(loaded.showComplement).toBe(true)            // defaulted
    expect(loaded.showAnnotationTracks).toBe(false)     // kept
  })

  it('treats a missing field as the default rather than undefined', () => {
    localStorage.setItem(KEY, JSON.stringify({ colorScheme: 'macclade' }))
    const loaded = loadDisplaySettings()
    expect(loaded.showComplement).toBe(true)
    expect(loaded.showAnnotationTracks).toBe(true)
  })

  it('returns a fresh object each time, so callers cannot mutate the defaults', () => {
    const a = loadDisplaySettings()
    a.showComplement = false
    expect(loadDisplaySettings().showComplement).toBe(true)
  })
})

describe('colour target', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to letters, preserving how the app already drew bases', () => {
    expect(loadDisplaySettings().colorTarget).toBe('letters')
  })

  it('round-trips background mode', () => {
    saveDisplaySettings({ ...DEFAULT_DISPLAY_SETTINGS, colorTarget: 'background' })
    expect(loadDisplaySettings().colorTarget).toBe('background')
  })

  it('rejects an unknown target', () => {
    localStorage.setItem(KEY, JSON.stringify({ colorTarget: 'outline' }))
    expect(loadDisplaySettings().colorTarget).toBe('letters')
  })
})
