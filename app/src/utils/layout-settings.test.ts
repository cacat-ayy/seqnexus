import { describe, it, expect, beforeEach } from 'vitest'
import { loadLayoutSettings, saveLayoutSettings, DEFAULT_LAYOUT_SETTINGS } from './layout-settings'
import { STORAGE_KEYS } from '../storage/keys'

describe('layout settings', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to the toolbar on top and the panel on the right', () => {
    expect(loadLayoutSettings()).toEqual({ toolbar: 'top', panel: 'right' })
    expect(DEFAULT_LAYOUT_SETTINGS).toEqual({ toolbar: 'top', panel: 'right' })
  })

  it('round-trips what was saved', () => {
    saveLayoutSettings({ toolbar: 'left', panel: 'bottom' })
    expect(loadLayoutSettings()).toEqual({ toolbar: 'left', panel: 'bottom' })
  })

  it('falls back field by field on stray or broken values', () => {
    localStorage.setItem(STORAGE_KEYS.layout, JSON.stringify({ toolbar: 'right', panel: 'bottom' }))
    expect(loadLayoutSettings()).toEqual({ toolbar: 'top', panel: 'bottom' })
    localStorage.setItem(STORAGE_KEYS.layout, '{not json')
    expect(loadLayoutSettings()).toEqual(DEFAULT_LAYOUT_SETTINGS)
    localStorage.setItem(STORAGE_KEYS.layout, 'null')
    expect(loadLayoutSettings()).toEqual(DEFAULT_LAYOUT_SETTINGS)
  })
})
