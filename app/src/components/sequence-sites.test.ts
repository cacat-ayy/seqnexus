/**
 * How cut sites are laid out on a line of the sequence view: names in rows
 * that never overprint, "+N" chips past the last row, a bar per site in its
 * own lane, and lines only as tall as their sites need.
 */
import { describe, it, expect } from 'vitest'
import { PUC19_SEQUENCE } from '../demo'
import { getEnzyme } from '../enzymes/db'
import { findAllSites } from '../enzymes/finder'
import { groupCutSites } from '../enzymes/grouping'
import { getLayout, RowLayoutMap, rowHeightForLanes } from './zoom-layout'
import { assignSiteLanes, layoutSiteRow, measureSiteRows } from './sequence-paint'

const MCS = ['EcoRI', 'SacI', 'KpnI', 'SmaI', 'BamHI', 'XbaI', 'SalI', 'PstI', 'SbfI', 'SphI', 'HindIII']
const sites = groupCutSites(findAllSites(PUC19_SEQUENCE, MCS.map(n => getEnzyme(n)!), 'circular'))
const measure = (text: string) => text.length * 6
const seqLen = PUC19_SEQUENCE.length

/** The line holding the multiple cloning site, at a layout. */
function mcsRow(L: ReturnType<typeof getLayout>) {
  const bpr = L.basesPerRow
  const row = Math.floor(420 / bpr)
  return [row * bpr, Math.min((row + 1) * bpr, seqLen)] as const
}

describe('names on a crowded line', () => {
  it('never puts two names over each other in one row', () => {
    for (const zoom of [8, 10, 14, 18]) {
      const L = getLayout(zoom, 1000, true, seqLen)
      const [start, end] = mcsRow(L)
      const { labels } = layoutSiteRow(sites, start, end, L, measure)
      for (const a of labels) {
        for (const b of labels) {
          if (a === b || a.tier !== b.tier) continue
          const apart = a.x + a.width <= b.x || b.x + b.width <= a.x
          expect(apart).toBe(true)
        }
      }
    }
  })

  it('puts names it has no row for into a "+N" chip instead of dropping or stacking them', () => {
    // Zoomed far out, the whole MCS is a few pixels wide.
    const L = getLayout(3, 1000, true, seqLen)
    const [start, end] = mcsRow(L)
    const { labels, chips, tiers } = layoutSiteRow(sites, start, end, L, measure)
    expect(chips.length).toBeGreaterThan(0)
    const shown = labels.length + chips.reduce((n, c) => n + c.groups.length, 0)
    expect(shown).toBe(sites.filter(g => g.fwdCut >= start && g.fwdCut < end).length)
    expect(chips.every(c => c.text === `+${c.groups.length}`)).toBe(true)
    expect(tiers).toBe(L.maxEnzymeTiers + 1)
    expect(Math.max(...labels.map(l => l.tier))).toBeLessThan(L.maxEnzymeTiers)
  })

  it('uses only the rows a line needs', () => {
    const L = getLayout(18, 1000, true, seqLen)
    const lonely = groupCutSites(findAllSites(PUC19_SEQUENCE, [getEnzyme('AatII')!], 'circular'))
    const g = lonely[0]
    const start = Math.floor(g.fwdCut / L.basesPerRow) * L.basesPerRow
    expect(layoutSiteRow(lonely, start, start + L.basesPerRow, L, measure).tiers).toBe(1)
    expect(layoutSiteRow(lonely, start + L.basesPerRow, start + 2 * L.basesPerRow, L, measure).tiers).toBe(0)
  })
})

describe('a bar per site', () => {
  it('keeps sites that touch or overlap in different lanes', () => {
    const L = getLayout(16, 1000, true, seqLen)
    const [start, end] = mcsRow(L)
    const { lanes, count } = assignSiteLanes(sites, start, end, L)
    expect(count).toBeGreaterThan(1)
    const inRow = [...lanes.keys()].sort((a, b) => a.recognitionStart - b.recognitionStart)
    for (let i = 1; i < inRow.length; i++) {
      const a = inRow[i - 1]
      const b = inRow[i]
      if (b.recognitionStart <= a.recognitionEnd) expect(lanes.get(a)).not.toBe(lanes.get(b))
    }
  })

  it('has no bars zoomed all the way out, where a site is under a pixel', () => {
    const L = getLayout(2, 1000, true, seqLen)
    expect(L.maxSiteLanes).toBe(0)
    expect(assignSiteLanes(sites, 0, seqLen, L).count).toBe(0)
  })
})

describe('line heights follow their sites', () => {
  it('gives a line with sites room for them and a line without none', () => {
    const L = getLayout(16, 1000, true, seqLen)
    const bpr = L.basesPerRow
    const rows = Math.ceil(seqLen / bpr)
    const rl = new RowLayoutMap(rows)
    measureSiteRows(rl, sites, i => [i * bpr, Math.min((i + 1) * bpr, seqLen)], L, measure)
    rl.build(L)
    const mcs = Math.floor(420 / bpr)
    expect(rl.tiers[mcs]).toBeGreaterThan(0)
    expect(rl.siteLanes[mcs]).toBeGreaterThan(0)
    expect(rl.tiers[0]).toBe(0)
    expect(rl.rowH(0)).toBe(rowHeightForLanes(L, 0, L.maxTranslationRows))
    expect(rl.rowH(mcs)).toBeGreaterThan(rl.rowH(0))
    // The bases sit below the names, the ruler and the bars.
    expect(rl.seqTop(mcs, L)).toBe(rl.labelAreaH(mcs, L) + L.rulerHeight + rl.siteBandH(mcs, L))
    expect(rl.seqTop(0, L)).toBe(L.rulerHeight)
  })

  it('reserves nothing for sites when they are hidden', () => {
    const L = getLayout(16, 1000, false, seqLen)
    const rl = new RowLayoutMap(3)
    measureSiteRows(rl, sites, i => [i * L.basesPerRow, (i + 1) * L.basesPerRow], L, measure)
    expect([...rl.tiers]).toEqual([0, 0, 0])
    expect(rl.labelAreaH(0, L)).toBe(0)
    expect(rl.siteBandH(0, L)).toBe(0)
  })
})
