/**
 * The alignment engines: what they are, when to use them, how to call them,
 * and how to read what they return. Pure; the runner does the I/O.
 *
 * The tools are the biowasm WebAssembly builds, kept in the repository under
 * /wasm so they load from the app's own origin: MAFFT 7.520 (tbfast, which
 * does the pairwise stage, the progressive alignment and iterative
 * refinement itself), MUSCLE 5 and Kalign 3. Two-sequence alignment uses the
 * built-in Needleman–Wunsch / Smith–Waterman.
 */

import { parseFasta } from '../formats/fasta'
import type { AlnKind, AlnMethod } from '../model'

export type EngineId = 'auto' | 'mafft' | 'muscle' | 'kalign' | 'pairwise'
/** A concrete engine: what "auto" resolves to. */
export type ConcreteEngine = Exclude<EngineId, 'auto'>
export type MafftStrategy = 'linsi' | 'ginsi' | 'einsi'
export type PairwiseMode = 'global' | 'local'

export interface EngineSettings {
  engine: EngineId
  mafftStrategy: MafftStrategy
  pairwiseMode: PairwiseMode
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  engine: 'auto',
  mafftStrategy: 'linsi',
  pairwiseMode: 'global',
}

export interface EngineInfo {
  id: EngineId
  label: string
  /** One line on when to pick it. */
  summary: string
  version?: string
  license?: string
  citation?: string
}

export const ENGINES: readonly EngineInfo[] = [
  { id: 'auto', label: 'Automatic', summary: 'MAFFT L-INS-i where it is quick enough, Kalign for large sets, built-in pairwise for two sequences' },
  {
    id: 'mafft', label: 'MAFFT', version: '7.520', license: 'BSD',
    summary: 'The most accurate choice for up to a few hundred sequences',
    citation: 'Katoh & Standley (2013) Mol Biol Evol 30:772–780',
  },
  {
    id: 'muscle', label: 'MUSCLE 5', version: '5', license: 'GPL-3.0',
    summary: 'Accurate, but slow in the browser: best for small sets',
    citation: 'Edgar (2022) Nat Commun 13:6968',
  },
  {
    id: 'kalign', label: 'Kalign 3', version: '3.3.1', license: 'GPL-3.0',
    summary: 'Fast and accurate: best for many or long sequences',
    citation: 'Lassmann (2020) Bioinformatics 36:1928–1929',
  },
  { id: 'pairwise', label: 'Pairwise', summary: 'Needleman–Wunsch (global) or Smith–Waterman (local) for exactly two sequences' },
]

export const MAFFT_STRATEGIES: readonly { id: MafftStrategy; label: string; summary: string }[] = [
  { id: 'linsi', label: 'L-INS-i', summary: 'Local pairwise: best when sequences share one alignable domain with unalignable ends' },
  { id: 'ginsi', label: 'G-INS-i', summary: 'Global pairwise: for sequences similar over their whole length' },
  { id: 'einsi', label: 'E-INS-i', summary: 'Generalised affine gaps: for several conserved domains separated by long unalignable regions' },
]

export function engineInfo(id: EngineId): EngineInfo {
  return ENGINES.find(e => e.id === id)!
}

// ---------------------------------------------------------------------------
// Choosing
// ---------------------------------------------------------------------------

export interface InputShape {
  count: number
  maxLength: number
  totalLength: number
}

export function shapeOf(seqs: readonly string[]): InputShape {
  let maxLength = 0
  let totalLength = 0
  for (const s of seqs) { maxLength = Math.max(maxLength, s.length); totalLength += s.length }
  return { count: seqs.length, maxLength, totalLength }
}

/**
 * Rough wall-clock seconds in the browser, from timing the WebAssembly builds
 * (single thread). Good to a factor of two or three: enough to warn before
 * starting something that will take minutes.
 */
