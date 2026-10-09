import { describe, it, expect } from 'vitest'
import { Coalescer, recordStep, stepBack, stepForward, trimHistory, type HistoryRules, type WithHistory } from './history'

const rules: HistoryRules<string> = { maxSteps: 3, coalesceMs: 1000, cost: (prev, next) => Math.abs(prev.length - next.length) }
const empty = (): WithHistory<string> => ({ undoStack: [], redoStack: [] })

describe('recordStep', () => {
  it('pushes the document before the edit and clears redo', () => {
    const h = { undoStack: [], redoStack: [{ doc: 'z', cost: 0 }] }
    const next = recordStep(h, 'a', 'ab', 'Type', false, rules)
    expect(next.undoStack).toEqual([{ doc: 'a', label: 'Type', cost: 1 }])
    expect(next.redoStack).toEqual([])
  })

  it('merges into the last step, keeping its start and refreshing its cost', () => {
    let h = recordStep(empty(), 'a', 'ab', 'Type', false, rules)
    h = recordStep(h, 'ab', 'abc', 'Type', true, rules)
    expect(h.undoStack).toEqual([{ doc: 'a', label: 'Type', cost: 2 }])
  })

  it('does not merge into an empty stack', () => {
    const h = recordStep(empty(), 'a', 'ab', 'Type', true, rules)
    expect(h.undoStack).toHaveLength(1)
  })

  it('drops the oldest step past maxSteps', () => {
    let h = empty()
    for (const [prev, next] of [['', 'a'], ['a', 'ab'], ['ab', 'abc'], ['abc', 'abcd']]) h = recordStep(h, prev, next, undefined, false, rules)
    expect(h.undoStack.map(s => s.doc)).toEqual(['a', 'ab', 'abc'])
  })
})

describe('trimHistory', () => {
  it('keeps the newest steps within the budget, and always the newest one', () => {
    const stack = [{ doc: 'a', cost: 5 }, { doc: 'b', cost: 5 }, { doc: 'c', cost: 5 }]
    expect(trimHistory(stack, { maxSteps: 10, coalesceMs: 0, budget: 8 }).map(s => s.doc)).toEqual(['c'])
    expect(trimHistory(stack, { maxSteps: 10, coalesceMs: 0, budget: 10 }).map(s => s.doc)).toEqual(['b', 'c'])
    expect(trimHistory([{ doc: 'a', cost: 50 }], { maxSteps: 10, coalesceMs: 0, budget: 8 })).toHaveLength(1)
  })
})

describe('stepBack and stepForward', () => {
  it('move a step between the stacks and say what it was', () => {
    const h = recordStep(empty(), 'a', 'ab', 'Type', false, rules)
    const back = stepBack(h, 'ab', rules)!
    expect(back.step.doc).toBe('a')
    expect(back.step.label).toBe('Type')
    expect(back.history.undoStack).toEqual([])
    expect(back.history.redoStack).toEqual([{ doc: 'ab', label: 'Type', cost: 1 }])
    const forward = stepForward(back.history, 'a', rules)!
    expect(forward.step.doc).toBe('ab')
    expect(forward.history.undoStack).toEqual([{ doc: 'a', label: 'Type', cost: 1 }])
    expect(forward.history.redoStack).toEqual([])
  })

  it('return null with nothing to step to', () => {
    expect(stepBack(empty(), 'a', rules)).toBeNull()
    expect(stepForward(empty(), 'a', rules)).toBeNull()
  })
})

describe('Coalescer', () => {
  it('continues a step for the same item and key within the window', () => {
    const c = new Coalescer(1000)
    expect(c.continues('x', 'name', 0)).toBe(false)
    expect(c.continues('x', 'name', 500)).toBe(true)
    expect(c.continues('x', 'other', 600)).toBe(false)
    expect(c.continues('x', 'other', 1700)).toBe(false)
    expect(c.continues('y', 'other', 1800)).toBe(false)
  })

  it('forgets after an edit without a key, and on reset', () => {
    const c = new Coalescer(1000)
    c.continues('x', 'name', 0)
    c.continues('x', undefined, 100)
    expect(c.continues('x', 'name', 200)).toBe(false)
    c.reset()
    expect(c.continues('x', 'name', 300)).toBe(false)
  })
})
