import { describe, it, expect, beforeEach } from 'vitest'
import {
  defaultLanes, suggestDigest, loadStoredWorkspace, clearStoredWorkspace, sanitizeWorkspace, migrateLegacy, autoLaneLabel, shortLadderName,
  formPresetId, FORM_PRESETS, MAX_LANES, WORKSPACE_STORAGE_KEY, LEGACY_GEL_KEY, LEGACY_DISPLAY_KEY, DEFAULT_DISPLAY,
  type ActiveSequence,
} from './workspace'
import { DEFAULT_CONDITIONS } from './model'
import { parseEnzymeList } from './parse'

const fill = (n: number) => 'ACGT'.repeat(Math.ceil(n / 4)).slice(0, n)

function plasmid(sites: [number, string][], len = 4000): string {
  let s = fill(len)
  for (const [pos, site] of sites) s = s.slice(0, pos) + site + s.slice(pos + site.length)
  return s
}

const active = (bases: string, shownEnzymes: string[], topology: 'linear' | 'circular' = 'circular'): ActiveSequence =>
  ({ id: 'tab1', bases, topology, shownEnzymes })

describe('suggestDigest', () => {
  it('picks a pair of single cutters whose fragments are both visible', () => {
    const bases = plasmid([[100, 'GAATTC'], [1500, 'GGATCC']])
    expect(suggestDigest(active(bases, ['EcoRI', 'BamHI']))).toEqual(['EcoRI', 'BamHI'])
  })

  it('falls back to one enzyme when the pair would leave a tiny fragment', () => {
    const bases = plasmid([[100, 'GAATTC'], [200, 'GGATCC']])
    expect(suggestDigest(active(bases, ['EcoRI', 'BamHI']))).toEqual(['EcoRI'])
  })

  it('ignores enzymes that cut more than once or not at all', () => {
    const bases = plasmid([[100, 'GAATTC'], [2000, 'GAATTC']])
    expect(suggestDigest(active(bases, ['EcoRI', 'HindIII']))).toEqual([])
  })

  it('counts the ends of a linear molecule as fragments too', () => {
    // Cuts at 101 and 3001 of 3100: the last piece is under 250 bp.
    const bases = plasmid([[100, 'GAATTC'], [3000, 'GGATCC']], 3100)
    expect(suggestDigest(active(bases, ['EcoRI', 'BamHI'], 'linear'))).toEqual(['EcoRI'])
  })
})

describe('defaultLanes', () => {
  it('starts with a ladder and an empty well when no sequence is open', () => {
    expect(defaultLanes(null).map(l => l.sample.kind)).toEqual(['ladder', 'empty'])
  })

  it('runs the open sequence uncut and digested with enzymes from its map', () => {
    const bases = plasmid([[100, 'GAATTC'], [1500, 'GGATCC']])
    const lanes = defaultLanes(active(bases, ['EcoRI', 'BamHI']))
    expect(lanes.map(l => l.sample.kind)).toEqual(['ladder', 'sequence', 'sequence'])
    expect(lanes[1].sample).toMatchObject({ sourceId: 'tab1', enzymes: [] })
    expect(lanes[2].sample).toMatchObject({ sourceId: 'tab1', enzymes: ['EcoRI', 'BamHI'] })
    expect(new Set(lanes.map(l => l.id)).size).toBe(3)
  })

  it('leaves the third well empty when nothing on the map cuts once', () => {
    const lanes = defaultLanes(active(fill(3000), []))
    expect(lanes[2].sample.kind).toBe('empty')
  })
})

describe('persistence', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips a workspace', () => {
    const state = {
      conditions: { ...DEFAULT_CONDITIONS, agarosePct: 2, buffer: 'TBE' as const },
      lanes: [{ id: 'a', label: 'Mine', sample: { kind: 'ladder' as const, ladderId: '100bp' } }],
      display: { ...DEFAULT_DISPLAY, look: 'inverted' as const, labelMode: 'names' as const },
    }
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state))
    expect(loadStoredWorkspace()).toEqual(state)
  })

  it('repairs out-of-range or unknown values', () => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
      conditions: { agarosePct: 10, buffer: 'XYZ', format: 'huge', dyeFront: 5 },
      lanes: Array.from({ length: 30 }, (_, i) => ({ id: `l${i}`, sample: { kind: 'bogus' } })),
      display: { look: 'neon', exposure: 9 },
    }))
    const ws = loadStoredWorkspace()!
    expect(ws.conditions).toEqual({ agarosePct: 3, buffer: 'TAE', format: 'mini', dyeFront: 1 })
    expect(ws.lanes).toHaveLength(MAX_LANES)
    expect(ws.lanes[0].sample).toEqual({ kind: 'empty' })
    expect(ws.display.look).toBe('uv')
    expect(ws.display.exposure).toBe(2)
  })

  it('migrates the old modal lane table', () => {
    localStorage.setItem(LEGACY_GEL_KEY, JSON.stringify({
      gelPct: 0.8, buffer: 'TBE', massIntensity: false,
      lanes: [
        { type: 'ladder', ladderName: '100 bp DNA Ladder' },
        { type: 'uncut', sequenceTabId: 't1', enzymeNames: [] },
        { type: 'digest', sequenceTabId: 't1', enzymeNames: ['EcoRI'] },
        { type: 'digest', sequenceTabId: 't1', enzymeNames: [] },
        { type: 'digest', sequenceTabId: '', enzymeNames: [] },
      ],
    }))
    localStorage.setItem(LEGACY_DISPLAY_KEY, JSON.stringify({ look: 'sybr-safe' }))
    const ws = loadStoredWorkspace()!
    expect(ws.lanes.map((l: { sample: unknown }) => l.sample)).toEqual([
      { kind: 'ladder', ladderId: '100bp' },
      { kind: 'sequence', sourceId: 't1', enzymes: [], ng: 500 },
      { kind: 'sequence', sourceId: 't1', enzymes: ['EcoRI'], ng: 500 },
      { kind: 'empty' },
      { kind: 'empty' },
    ])
    expect(ws.conditions.agarosePct).toBe(0.8)
    expect(ws.conditions.buffer).toBe('TBE')
    expect(ws.display.look).toBe('sybr-safe')
    expect(ws.display.massThickness).toBe(false)
  })

  it('returns null with nothing saved, and for an empty old table', () => {
    expect(loadStoredWorkspace()).toBeNull()
    expect(migrateLegacy({ lanes: [] }, null)).toBeNull()
  })

  it('survives corrupt storage', () => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, '{not json')
    expect(loadStoredWorkspace()).toBeNull()
  })
})

