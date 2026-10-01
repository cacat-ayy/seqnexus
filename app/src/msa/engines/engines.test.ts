import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_ENGINE_SETTINGS, EngineOutputError, engineChoice, engineInput, engineLabel, estimateSeconds,
  formatDuration, mafftArgs, methodOf, readEngineOutput, resolveEngine, settingsFromChoice, shapeOf, toolCommand,
  type EngineSettings,
} from './catalog'
import { runTool } from './emscripten'
import { makeDoc } from '../model'
import { replaceRegion } from '../edit'

const settings = (over: Partial<EngineSettings> = {}): EngineSettings => ({ ...DEFAULT_ENGINE_SETTINGS, ...over })

describe('engine catalogue', () => {
  it('picks pairwise for two sequences and MAFFT or Kalign by cost', () => {
    expect(resolveEngine(settings(), shapeOf(['ACGT', 'ACGA']), 'dna')).toBe('pairwise')
    expect(resolveEngine(settings(), shapeOf(Array(10).fill('M'.repeat(300))), 'protein')).toBe('mafft')
    expect(resolveEngine(settings(), shapeOf(Array(500).fill('A'.repeat(3000))), 'dna')).toBe('kalign')
    expect(resolveEngine(settings({ engine: 'muscle' }), shapeOf(['A', 'C']), 'dna')).toBe('muscle')
  })

  it('estimates grow with the input', () => {
    const small = shapeOf(Array(10).fill('A'.repeat(200)))
    const big = shapeOf(Array(100).fill('A'.repeat(2000)))
    for (const e of ['mafft', 'muscle', 'kalign'] as const) {
      expect(estimateSeconds(e, big, 'dna')).toBeGreaterThan(estimateSeconds(e, small, 'dna'))
    }
    expect(estimateSeconds('kalign', big, 'dna')).toBeLessThan(estimateSeconds('muscle', big, 'dna'))
  })

  it('builds MAFFT command lines per strategy', () => {
    const l = mafftArgs('linsi', 'protein')
    expect(l.filter(a => a === '_')).toHaveLength(2)
    expect(l).toContain('-L')
    expect(l).toContain('-P')
    expect(l.slice(-2)).toEqual(['-i', 'input.fa'])
    expect(mafftArgs('ginsi', 'dna')).toContain('-A')
    expect(mafftArgs('ginsi', 'dna')).toContain('-D')
    expect(mafftArgs('einsi', 'dna')).toContain('-N')
    expect(toolCommand('mafft', settings(), 'dna').output).toBe('pre')
    expect(toolCommand('kalign', settings(), 'protein').output).toBe('out.afa')
  })

  it('labels engines and round-trips picker choices', () => {
    expect(engineLabel('mafft', settings({ mafftStrategy: 'ginsi' }))).toBe('MAFFT G-INS-i')
    expect(engineLabel('pairwise', settings({ pairwiseMode: 'local' }))).toMatch(/local/)
    const s = settingsFromChoice('mafft:einsi', settings())
    expect(s).toMatchObject({ engine: 'mafft', mafftStrategy: 'einsi' })
    expect(engineChoice(s)).toBe('mafft:einsi')
    expect(settingsFromChoice('kalign', s)).toMatchObject({ engine: 'kalign', mafftStrategy: 'einsi' })
    expect(methodOf('pairwise', settings({ pairwiseMode: 'local' }))).toBe('local')
    expect(formatDuration(0.3)).toBe('under a second')
    expect(formatDuration(125)).toBe('about 2 min')
  })

  it('reads output back in input order and checks it', () => {
    const input = ['ACGT', 'AGT']
    expect(engineInput(input)).toBe('>s0\nACGT\n>s1\nAGT\n')
    expect(readEngineOutput('>s1\nA-GT\n>s0\nacgt\n', input)).toEqual(['ACGT', 'A-GT'])
    expect(() => readEngineOutput('', input)).toThrow(EngineOutputError)
    expect(() => readEngineOutput('>s0\nACGT\n', input)).toThrow(/lost/)
    expect(() => readEngineOutput('>s0\nACGT\n>s1\nAGG-\n', input)).toThrow(/changed/)
    expect(() => readEngineOutput('>s0\nACGT\n>s1\nA-GT-\n', input)).toThrow(/lengths/)
  })
})

