import { describe, it, expect } from 'vitest'
import { cutSiteTrack, toCutMarks, ENZYME_ITEM_PREFIX } from './cutSites'
import { groupCutSites } from '../../../enzymes/grouping'
import type { CutSite } from '../../../enzymes/finder'
import type { RestrictionEnzyme } from '../../../enzymes/db'
import type { MinimapTheme } from '../types'

const enzyme = (name: string, recognition = 'GAATTC'): RestrictionEnzyme =>
  ({ name, recognition, fwd_cut: 1, rev_cut: 5, overhang: '5prime', suppliers: [] }) as unknown as RestrictionEnzyme

const site = (e: RestrictionEnzyme, position: number): CutSite =>
  ({ enzyme: e, position, end: position + e.recognition.length, fwdCut: position + 1, revCut: position + 5, strand: 1 })

const theme = { enzyme: '#e53e3e' } as MinimapTheme
const fmt = (p: number) => String(p + 1)

describe('toCutMarks', () => {
  const ecoRI = enzyme('EcoRI')
  const bamHI = enzyme('BamHI', 'GGATCC')
  const sites = [site(ecoRI, 100), site(bamHI, 400), site(bamHI, 900)]
  const marks = toCutMarks(groupCutSites(sites), 1000)

  it('marks enzymes that cut once as unique and counts the rest', () => {
    expect(marks.map(m => [m.label, m.pos, m.sites])).toEqual([
      ['EcoRI', 101, 1],
      ['BamHI', 401, 2],
      ['BamHI', 901, 2],
    ])
  })

  it('wraps a cut past the end of a circular sequence', () => {
    const late = toCutMarks(groupCutSites([site(ecoRI, 999)]), 1000)
    expect(late[0].pos).toBe(0)
  })

  it('treats a group as unique when any of its enzymes cuts once', () => {
    const mfeI = enzyme('MfeI')
    const grouped = toCutMarks(groupCutSites([site(ecoRI, 100), site(mfeI, 100), site(mfeI, 500)]), 1000)
    expect(grouped[0]).toMatchObject({ label: 'EcoRI / MfeI', sites: 1 })
  })
})

describe('cutSiteTrack hit', () => {
  const marks = [
    { key: 'EcoRI@100', label: 'EcoRI', pos: 101, sites: 1, methylation: null },
    { key: 'BamHI@400', label: 'BamHI', pos: 401, sites: 3, methylation: 'blocked' as const },
  ]
  const track = cutSiteTrack(marks, fmt)

  it('names the nearest site with its cut and how often the enzyme cuts', () => {
    expect(track.hit!(102, 15, 1, theme)).toEqual({
      label: 'EcoRI',
      detail: 'cuts at 102 · unique cutter',
      color: '#e53e3e',
      itemId: ENZYME_ITEM_PREFIX + 'EcoRI@100',
    })
    expect(track.hit!(400, 15, 1, theme)?.detail).toBe('cuts at 402 · 3 sites · blocked by methylation')
  })

  it('ignores positions away from any site', () => {
    expect(track.hit!(250, 15, 1, theme)).toBeNull()
  })
})