describe('labels', () => {
  const name = (id: string) => (id === 't1' ? 'pUC19' : null)

  it('names lanes from what is in them', () => {
    expect(autoLaneLabel({ kind: 'ladder', ladderId: '1kb' }, name)).toBe('1 kb')
    expect(autoLaneLabel({ kind: 'sequence', sourceId: 't1', enzymes: [], ng: 1 }, name)).toBe('pUC19 uncut')
    expect(autoLaneLabel({ kind: 'sequence', sourceId: 't1', enzymes: ['EcoRI', 'BamHI'], ng: 1 }, name)).toBe('pUC19 EcoRI+BamHI')
    expect(autoLaneLabel({ kind: 'sequence', sourceId: 'gone', enzymes: [], ng: 1 }, name)).toBe('Missing uncut')
    expect(autoLaneLabel({ kind: 'empty' }, name)).toBe('Empty')
  })

  it('shortens ladder names', () => {
    expect(shortLadderName('lambda-hindiii')).toBe('Lambda DNA/HindIII')
    expect(shortLadderName('hi-lo')).toBe('Hi-Lo')
  })

  it('recognises form presets and defaults unknown mixes to the miniprep', () => {
    expect(formPresetId(FORM_PRESETS[1].forms)).toBe(FORM_PRESETS[1].id)
    expect(formPresetId({ supercoiled: 0.5, nicked: 0.5, linear: 0 })).toBe('miniprep')
    expect(formPresetId(undefined)).toBe('miniprep')
  })
})

describe('parseEnzymeList', () => {
  it('splits on plus, comma and spaces, case-insensitively', () => {
    expect(parseEnzymeList('EcoRI+BamHI')).toEqual({ known: ['EcoRI', 'BamHI'], unknown: [] })
    expect(parseEnzymeList('ecori, bamhi  hindiii')).toEqual({ known: ['EcoRI', 'BamHI', 'HindIII'], unknown: [] })
  })

  it('reports what it does not recognise and drops duplicates', () => {
    expect(parseEnzymeList('EcoRI + Nope + ecoRI')).toEqual({ known: ['EcoRI'], unknown: ['Nope'] })
  })
})

describe('suggestDigest readability', () => {
  it('skips a pair that would cut the plasmid into two equal halves', () => {
    // EcoRI at 100, BamHI at 2100, HindIII at 3100 of 4000: EcoRI+BamHI gives
    // 2000 + 2000, which run as one band; EcoRI+HindIII gives 3000 + 1000.
    const bases = plasmid([[100, 'GAATTC'], [2100, 'GGATCC'], [3100, 'AAGCTT']])
    expect(suggestDigest(active(bases, ['EcoRI', 'BamHI', 'HindIII']))).toEqual(['EcoRI', 'HindIII'])
  })
})

describe('stored workspace', () => {
  beforeEach(() => localStorage.clear())

  it('is forgotten once it has become a gel', () => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ lanes: [] , conditions: {}, display: {} }))
    localStorage.setItem(LEGACY_GEL_KEY, '{}')
    clearStoredWorkspace()
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(LEGACY_GEL_KEY)).toBeNull()
  })

  it('keeps PCR and size lanes, repairing their numbers', () => {
    const ws = sanitizeWorkspace({
      lanes: [
        { id: 'p', sample: { kind: 'pcr', templateId: 't', forwardId: 'f', reverseId: 'r', ng: -5 } },
        { id: 's', sample: { kind: 'sizes', sizes: [1200, 'x', -3, 800], ng: 40 } },
      ],
    })!
    expect(ws.lanes[0].sample).toEqual({ kind: 'pcr', templateId: 't', forwardId: 'f', reverseId: 'r', ng: 1 })
    expect(ws.lanes[1].sample).toEqual({ kind: 'sizes', sizes: [1200, 800], ng: 40 })
  })

  it('rejects things that are not gels', () => {
    expect(sanitizeWorkspace(null)).toBeNull()
    expect(sanitizeWorkspace({ lanes: 'no' })).toBeNull()
  })
})
