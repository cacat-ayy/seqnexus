/**
 * Undo history for the session items that keep whole snapshots: alignments,
 * contigs, cloning designs and gels. Each step holds the item's document as
 * it was before an edit, what the edit was called, and what keeping the
 * snapshot costs, so a stack can be bounded by memory as well as by length.
 * The sequence documents keep their own history (IndexedDB-backed snapshots
 * of a piece table) and do not use this.
 */

export interface HistoryStep<D> {
  doc: D
  /** What the edit was, for the Undo and Redo labels. */
  label?: string
  /** Characters this snapshot holds that the next one does not share. */
  cost: number
}

export interface WithHistory<D> {
  /** Earlier documents, newest last. Not persisted. */
  undoStack: HistoryStep<D>[]
  redoStack: HistoryStep<D>[]
}

export interface HistoryRules<D> {
  /** Steps kept at most. */
  maxSteps: number
  /** Edits sharing a key within this many milliseconds make one step. */
  coalesceMs: number
  /** What a snapshot costs to keep; nothing, unless given. */
  cost?: (prev: D, next: D) => number
  /** Total cost the undo stack may hold before its oldest steps go. */
  budget?: number
}

/**
 * Remembers the last edit so that a continuous interaction (typing in a
 * field, dragging a slider) collapses into one undo step. One per item kind.
 */
export class Coalescer {
  private last: { id: string; key: string; at: number } | null = null

  constructor(private readonly windowMs: number) {}

  /** Whether an edit to `id` under `key` continues the previous step, remembering it for the next. */
  continues(id: string, key: string | undefined, now: number): boolean {
    const merge = !!key && this.last !== null && this.last.id === id
      && this.last.key === key && now - this.last.at < this.windowMs
    this.last = key ? { id, key, at: now } : null
    return merge
  }

  /** Forget the last edit: an undo or redo starts afresh. */
  reset(): void {
    this.last = null
  }
}

/** The oldest steps dropped once the stack is longer than allowed, or holds more than its budget. */
export function trimHistory<D>(stack: HistoryStep<D>[], rules: HistoryRules<D>): HistoryStep<D>[] {
  let total = 0
  let from = stack.length
  while (from > 0 && stack.length - from < rules.maxSteps) {
    total += stack[from - 1].cost
    if (rules.budget !== undefined && total > rules.budget && from < stack.length) break
    from--
  }
  return from === 0 ? stack : stack.slice(from)
}

/**
 * The stacks after `prev` became `next`. A merged step keeps its starting
 * point; only its cost is refreshed. Redo is cleared, as any edit does.
 */
export function recordStep<D>(
  h: WithHistory<D>, prev: D, next: D, label: string | undefined, merge: boolean, rules: HistoryRules<D>,
): WithHistory<D> {
  const cost = rules.cost ?? (() => 0)
  let undoStack: HistoryStep<D>[]
  if (merge && h.undoStack.length > 0) {
    const top = h.undoStack[h.undoStack.length - 1]
    undoStack = [...h.undoStack.slice(0, -1), { ...top, cost: cost(top.doc, next) }]
  } else {
    undoStack = trimHistory([...h.undoStack, { doc: prev, label, cost: cost(prev, next) }], rules)
  }
  return { undoStack, redoStack: [] }
}

/** The document to show after stepping back from `current`, with the stacks moved along; null with nothing to undo. */
export function stepBack<D>(h: WithHistory<D>, current: D, rules: HistoryRules<D>): { step: HistoryStep<D>; history: WithHistory<D> } | null {
  const step = h.undoStack[h.undoStack.length - 1]
  if (!step) return null
  const cost = rules.cost ?? (() => 0)
  return {
    step,
    history: {
      undoStack: h.undoStack.slice(0, -1),
      redoStack: [...h.redoStack, { doc: current, label: step.label, cost: cost(current, step.doc) }],
    },
  }
}

/** The document to show after stepping forward from `current`, with the stacks moved along; null with nothing to redo. */
export function stepForward<D>(h: WithHistory<D>, current: D, rules: HistoryRules<D>): { step: HistoryStep<D>; history: WithHistory<D> } | null {
  const step = h.redoStack[h.redoStack.length - 1]
  if (!step) return null
  const cost = rules.cost ?? (() => 0)
  return {
    step,
    history: {
      redoStack: h.redoStack.slice(0, -1),
      undoStack: [...h.undoStack, { doc: current, label: step.label, cost: cost(current, step.doc) }],
    },
  }
}
