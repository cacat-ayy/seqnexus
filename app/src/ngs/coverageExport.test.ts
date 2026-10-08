import { describe, it, expect } from 'vitest'
import { coverageBedGraph } from './coverageExport'

describe('coverage as bedGraph', () => {
  it('merges runs of equal depth, zeros included, 0-based half-open', () => {
    const text = coverageBedGraph('pUC19', [0, 0, 3, 3, 3, 5, 0]).join('')
    expect(text).toBe('pUC19\t0\t2\t0\npUC19\t2\t5\t3\npUC19\t5\t6\t5\npUC19\t6\t7\t0\n')
  })

  it('gives nothing for an empty reference', () => {
    expect(coverageBedGraph('x', [])).toEqual([])
  })

  it('splits a long file into parts', () => {
    const depth = Array.from({ length: 70000 }, (_, i) => i)
    const parts = coverageBedGraph('chr', depth)
    expect(parts).toHaveLength(2)
    expect(parts.join('').split('\n').filter(Boolean)).toHaveLength(70000)
  })
})