export function estimateSeconds(engine: ConcreteEngine, shape: InputShape, kind: AlnKind): number {
  const { count: n, maxLength: L } = shape
  const pairs = (n * (n - 1)) / 2
  switch (engine) {
    case 'mafft':
      // All-pairs dynamic programming: about 25M cells per second.
      return 0.2 + (pairs * L * L) / 2.5e7 * (kind === 'dna' ? 0.5 : 1)
    case 'muscle':
      return 0.5 + (pairs * L * L) / 1.5e6 * (kind === 'dna' ? 0.6 : 1)
    case 'kalign':
      return 0.1 + (n * Math.log2(n + 1) * L * L) / 2e8 + (pairs * L) / 2e7
    case 'pairwise':
      return 0.05 + (L * L) / 5e7
  }
}

/** What "automatic" picks for this input. */
export function resolveEngine(settings: EngineSettings, shape: InputShape, kind: AlnKind): ConcreteEngine {
  if (settings.engine !== 'auto') return settings.engine
  if (shape.count === 2) return 'pairwise'
  return estimateSeconds('mafft', shape, kind) <= 20 ? 'mafft' : 'kalign'
}

/** "MAFFT L-INS-i", "Kalign 3": for origins, toasts and badges. */
export function engineLabel(engine: ConcreteEngine, settings: EngineSettings): string {
  if (engine === 'mafft') return `MAFFT ${MAFFT_STRATEGIES.find(s => s.id === settings.mafftStrategy)?.label ?? ''}`.trim()
  if (engine === 'pairwise') return settings.pairwiseMode === 'local' ? 'Smith–Waterman (local)' : 'Needleman–Wunsch (global)'
  return engineInfo(engine).label
}

// ---------------------------------------------------------------------------
// Command lines
// ---------------------------------------------------------------------------

export interface ToolCommand {
  /** Path under /wasm, without extension: "mafft/7.520/tbfast". */
  program: string
  args: string[]
  input: string
  output: string
}

export const WASM_PROGRAMS = {
  mafft: 'mafft/7.520/tbfast',
  muscle: 'muscle/5.1.0/muscle',
  kalign: 'kalign/3.3.1/kalign',
} as const

/**
 * MAFFT's *-INS-i strategies as the `mafft` script runs them: tbfast with a
 * pairwise section (before the second "_") and a progressive section, with
 * 16 rounds of iterative refinement. The values are the script's defaults;
 * the alignment is written to the file "pre".
 */
export function mafftArgs(strategy: MafftStrategy, kind: AlnKind, iterations = 16): string[] {
  const seqtype = kind === 'protein' ? '-P' : '-D'
  const pair: Record<MafftStrategy, string[]> = {
    linsi: ['-g', '-0.100', '-f', '-2.00', '-Q', '100.0', '-h', '0.100', '-L', '-Z'],
    ginsi: ['-g', '-0.10', '-f', '-2.00', '-Q', '100.0', '-h', '0.100', '-A', '-Z'],
    einsi: ['-g', '0.0', '-f', '-2.00', '-Q', '100.0', '-h', '0.0', '-O', '-6.00', '-E', '-0.000', '-N', '-Z'],
  }
  // Terminal gaps are scored as internal ones for the local strategies.
  const termGaps = strategy === 'ginsi' ? [] : ['-O']
  return [
    '_', '-u', '0.0', '-l', '2.7', '-C', '0', seqtype, '-b', '62', ...pair[strategy],
    '_', '-+', String(iterations), '-W', '0.00001', '-V', '-1.53', '-s', '0.0', ...termGaps,
    '-C', '0', seqtype, '-b', '62', '-f', '-1.53', '-Q', '100.0', '-h', '0.000', '-l', '2.7', '-X', '0.1',
    '-i', 'input.fa',
  ]
}

export function toolCommand(engine: 'mafft' | 'muscle' | 'kalign', settings: EngineSettings, kind: AlnKind): ToolCommand {
  switch (engine) {
    case 'mafft':
      return { program: WASM_PROGRAMS.mafft, args: mafftArgs(settings.mafftStrategy, kind), input: 'input.fa', output: 'pre' }
    case 'muscle':
      return { program: WASM_PROGRAMS.muscle, args: ['-align', 'input.fa', '-output', 'out.afa', '-threads', '1'], input: 'input.fa', output: 'out.afa' }
    case 'kalign':
      return {
        program: WASM_PROGRAMS.kalign,
        // Kalign 3.3 detects DNA or protein itself.
        args: ['-i', 'input.fa', '-o', 'out.afa'],
        input: 'input.fa',
        output: 'out.afa',
      }
  }
}

