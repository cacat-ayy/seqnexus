/**
 * Libraries: every way of taking one part from each position, run through the
 * ordinary engines. The cases here are the ones people actually build — one
 * vector against a list of inserts, and a two-position combinatorial set —
 * plus the housekeeping that stops a big run from being a trap.
 */
import { describe, it, expect } from 'vitest'
import { Sequence } from '../models/Sequence'
import type { DocumentState } from '../models/Document'
import {
  binOf,
  binsFromDesign,
  buildName,
  combinationCount,
  estimateWork,
  runBulk,
  summarise,
  type DesignBin,
} from './bulk'
import { parsePartList, productTableCsv, productsFasta } from './bulk-io'
import { emptyDesign, partFromDoc, type CloningDesign, type DesignPart } from './design'

function filler(n: number, seed = 1): string {
  let x = (seed | 0) || 1
  let out = ''
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x |= 0
    x ^= x >>> 17
    x ^= x << 5; x |= 0
    out += 'ACGT'[(x >>> 8) & 3]
  }
  return out
}

const doc = (name: string, bases: string, topology: 'linear' | 'circular' = 'linear'): DocumentState =>
  ({ name, sequence: new Sequence(bases, topology), annotations: [] })

const part = (name: string, bases: string, role: 'vector' | 'insert', topology: 'linear' | 'circular' = 'linear'): DesignPart =>
  ({ ...partFromDoc(doc(name, bases, topology), { role }), role })

const bin = (name: string, parts: DesignPart[]): DesignBin => ({ id: `bin_${name}`, name, parts })

// A plasmid, and inserts carrying 25-base arms from either side of one point.
const VECTOR = filler(1800, 7)
const AT = 700
const ARM = 25
const payloads = [filler(300, 11), filler(450, 23), filler(600, 31)]
const withArms = (payload: string) =>
  VECTOR.slice(AT - ARM, AT) + payload + VECTOR.slice(AT, AT + ARM)

const homologyDesign = (): CloningDesign => ({ ...emptyDesign('homology'), kit: 'hifi' })

describe('counting combinations', () => {
  it('multiplies the positions together', () => {
    expect(combinationCount([bin('a', [part('1', 'ACGT', 'insert')]), bin('b', [
      part('2', 'ACGT', 'insert'), part('3', 'ACGT', 'insert'),
    ])])).toBe(2)
  })

  it('is nothing when a position has no parts to choose from', () => {
    expect(combinationCount([bin('a', []), bin('b', [part('1', 'ACGT', 'insert')])])).toBe(0)
    expect(combinationCount([])).toBe(0)
  })
})

describe('one vector against a list of inserts', () => {
  const bins = [
    bin('Vector', [part('pVec', VECTOR, 'vector', 'circular')]),
    bin('Insert', payloads.map((p, i) => part(`ins${i + 1}`, withArms(p), 'insert'))),
  ]

  it('builds one construct per insert', () => {
    const result = runBulk(homologyDesign(), bins)
    expect(result.total).toBe(3)
    expect(result.rows).toHaveLength(3)
    expect(result.rows.every(r => r.verdict === 'ok')).toBe(true)
  })

  it('gets the size of each construct right', () => {
    const result = runBulk(homologyDesign(), bins)
    expect(result.rows.map(r => r.size)).toEqual(payloads.map(p => VECTOR.length + p.length))
  })

  it('names the positions it varied', () => {
    expect(runBulk(homologyDesign(), bins).binNames).toEqual(['Vector', 'Insert'])
  })

  it('reports which parts went into each row', () => {
    const result = runBulk(homologyDesign(), bins)
    expect(result.rows.map(r => r.partNames[1])).toEqual(['ins1', 'ins2', 'ins3'])
  })

  it('keeps the product so it can be opened', () => {
    const result = runBulk(homologyDesign(), bins)
    expect(result.rows[0].product?.sequence).toContain(payloads[0])
  })
})

