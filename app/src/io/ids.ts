/**
 * Ids for what a parser creates: a prefix per format, a run id drawn afresh
 * for each parse so two files never share ids, and a counter.
 */

export interface IdSource {
  next(): string
  /** A new run id and the counter at zero: call at the start of each parse. */
  reset(): void
  /** A fixed run id, for tests that compare ids. */
  resetForTests(): void
}

const randomRun = () => Math.random().toString(36).slice(2, 6)

export function idSource(prefix: string): IdSource {
  let run = randomRun()
  let n = 0
  return {
    next: () => `${prefix}_${run}_${++n}`,
    reset: () => { run = randomRun(); n = 0 },
    resetForTests: () => { run = 'test'; n = 0 },
  }
}
