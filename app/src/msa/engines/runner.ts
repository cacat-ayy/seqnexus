/**
 * Starting an alignment: pick the engine, run it in a worker, check and
 * return the aligned rows in input order. Cancellable.
 */

import { runAlignment } from '../../workers/alignment'
import { DEFAULT_DNA_SCORING } from '../../alignment/types'
import type { AlnKind } from '../model'
import {
  engineInput, engineLabel, estimateSeconds, readEngineOutput, resolveEngine, shapeOf, toolCommand,
  type ConcreteEngine, type EngineSettings,
} from './catalog'
import type { ToolResult } from './emscripten'

export interface AlignOutcome {
  /** Aligned rows, same order as the input. */
  rows: string[]
  engine: ConcreteEngine
  /** "MAFFT L-INS-i" and so on. */
  label: string
  ms: number
}

export interface AlignJob {
  engine: ConcreteEngine
  label: string
  /** Expected seconds, for a progress bar. */
  estimate: number
  promise: Promise<AlignOutcome>
  cancel: () => void
}

export class AlignCancelled extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'AlignCancelled'
  }
}

/**
 * The tool's own explanation from its stderr: the last line that is not
 * Emscripten's trap report or a stack frame.
 */
export function failureReason(stderr: string): string {
  const lines = stderr.split('\n').map(l => l.trim())
    .filter(l => l && !/^(exception thrown|RuntimeError|at |Aborted|warning)/i.test(l))
  const why = lines[lines.length - 1]?.replace(/^\.\/this\.program:\s*/, '')
  return why ? `: ${why}` : ''
}

/** Where the WebAssembly builds are served: /wasm next to the app page. */
function wasmBase(): string {
  return new URL('wasm/', document.baseURI).href
}

function runInWorker(program: string, run: { args: string[]; files: Record<string, string>; outputs: string[] }) {
  const worker = new Worker(new URL('../../workers/aligner.worker.ts', import.meta.url), { type: 'module' })
  let settle: ((r: ToolResult) => void) | null = null
  let fail: ((e: Error) => void) | null = null
  const promise = new Promise<ToolResult>((resolve, reject) => { settle = resolve; fail = reject })
  worker.onmessage = (e: MessageEvent<{ ok: true; result: ToolResult } | { ok: false; error: string }>) => {
    worker.terminate()
    if (e.data.ok) settle?.(e.data.result)
    else fail?.(new Error(e.data.error))
  }
  worker.onerror = e => {
    worker.terminate()
    fail?.(new Error(e.message || 'The aligner stopped unexpectedly'))
  }
  const base = wasmBase()
  worker.postMessage({ glueUrl: `${base}${program}.js`, wasmUrl: `${base}${program}.wasm`, run })
  return {
    promise,
    cancel: () => { worker.terminate(); fail?.(new AlignCancelled()) },
  }
}

/**
 * Align ungapped sequences. Throws (through the promise) when there are
 * fewer than two, when pairwise is asked for with more than two, and when the
 * tool fails or returns something that does not match its input.
 */
export function startAlignment(
  seqs: readonly string[],
  kind: AlnKind,
  settings: EngineSettings,
): AlignJob {
  const shape = shapeOf(seqs)
  const engine = resolveEngine(settings, shape, kind)
  const label = engineLabel(engine, settings)
  const estimate = estimateSeconds(engine, shape, kind)
  const started = performance.now()

  if (seqs.length < 2) {
    return { engine, label, estimate, promise: Promise.reject(new Error('Alignment needs at least two sequences')), cancel: () => {} }
  }

  if (engine === 'pairwise') {
    if (seqs.length !== 2) {
      return { engine, label, estimate, promise: Promise.reject(new Error('Pairwise alignment takes exactly two sequences')), cancel: () => {} }
    }
    const handle = runAlignment({
      sequences: seqs.map((s, i) => ({ name: `s${i}`, bases: s })),
      mode: settings.pairwiseMode,
      seqType: kind,
      scoring: kind === 'dna'
        ? { ...DEFAULT_DNA_SCORING }
        : { matrix: 'BLOSUM62', gapOpen: -10, gapExtend: -0.5 },
    })
    const promise = handle.promise.then(r => ({
      rows: r.sequences.map(s => s.alignedBases.toUpperCase()),
      engine, label, ms: performance.now() - started,
    }))
    return { engine, label, estimate, promise, cancel: handle.cancel }
  }

  const cmd = toolCommand(engine, settings, kind)
  const job = runInWorker(cmd.program, { args: cmd.args, files: { [cmd.input]: engineInput(seqs) }, outputs: [cmd.output] })
  const promise = job.promise.then(result => {
    const out = result.files[cmd.output]
    if (!out) throw new Error(`${label} failed${failureReason(result.stderr)}`)
    return { rows: readEngineOutput(out, seqs), engine, label, ms: performance.now() - started }
  })
  return { engine, label, estimate, promise, cancel: job.cancel }
}
