import { describe, expect, it } from 'vitest'
import { layFeatures, windowConsensus } from './mappingPaint'
import type { RefFeature } from '../../assembly/variants'
import type { WindowPileup } from '../../ngs/view'

function pileup(from: number, rows: number[][]): WindowPileup {
  const counts = new Uint32Array(rows.length * 6)
  rows.forEach((r, i) => r.forEach((c, a) => { counts[i * 6 + a] = c }))
  return { from, to: from + rows.length, depth: new Uint32Array(rows.length), forward: new Uint32Array(rows.length), counts }
}

describe('windowConsensus', () => {
  it('takes the majority, the reference winning a tie, 0 where no read is loaded, and insertions most reads carry', () => {
    //               A  C  G  T  del
    const pu = pileup(10, [[5, 0, 0, 1, 0], [0, 2, 2, 0, 0], [0, 0, 0, 0, 0], [1, 0, 0, 0, 4], [0, 0, 3, 0, 0, 2]])
    const c = windowConsensus(pu, 'NNNNNNNNNNAGCTG', 8, 20)!
    expect(c.from).toBe(10)
    expect(String.fromCharCode(...c.codes.slice(0, 2))).toBe('AG')
    expect(c.codes[2]).toBe(0)
    expect(String.fromCharCode(c.codes[3])).toBe('-')
    expect([...c.insertAfter]).toEqual([0, 0, 0, 0, 1])
  })
})

describe('layFeatures', () => {
  const f = (id: string, start: number, end: number): RefFeature => ({ id, name: id, type: 'CDS', start, end, strand: 1 })
  it('packs overlapping features into lanes and splits one across the origin', () => {
    const { laid, lanes } = layFeatures([f('a', 0, 50), f('b', 40, 80), f('c', 60, 90), f('o', 95, 10)], 100)
    expect(lanes).toBe(2)
    const lane = (id: string) => laid.filter(x => x.f.id === id).map(x => [x.start, x.end, x.lane])
    expect(lane('a')[0][2]).not.toBe(lane('b')[0][2])
    expect(lane('c')[0][2]).toBe(lane('a')[0][2])
    expect(lane('o').map(x => [x[0], x[1]])).toEqual([[0, 10], [95, 100]])
  })
})