describe('replaceRegion', () => {
  const origin = { method: 'manual' as const, at: 0 }
  it('splices a realigned block and pads the other rows when it grows', () => {
    const d = makeDoc([{ name: 'a', seq: 'AAACGTTT' }, { name: 'b', seq: 'AAAC-TTT' }, { name: 'c', seq: 'GGGGGGGG' }], origin)
    const ids = d.rows.slice(0, 2).map(r => r.id)
    const out = replaceRegion(d, ids, 3, 5, ['C-G', '-C-'])
    expect(out.rows.map(r => r.seq)).toEqual(['AAAC-GTTT', 'AAA-C-TTT', 'GGGGG-GGG'])
  })

  it('pads realigned rows when the block shrinks, unless every row was realigned', () => {
    const d = makeDoc([{ name: 'a', seq: 'A--C' }, { name: 'b', seq: 'A--C' }, { name: 'c', seq: 'GGGG' }], origin)
    const two = d.rows.slice(0, 2).map(r => r.id)
    expect(replaceRegion(d, two, 0, 4, ['AC', 'AC']).rows.map(r => r.seq)).toEqual(['AC--', 'AC--', 'GGGG'])
    const pair = makeDoc([{ name: 'a', seq: 'A--C' }, { name: 'b', seq: 'A--C' }], origin)
    expect(replaceRegion(pair, pair.rows.map(r => r.id), 0, 4, ['AC', 'AC']).rows.map(r => r.seq)).toEqual(['AC', 'AC'])
  })
})

// ---------------------------------------------------------------------------
// The real WebAssembly builds, as the worker runs them
// ---------------------------------------------------------------------------

// Tests run from app/; the builds live in the repository root's wasm/.
const wasmDir = resolve(process.cwd(), '..', 'wasm') + '/'
const load = (program: string) => ({
  glue: readFileSync(`${wasmDir}${program}.js`, 'utf8'),
  wasm: readFileSync(`${wasmDir}${program}.wasm`),
})

const PROTEINS = [
  'MKLVFFAEDVGSNKGAIIGLMVGGVVIATVIVITLVMLKKKQYTSIHHGVVEVDAAVTPEER',
  'MKLVFFAEDVGSKGAIIGLMVGGVVIAIVITLVMLKKKQYTSIHHGIVEVDAAVTPEER',
  'MRLVFFAEDVGSNKGAIIGLMVGGVVIATVIVITLVMLRKKQYTSIHHGVVEVDAAVSPEER',
  'MKLVFFAEDVGSNKGAIIGLMVGGVVIATVIVITLVMLKKKQYTSIHHGVVEVDAAVTPEERHHHH',
]
const DNA = [
  'ATGGCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCC',
  'ATGGCCAAGCTTGCATGCTGCAGGTCGACTCTAGAGGATCC',
  'ATGGCCAAGCTAGCATGCCTGCAGGTCGACTCTAGAGGATCCTT',
]

describe.each([
  ['mafft L-INS-i', 'mafft', settings({ engine: 'mafft', mafftStrategy: 'linsi' })],
  ['mafft G-INS-i', 'mafft', settings({ engine: 'mafft', mafftStrategy: 'ginsi' })],
  ['mafft E-INS-i', 'mafft', settings({ engine: 'mafft', mafftStrategy: 'einsi' })],
  ['muscle', 'muscle', settings({ engine: 'muscle' })],
  ['kalign', 'kalign', settings({ engine: 'kalign' })],
] as const)('%s (WebAssembly)', (_name, engine, s) => {
  for (const [kind, seqs] of [['protein', PROTEINS], ['dna', DNA]] as const) {
    it(`aligns ${kind} and returns every residue in input order`, async () => {
      const cmd = toolCommand(engine, s, kind)
      const { glue, wasm } = load(cmd.program)
      const r = await runTool(glue, wasm, { args: cmd.args, files: { [cmd.input]: engineInput(seqs) }, outputs: [cmd.output] })
      const rows = readEngineOutput(r.files[cmd.output], seqs)
      expect(rows).toHaveLength(seqs.length)
      expect(rows.every(x => x.length === rows[0].length)).toBe(true)
      expect(rows[0].length).toBeGreaterThanOrEqual(Math.max(...seqs.map(x => x.length)))
    }, 30_000)
  }
})