describe('a combinatorial set', () => {
  // Two positions that vary: a choice of payload and a choice of tail, which
  // is the shape of a promoter x CDS library.
  const tails = [filler(200, 41), filler(260, 47)]
  const bins = [
    bin('Vector', [part('pVec', VECTOR, 'vector', 'circular')]),
    bin('Payload', payloads.slice(0, 2).map((p, i) => part(`pay${i + 1}`, withArms(p), 'insert'))),
  ]

  it('runs every combination of the positions', () => {
    const three = [...bins, bin('Spare', tails.map((t, i) => part(`spare${i + 1}`, t, 'insert')))]
    expect(combinationCount(three)).toBe(4)
    const result = runBulk(homologyDesign(), three, { limit: 10 })
    expect(result.rows).toHaveLength(4)
    // Each row is a distinct choice.
    expect(new Set(result.rows.map(r => r.choice.join('-'))).size).toBe(4)
  })

  it('walks the last position fastest, so rows read like a nested list', () => {
    const three = [...bins, bin('Spare', tails.map((t, i) => part(`spare${i + 1}`, t, 'insert')))]
    const result = runBulk(homologyDesign(), three, { limit: 10 })
    expect(result.rows.map(r => r.choice)).toEqual([[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1]])
  })
})

describe('when a combination does not work', () => {
  const bins = [
    bin('Vector', [part('pVec', VECTOR, 'vector', 'circular')]),
    bin('Insert', [
      part('good', withArms(payloads[0]), 'insert'),
      part('no arms', filler(400, 97), 'insert'),
    ]),
  ]

  it('says so for that row and carries on with the rest', () => {
    const result = runBulk(homologyDesign(), bins)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].verdict).toBe('ok')
    expect(result.rows[1].verdict).toBe('none')
    expect(result.rows[1].notes.join(' ')).toContain('No homology')
    expect(result.rows[1].size).toBe(0)
  })

  it('counts the outcomes for a summary line', () => {
    expect(summarise(runBulk(homologyDesign(), bins).rows)).toEqual({ ok: 1, ambiguous: 0, none: 1 })
  })
})

describe('keeping a big run in hand', () => {
  const many = (n: number) =>
    bin('Insert', Array.from({ length: n }, (_, i) => part(`ins${i}`, withArms(filler(200, i + 3)), 'insert')))

  it('stops at the limit and says it did', () => {
    const bins = [bin('Vector', [part('pVec', VECTOR, 'vector', 'circular')]), many(8)]
    const result = runBulk(homologyDesign(), bins, { limit: 3 })
    expect(result.rows).toHaveLength(3)
    expect(result.total).toBe(8)
    expect(result.truncated).toBe(true)
  })

  it('reports progress as it goes', () => {
    const bins = [bin('Vector', [part('pVec', VECTOR, 'vector', 'circular')]), many(4)]
    const seen: number[] = []
    runBulk(homologyDesign(), bins, { onProgress: done => seen.push(done) })
    expect(seen).toEqual([1, 2, 3, 4])
  })

  it('stops when asked to', () => {
    const bins = [bin('Vector', [part('pVec', VECTOR, 'vector', 'circular')]), many(6)]
    let done = 0
    const result = runBulk(homologyDesign(), bins, {
      onProgress: n => { done = n },
      shouldStop: () => done >= 2,
    })
    expect(result.rows.length).toBeLessThan(6)
  })

  it('has some idea how much work a run is', () => {
    const small = [bin('Vector', [part('pVec', VECTOR, 'vector', 'circular')]), many(2)]
    const big = [bin('Vector', [part('pVec', VECTOR, 'vector', 'circular')]), many(20)]
    expect(estimateWork(big)).toBeGreaterThan(estimateWork(small))
  })
})

describe('naming the constructs', () => {
  it('falls back to what the engine called the product', () => {
    expect(buildName(undefined, ['pVec', 'ins1'], 1, 'pVec::ins1')).toBe('pVec::ins1')
    expect(buildName('  ', ['pVec', 'ins1'], 1, 'pVec::ins1')).toBe('pVec::ins1')
  })

  it('fills the chosen parts into a template', () => {
    expect(buildName('{1}-{2}', ['pVec', 'ins1'], 1, 'x')).toBe('pVec-ins1')
  })

  it('numbers the rows', () => {
    expect(buildName('lib{#}', ['a'], 7, 'x')).toBe('lib7')
  })

  it('leaves a token it cannot fill alone', () => {
    expect(buildName('{1}-{4}', ['a'], 1, 'x')).toBe('a-{4}')
  })

  it('names rows through a whole run', () => {
    const bins = [
      bin('Vector', [part('pVec', VECTOR, 'vector', 'circular')]),
      bin('Insert', [part('gfp', withArms(payloads[0]), 'insert')]),
    ]
    const result = runBulk(homologyDesign(), bins, { nameTemplate: '{1}_{2}' })
    expect(result.rows[0].name).toBe('pVec_gfp')
  })
})