// ---------------------------------------------------------------------------
// Input and output
// ---------------------------------------------------------------------------

/**
 * Input FASTA with the rows renamed s0, s1, ...: names with spaces, odd
 * characters or duplicates can confuse the tools, and the ids let the result
 * be put back in input order whatever order the tool writes it in.
 */
export function engineInput(seqs: readonly string[]): string {
  return seqs.map((s, i) => `>s${i}\n${s}\n`).join('')
}

export class EngineOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineOutputError'
  }
}

/**
 * The aligned rows from a tool's output, in input order. Checks that every
 * row came back with exactly its residues, so a tool that dropped or changed
 * one cannot slip a wrong alignment through.
 */
export function readEngineOutput(text: string | null, input: readonly string[]): string[] {
  if (!text || !text.trim()) throw new EngineOutputError('The aligner produced no output')
  const rows = parseFasta(text).rows
  const byId = new Map(rows.map(r => [r.name.split(/\s/)[0], r.seq.toUpperCase().replace(/\./g, '-')]))
  const out = input.map((_, i) => byId.get(`s${i}`))
  if (out.some(r => r === undefined)) throw new EngineOutputError('The aligner lost some sequences')
  const aligned = out as string[]
  const width = aligned[0]?.length ?? 0
  if (aligned.some(r => r.length !== width)) throw new EngineOutputError('The aligner returned rows of different lengths')
  aligned.forEach((row, i) => {
    if (row.replace(/-/g, '') !== input[i].toUpperCase()) {
      throw new EngineOutputError(`The aligner changed the residues of sequence ${i + 1}`)
    }
  })
  return aligned
}


// ---------------------------------------------------------------------------
// Picker helpers
// ---------------------------------------------------------------------------

/** Engine and strategy as one picker value: "auto", "mafft:linsi", "kalign", ... */
export function engineChoice(s: EngineSettings): string {
  return s.engine === 'mafft' ? `mafft:${s.mafftStrategy}` : s.engine
}

export function settingsFromChoice(choice: string, base: EngineSettings): EngineSettings {
  const [engine, strategy] = choice.split(':')
  return {
    ...base,
    engine: engine as EngineId,
    mafftStrategy: (strategy as MafftStrategy | undefined) ?? base.mafftStrategy,
  }
}

/** The picker's options, in order. */
export const ENGINE_CHOICES: readonly { value: string; label: string; title: string; pairwiseOnly?: boolean }[] = [
  { value: 'auto', label: 'Automatic', title: engineInfo('auto').summary },
  ...MAFFT_STRATEGIES.map(s => ({ value: `mafft:${s.id}`, label: `MAFFT ${s.label}`, title: s.summary })),
  { value: 'muscle', label: 'MUSCLE 5', title: engineInfo('muscle').summary },
  { value: 'kalign', label: 'Kalign 3', title: engineInfo('kalign').summary },
  { value: 'pairwise', label: 'Pairwise (two sequences)', title: engineInfo('pairwise').summary, pairwiseOnly: true },
]

/** "under a second", "about 12 s", "about 3 min". */
export function formatDuration(s: number): string {
  if (s < 1) return 'under a second'
  if (s < 60) return `about ${Math.round(s)} s`
  return `about ${Math.round(s / 60)} min`
}

const METHOD_OF: Record<ConcreteEngine, AlnMethod> = { mafft: 'mafft', muscle: 'muscle', kalign: 'kalign', pairwise: 'global' }

/** The document origin method for an engine run. */
export function methodOf(engine: ConcreteEngine, settings?: EngineSettings): AlnMethod {
  return engine === 'pairwise' && settings?.pairwiseMode === 'local' ? 'local' : METHOD_OF[engine]
}
