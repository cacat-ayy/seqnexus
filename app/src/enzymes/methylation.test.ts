import { describe, it, expect } from 'vitest'
import { getEnzyme } from './db'
import { findCutSites } from './finder'
import { groupCutSites } from './grouping'
import { siteMethylationEffect, siteMethylationLines, summarizeMethylation, type MethylationContext } from './methylation'

const pad = 'A'.repeat(20)
const ctx = (bases: string, dam = true, dcm = false): MethylationContext =>
  ({ bases, topology: 'linear', dam, dcm })

describe('methylation at one site', () => {
  const xbaI = getEnzyme('XbaI')!
  // XbaI's TCTAGA reaches into a GATC only in the first of these.
  const overlapped = pad + 'TCTAGATC' + pad
  const clear = pad + 'TCTAGAACGGATC' + pad

  it('blocks a Dam-sensitive site only where a methylated base falls inside it', () => {
    const [hit] = findCutSites(overlapped, xbaI)
    const [miss] = findCutSites(clear, xbaI)
    expect(siteMethylationEffect(hit, ctx(overlapped))).toEqual({ effect: 'blocked', by: 'dam' })
    expect(siteMethylationEffect(miss, ctx(clear))).toBeNull()
  })

  it('groups sites with the effect at each site, not the enzyme flag', () => {
    const both = overlapped + clear
    const groups = groupCutSites(findCutSites(both, xbaI), ctx(both))
    expect(groups.map(g => g.methEffect)).toEqual(['blocked', null])
    expect(groups[0].methNote).toBe('Blocked by Dam methylation here')
  })

  it('tells the card what each sensitivity does at this site', () => {
    const [hit] = findCutSites(overlapped, xbaI)
    const [miss] = findCutSites(clear, xbaI)
    expect(siteMethylationLines(hit, ctx(overlapped))).toEqual([{ text: 'Dam: blocked here', tone: 'danger' }])
    expect(siteMethylationLines(miss, ctx(clear))).toEqual([{ text: 'Dam: not affected here', tone: 'muted' }])
    // Not marked methylated: a warning that it would be, not a block.
    expect(siteMethylationLines(hit, ctx(overlapped, false))).toEqual([
      { text: 'Dam: blocked here if Dam-methylated', tone: 'warning' },
    ])
  })

  it('summarizes an enzyme by its sites: blocked at some is not blocked', () => {
    const both = overlapped + clear
    const some = summarizeMethylation(findCutSites(both, xbaI), ctx(both))
    expect(some).toMatchObject({ total: 2, blocked: 1, impaired: 0, tag: '1/2 blocked' })
    expect(some.effects.map(e => e?.effect ?? null)).toEqual(['blocked', null])
    expect(some.note).toBe('Dam methylation: blocked at 1 of 2 sites')

    const all = summarizeMethylation(findCutSites(overlapped, xbaI), ctx(overlapped))
    expect(all).toMatchObject({ tag: 'blocked', note: 'Dam methylation: blocked at its site' })

    expect(summarizeMethylation(findCutSites(clear, xbaI), ctx(clear))).toMatchObject({ tag: null, note: null })
  })

  it('summarizes DpnI on unmethylated DNA as blocked for want of methylation', () => {
    const bases = pad + 'GATC' + pad + 'GATC' + pad
    expect(summarizeMethylation(findCutSites(bases, getEnzyme('DpnI')!), ctx(bases, false)))
      .toMatchObject({ total: 2, blocked: 2, tag: 'blocked', note: 'Cuts only Dam-methylated DNA' })
  })

  it('says where an enzyme that needs methylation finds none', () => {
    // MspJI reads CNNR and needs a Dcm-methylated C in it: the first site has CCAGG's, the second none.
    const bases = pad + 'CCAGG' + pad + 'CTTAG' + pad
    const sites = findCutSites(bases, getEnzyme('MspJI')!).filter(s => !s.offEnd)
    const summary = summarizeMethylation(sites, ctx(bases, false, true))
    expect(summary.blocked).toBeLessThan(summary.total)
    expect(summary.note).toBe(`Cuts only Dcm-methylated DNA: none at ${summary.blocked} of ${summary.total} sites`)
  })

  it('says DpnI cuts only where its GATC is methylated', () => {
    const bases = pad + 'GATC' + pad
    const [site] = findCutSites(bases, getEnzyme('DpnI')!)
    expect(siteMethylationLines(site, ctx(bases, false))).toEqual([{ text: 'Dam: cuts only if Dam-methylated', tone: 'danger' }])
    expect(siteMethylationLines(site, ctx(bases, true))).toEqual([{ text: 'Dam: methylated here, so it cuts', tone: 'muted' }])
  })
})
