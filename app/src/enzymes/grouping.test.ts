import { describe, it, expect } from 'vitest'
import { getEnzyme } from './db'
import { findCutSites } from './finder'
import { groupCutSites } from './grouping'

describe('groupCutSites', () => {
  it('names an enzyme once though its site is there on both strands', () => {
    const sites = findCutSites('A'.repeat(30) + 'CAAG' + 'A'.repeat(30), getEnzyme('MspJI')!, 'linear')
    const [group] = groupCutSites(sites)
    expect(group.sites).toHaveLength(2)
    expect(group.label).toBe('MspJI')
  })

  it('marks a site whose cut would fall past an end: it cuts nothing, and its name goes at the site', () => {
    const seq = 'A'.repeat(50) + 'GGTCTC' + 'AA'
    const sites = findCutSites(seq, getEnzyme('BsaI')!, 'linear')
    expect(sites[0].offEnd).toBe(true)
    const [group] = groupCutSites(sites)
    expect(group).toMatchObject({ cuts: false, labelPos: 50 })
  })

  it('names a cutting site at its cut', () => {
    const sites = findCutSites('A'.repeat(20) + 'GAATTC' + 'A'.repeat(20), getEnzyme('EcoRI')!, 'linear')
    expect(groupCutSites(sites)[0]).toMatchObject({ cuts: true, labelPos: 21, fwdCut: 21 })
  })

  it('keeps neoschizomers at one site together, with both cuts', () => {
    const seq = 'A'.repeat(20) + 'CCCGGG' + 'A'.repeat(20)
    const sites = [...findCutSites(seq, getEnzyme('SmaI')!), ...findCutSites(seq, getEnzyme('XmaI')!)]
    const [group] = groupCutSites(sites)
    expect(group.label).toBe('SmaI / XmaI')
    expect(group.sites.map(s => [s.fwdCut, s.revCut])).toEqual([[23, 23], [21, 25]])
  })
})
