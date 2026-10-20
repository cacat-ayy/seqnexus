import { describe, expect, it } from 'vitest'
import { PUC19_SEQUENCE, demoDocument } from '../demo'
import { refFeatures } from '../assembly/features'
import { reverseComplement } from '../models/complement'
import { chooseConstruct, compareCircular, comparisonContig, consensusDifferences } from './compare'

const puc = PUC19_SEQUENCE.toUpperCase()
const L = puc.length
const features = refFeatures(demoDocument().annotations.map(a => a.toData()))
const rotate = (s: string, k: number) => s.slice(k) + s.slice(0, k)
const other = (b: string) => ({ A: 'C', C: 'G', G: 'T', T: 'A' } as Record<string, string>)[b]

/** pUC19 with changes, 1-based positions: a SNP, a deletion of n bases, an insertion after a base. */
function mutant(o: { snp?: number; del?: [number, number]; ins?: [number, string] }): string {
  const b = puc.split('')
  if (o.snp) b[o.snp - 1] = other(b[o.snp - 1])
  if (o.ins) b.splice(o.ins[0], 0, ...o.ins[1])
  if (o.del) b.splice(o.del[0] - 1, o.del[1])
  return b.join('')
}

function differences(consensus: string) {
  const cmp = compareCircular(puc, consensus)!
  const doc = comparisonContig(cmp, { name: 'pUC19', tabId: null, length: L, features }, 's1')
  return { cmp, diffs: consensusDifferences(doc, puc, features) }
}

describe('compareCircular', () => {
  it('finds the origin of a consensus that starts elsewhere', () => {
    const { cmp, diffs } = differences(rotate(puc, 1000))
    expect(cmp.reversed).toBe(false)
    // Base 1 of pUC19 is base 1001 of the rotated circle... counted from its own start: L - 1000 + 1.
    expect(cmp.startInFile).toBe(L - 1000 + 1)
    expect(cmp.rotated).toBe(puc)
    expect(cmp.identity).toBe(1)
    expect(cmp.ambiguous).toBe(false)
    expect(diffs).toEqual([])
  })

  it('turns a reverse-complemented, origin-shifted consensus round', () => {
    const given = reverseComplement(rotate(puc, 333))
    const { cmp, diffs } = differences(given)
    expect(cmp.reversed).toBe(true)
    expect(cmp.rotated).toBe(puc)
    // pUC19 base 1 is base 334 of rotate(puc, 333)'s... in the file, counted on its own strand.
    expect(given[cmp.startInFile - 1]).toBe(reverseComplement(puc[0]))
    expect(reverseComplement(given)[L - cmp.startInFile]).toBe(puc[0])
    expect(diffs).toEqual([])
  })

  it('lists a SNP, a deletion and an insertion at construct positions', () => {
    const cons = rotate(mutant({ snp: 700, del: [1700, 3], ins: [2000, 'GGG'] }), 1234)
    const { cmp, diffs } = differences(cons)
    expect(cmp.ambiguous).toBe(false)
    const brief = diffs.map(d => `${d.type} ${d.position}`)
    expect(brief).toContain('SNP 700')
    expect(diffs.find(d => d.type === 'Deletion')!.ref.length).toBe(3)
    expect(diffs.find(d => d.type === 'Insertion')!.alt).toBe('GGG')
    expect(diffs).toHaveLength(3)
    // A change in AmpR (1626..2486, reverse strand) gets its protein change.
    const del = diffs.find(d => d.type === 'Deletion')!
    expect(del.features).toEqual(['AmpR'])
    expect(del.coding?.effect).toBeTruthy()
  })

  it('joins a deletion across the origin into one', () => {
    // pUC19 without its last two bases and its first.
    const cons = rotate(puc.slice(1, L - 2), 500)
    const { diffs } = differences(cons)
    expect(diffs).toHaveLength(1)
    expect(diffs[0].type).toBe('Deletion')
    expect(diffs[0].position).toBe(L - 1)
    expect(diffs[0].ref).toBe(puc.slice(L - 2) + puc[0])
  })

  it('places an insertion at the origin after the last base', () => {
    const cons = rotate(puc + 'ACGTTGCA', 900)
    const { diffs } = differences(cons)
    expect(diffs.map(d => `${d.type} ${d.position} ${d.alt}`)).toEqual([`Insertion ${L} ACGTTGCA`])
  })

  it('maps each consensus base to its construct position', () => {
    const cons = rotate(mutant({ del: [100, 10] }), 50)
    const cmp = compareCircular(puc, cons)!
    // cons[0] is mutant base 51, pUC19 base 51 (0-based 50).
    expect(cmp.constructPosition[0]).toBe(50)
    // Mutant base 100 (0-based 99) is pUC19 base 110 after the deletion.
    expect(cmp.constructPosition[99 - 50]).toBe(109)
  })

  it('is null for an unrelated sequence', () => {
    let s = ''
    let x = 7
    for (let i = 0; i < 3000; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += 'ACGT'[x % 4] }
    expect(compareCircular(puc, s)).toBeNull()
  })

  it('aligns a replaced stretch as a block and keeps the rest exact', () => {
    let junk = ''
    let x = 3
    for (let i = 0; i < 400; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; junk += 'ACGT'[(x >> 8) % 4] }
    const cons = puc.slice(0, 1700) + junk + puc.slice(2100)
    const cmp = compareCircular(puc, cons)!
    expect(cmp.ambiguous).toBe(false)
    expect(cmp.rotated).toBe(cons)
  })
})

describe('chooseConstruct', () => {
  it('picks the construct a consensus is, and aligns when a near twin comes close', () => {
    const twin = mutant({ snp: 1200 })
    const cons = rotate(mutant({ snp: 1200, del: [300, 3] }), 77)
    const pick = chooseConstruct(cons, [puc, twin, 'ACGT'.repeat(500)])
    expect(pick.index).toBe(1)
    expect(pick.close).toEqual([0])
  })

  it('chooses nothing when no sequence matches', () => {
    expect(chooseConstruct(puc, ['ACGT'.repeat(500)]).index).toBeNull()
  })
})

describe('compareCircular on a large plasmid', () => {
  it('lines up a 20 kb construct with 25 SNPs and a 1 kb insertion quickly, every change found', () => {
    let x = 11
    // Math.imul keeps the generator exact; a float multiply loses bits and repeats.
    const rnd = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x / 4294967296 }
    const big = Array.from({ length: 20_000 }, () => 'ACGT'[Math.floor(rnd() * 4)]).join('')
    const m = big.split('')
    const snps = Array.from({ length: 25 }, (_, i) => 300 + i * 777)
    for (const p of snps) m[p] = other(m[p])
    const insert = Array.from({ length: 1000 }, () => 'ACGT'[Math.floor(rnd() * 4)]).join('')
    m.splice(12_345, 0, ...insert)
    const t0 = performance.now()
    const cmp = compareCircular(big, reverseComplement(rotate(m.join(''), 7000)))!
    const ms = performance.now() - t0

    const doc = comparisonContig(cmp, { name: 'big', tabId: null, length: big.length }, 's')
    const diffs = consensusDifferences(doc, big, [])
    expect(diffs.filter(d => d.type === 'SNP').map(d => d.position)).toEqual(snps.map(p => p + 1))
    expect(diffs.filter(d => d.type === 'Insertion').map(d => [d.position, d.alt.length])).toEqual([[12_345, 1000]])
    expect(cmp.ambiguous).toBe(false)
    expect(ms).toBeLessThan(3000)
  })
})
