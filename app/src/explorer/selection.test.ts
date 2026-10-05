import { describe, expect, it } from 'vitest'
import { exportSelection } from './selection'

describe('exportSelection', () => {
  const contigsOf = (id: string) => (id === 'a1' ? ['c1', 'c2'] : ['c3'])

  it('turns an assembly into its contigs', () => {
    expect(exportSelection(['assembly:a1', 'sequence:t1'], contigsOf)).toEqual({ sequence: ['t1'], contig: ['c1', 'c2'] })
  })

  it('does not list a contig twice when it and its assembly are picked', () => {
    expect(exportSelection(['contig:c2', 'assembly:a1', 'assembly:a2'], contigsOf)).toEqual({ contig: ['c2', 'c1', 'c3'] })
  })
})