describe('bins from an existing design', () => {
  it('turns each part into a position with one choice, vector first', () => {
    const design: CloningDesign = {
      ...emptyDesign('homology'),
      parts: [part('ins', withArms(payloads[0]), 'insert'), part('pVec', VECTOR, 'vector', 'circular')],
    }
    const bins = binsFromDesign(design)
    expect(bins.map(b => b.name)).toEqual(['Vector', 'ins'])
    expect(bins.every(b => b.parts.length === 1)).toBe(true)
  })

  it('wraps a single part as its own position', () => {
    const p = part('one', 'ACGTACGT', 'insert')
    expect(binOf(p).parts).toEqual([p])
    expect(binOf(p, 'Position 1').name).toBe('Position 1')
  })
})

describe('reading a part list', () => {
  it('reads a comma-separated list into positions', () => {
    const text = [
      'bin,name,sequence,topology,role',
      'Vector,pVec,ACGTACGTAA,circular,vector',
      'Insert,gfp,TTTTGGGGAA,linear,insert',
      'Insert,rfp,CCCCAAAATT,linear,insert',
    ].join('\n')
    const { bins, skipped } = parsePartList(text)
    expect(skipped).toEqual([])
    expect(bins.map(b => b.name)).toEqual(['Vector', 'Insert'])
    expect(bins[1].parts.map(p => p.name)).toEqual(['gfp', 'rfp'])
    expect(bins[0].parts[0].topology).toBe('circular')
    expect(bins[0].parts[0].role).toBe('vector')
  })

  it('reads tab-separated just as well', () => {
    const text = 'bin\tname\tsequence\nA\tone\tACGT\nA\ttwo\tTTTT'
    expect(parsePartList(text).bins[0].parts).toHaveLength(2)
  })

  it('accepts the column names people actually use', () => {
    const text = 'position,label,bases\nP1,one,ACGT'
    const { bins } = parsePartList(text)
    expect(bins[0].name).toBe('P1')
    expect(bins[0].parts[0].name).toBe('one')
  })

  it('puts a list with no bin column into one position per part', () => {
    const text = 'name,sequence\nalpha,ACGT\nbeta,TTTT'
    const { bins } = parsePartList(text)
    expect(bins.map(b => b.name)).toEqual(['alpha', 'beta'])
  })

  it('says which lines it could not use, and keeps the rest', () => {
    const text = 'bin,name,sequence\nA,ok,ACGT\nA,empty,\nA,protein,MKVLA!!\nA,fine,TTTT'
    const { bins, skipped } = parsePartList(text)
    expect(bins[0].parts.map(p => p.name)).toEqual(['ok', 'fine'])
    expect(skipped.map(s => s.line)).toEqual([3, 4])
    expect(skipped[1].reason).toContain('not DNA')
  })

  it('refuses a file with no sequence column rather than guessing', () => {
    const { bins, skipped } = parsePartList('name,notes\nalpha,something')
    expect(bins).toEqual([])
    expect(skipped[0].reason).toContain('No sequence column')
  })

  it('handles a quoted field with a comma in it', () => {
    const text = 'bin,name,sequence\nA,"gfp, wild type",ACGT'
    expect(parsePartList(text).bins[0].parts[0].name).toBe('gfp, wild type')
  })

  it('takes an empty file quietly', () => {
    expect(parsePartList('')).toEqual({ bins: [], skipped: [] })
  })
})

describe('writing the results out', () => {
  const bins = [
    bin('Vector', [part('pVec', VECTOR, 'vector', 'circular')]),
    bin('Insert', [
      part('gfp', withArms(payloads[0]), 'insert'),
      part('no arms, sorry', filler(400, 97), 'insert'),
    ]),
  ]

  it('writes a row per construct with a column per position', () => {
    const csv = productTableCsv(runBulk(homologyDesign(), bins))
    const lines = csv.split('\n')
    expect(lines[0]).toBe('Name,Vector,Insert,Size (bp),Topology,Outcome,Notes')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('As designed')
    expect(lines[2]).toContain('No product')
  })

  it('quotes a field holding a comma', () => {
    const csv = productTableCsv(runBulk(homologyDesign(), bins))
    expect(csv).toContain('"no arms, sorry"')
  })

  it('writes the constructs as FASTA, skipping the ones that did not form', () => {
    const fasta = productsFasta(runBulk(homologyDesign(), bins).rows)
    expect(fasta.split('\n').filter(l => l.startsWith('>'))).toHaveLength(1)
    expect(fasta).toContain('circular')
  })
})
