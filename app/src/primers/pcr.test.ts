import { describe, it, expect } from 'vitest'
import { simulatePcr, type PcrTemplate } from './pcr'
import { reverseComplement } from '../models/complement'
import type { PrimerData } from './oligo'

function template(n: number, seed = 9): string {
  let x = seed
  let s = ''
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5
    s += 'ACGT'[(x >>> 7) & 3]
  }
  return s
}

const T = template(2000)
const oligo = (id: string, sequence: string): PrimerData => ({ id, name: id, sequence, role: 'primer' })
const tpl = (over: Partial<PcrTemplate> = {}): PcrTemplate => ({
  name: 'pT', bases: T, topology: 'linear', annotations: [], ...over,
})

describe('simulatePcr', () => {
  it('amplifies from the forward 5′ end to the reverse 5′ end', () => {
    const p = simulatePcr(tpl(), oligo('F', T.slice(100, 120)), oligo('R', reverseComplement(T.slice(580, 600))))
    if ('error' in p) throw new Error(p.error)
    expect(p.bases).toBe(T.slice(100, 600))
  })

  it('copies both 5′ tails into the product ends', () => {
    const fwdTail = 'GCGAATTC'
    const revTail = 'GCGGATCC'
    const p = simulatePcr(tpl(),
      oligo('F', fwdTail + T.slice(100, 120)),
      oligo('R', revTail + reverseComplement(T.slice(580, 600))))
    if ('error' in p) throw new Error(p.error)
    expect(p.bases.startsWith(fwdTail)).toBe(true)
    expect(p.bases.endsWith(reverseComplement(revTail))).toBe(true)
    expect(p.bases.length).toBe(500 + 16)
  })

  it('works whichever primer is passed first', () => {
    const f = oligo('F', T.slice(100, 120))
    const r = oligo('R', reverseComplement(T.slice(580, 600)))
    const a = simulatePcr(tpl(), f, r)
    const b = simulatePcr(tpl(), r, f)
    if ('error' in a || 'error' in b) throw new Error('no product')
    expect(b.bases).toBe(a.bases)
  })

  it('amplifies across the origin of a circle', () => {
    const f = oligo('F', T.slice(1900, 1920))
    const r = oligo('R', reverseComplement(T.slice(80, 100)))
    const p = simulatePcr(tpl({ topology: 'circular' }), f, r)
    if ('error' in p) throw new Error(p.error)
    expect(p.bases).toBe(T.slice(1900) + T.slice(0, 100))
  })

  it('carries features over, shifted by the tail, and clips the ones it cuts', () => {
    const p = simulatePcr(tpl({
      annotations: [
        { id: 'inside', name: 'inside', type: 'CDS', start: 200, end: 300, strand: 1 },
        { id: 'cut', name: 'cut', type: 'CDS', start: 50, end: 150, strand: 1 },
        { id: 'out', name: 'out', type: 'CDS', start: 900, end: 950, strand: 1 },
      ],
    }), oligo('F', 'AAAA' + T.slice(100, 120)), oligo('R', reverseComplement(T.slice(580, 600))))
    if ('error' in p) throw new Error(p.error)
    const byName = Object.fromEntries(p.annotations.map(a => [a.name, a]))
    expect(byName.inside).toMatchObject({ start: 104, end: 204 })
    expect(byName.cut).toMatchObject({ start: 4, end: 54, truncated: true })
    expect(byName.out).toBeUndefined()
  })

  it('says why nothing is made', () => {
    const r = simulatePcr(tpl(), oligo('F', T.slice(580, 600)), oligo('R', reverseComplement(T.slice(100, 120))))
    expect('error' in r && r.error).toMatch(/do not face each other/)
    const x = simulatePcr(tpl(), oligo('F', 'ACGTACGTACGTACGTACGT'), oligo('R', reverseComplement(T.slice(580, 600))))
    expect('error' in x && x.error).toMatch(/does not bind/)
  })

  it('hands the primers on to the product, where they bind at its ends', () => {
    const p = simulatePcr(tpl(), oligo('F', T.slice(100, 120)), oligo('R', reverseComplement(T.slice(580, 600))))
    if ('error' in p) throw new Error(p.error)
    expect(p.primers.map(x => x.name)).toEqual(['F', 'R'])
  })
})
