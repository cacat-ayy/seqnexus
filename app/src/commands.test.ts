import { describe, it, expect } from 'vitest'
import { searchCommands, type Command } from './commands'

const cmd = (id: string, label: string, extra: Partial<Command> = {}): Command => ({
  id, label, group: 'Test', run: () => {}, ...extra,
})

const COMMANDS: Command[] = [
  cmd('orfs', 'Find ORFs', { keywords: 'open reading frame' }),
  cmd('primers', 'Design Primers', { keywords: 'pcr tm oligo' }),
  cmd('enzymes', 'Restriction Enzymes'),
  cmd('export', 'Export…', { disabled: true }),
  cmd('gel', 'Virtual Gel'),
]

describe('searchCommands', () => {
  it('returns everything, in order, for an empty query', () => {
    const results = searchCommands(COMMANDS, '')
    expect(results).toHaveLength(COMMANDS.length)
    expect(results.map(r => r.command.id)).toEqual(['orfs', 'primers', 'enzymes', 'export', 'gel'])
  })

  it('treats a whitespace-only query as empty', () => {
    expect(searchCommands(COMMANDS, '   ')).toHaveLength(COMMANDS.length)
  })

  it('matches on a subsequence, not just a prefix', () => {
    const ids = searchCommands(COMMANDS, 'enz').map(r => r.command.id)
    expect(ids).toContain('enzymes')
  })

  it('drops commands that do not match at all', () => {
    expect(searchCommands(COMMANDS, 'zzzz')).toHaveLength(0)
  })

  it('matches via keywords when the label does not contain the query', () => {
    // "pcr" appears nowhere in "Design Primers".
    const ids = searchCommands(COMMANDS, 'pcr').map(r => r.command.id)
    expect(ids).toEqual(['primers'])
  })

  it('reports hit positions that index into the label', () => {
    const [top] = searchCommands(COMMANDS, 'gel')
    expect(top.command.id).toBe('gel')
    const matched = top.hits.map(i => top.command.label[i]).join('').toLowerCase()
    expect(matched).toBe('gel')
  })

  it('returns no hits for a keyword-only match, so nothing is mis-highlighted', () => {
    const [top] = searchCommands(COMMANDS, 'pcr')
    expect(top.hits).toEqual([])
  })

  it('ranks a tighter match above a scattered one', () => {
    const list = [cmd('a', 'Design Primers'), cmd('b', 'Detach Panel Resizer')]
    // "des" is contiguous in "Design", scattered in "DEtach panel reSizer".
    const ids = searchCommands(list, 'des').map(r => r.command.id)
    expect(ids[0]).toBe('a')
  })

  it('sorts disabled commands last but keeps them findable', () => {
    const list = [cmd('off', 'Export', { disabled: true }), cmd('on', 'Export Session')]
    const results = searchCommands(list, 'export')
    expect(results).toHaveLength(2)
    expect(results[results.length - 1].command.id).toBe('off')
  })
})
