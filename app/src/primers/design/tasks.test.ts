import { describe, it, expect } from 'vitest'
import { designTailedPair, homologyArms, restrictionTail, findSite, bindingPart } from './cloning'
import { designMutagenesis, applyEdit, quikChangeTm } from './mutagenesis'
import { tileSequencingPrimers } from './sequencing'
import { offTargets } from '../offtarget'
import { findBindingSites } from '../binding'
import { reverseComplement } from '../../models/complement'
import { DEFAULT_CONSTRAINTS, type PrimerConstraints } from '../scoring'

function template(n: number, seed = 5): string {
  let x = seed
  let s = ''
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5
    s += 'ACGT'[(x >>> 7) & 3]
  }
  return s
}

const T = template(3000)
const C: PrimerConstraints = { ...DEFAULT_CONSTRAINTS, minTm: 50, maxTm: 70, optTm: 60, minGC: 20, maxGC: 80 }

describe('cloning primers', () => {
  it('starts the binding parts exactly at the insert ends', () => {
    const pair = designTailedPair(T, 'linear', { start: 500, end: 1400 }, '', '', C)
    if ('error' in pair) throw new Error(pair.error)
    expect(T.slice(500).startsWith(pair.forward.anneal)).toBe(true)
    expect(T.slice(0, 1400).endsWith(reverseComplement(pair.reverse.anneal))).toBe(true)
  })

  it('puts the tail in front of the binding part, and judges only the binding part', () => {
    const tail = restrictionTail('GAATTC', 'TAAGCA')
    expect(tail).toBe('TAAGCAGAATTC')
    const pair = designTailedPair(T, 'linear', { start: 500, end: 1400 }, tail, tail, C)
    if ('error' in pair) throw new Error(pair.error)
    expect(pair.forward.sequence).toBe(tail + pair.forward.anneal)
    expect(pair.forward.tm).toBeGreaterThanOrEqual(C.minTm)
    expect(pair.forward.tm).toBeLessThanOrEqual(C.maxTm)
  })

  it('finds a recognition site on either strand', () => {
    expect(findSite('AAGAATTCAA', 'GAATTC')).toEqual([2])
    // BsaI GGTCTC is not palindromic: its reverse complement counts too.
    expect(findSite('AAGAGACCAA', 'GGTCTC')).toEqual([2])
  })

  it('reads homology arms off the vector either side of the insertion point', () => {
    const vector = template(1000, 77)
    const arms = homologyArms(vector, 'circular', 400, 400, 20)
    if ('error' in arms) throw new Error(arms.error)
    expect(arms.fwdTail).toBe(vector.slice(380, 400))
    expect(arms.revTail).toBe(reverseComplement(vector.slice(400, 420)))
  })

  it('skips the replaced vector bases when the insert replaces a region', () => {
    const vector = template(1000, 77)
    const arms = homologyArms(vector, 'linear', 400, 450, 15)
    if ('error' in arms) throw new Error(arms.error)
    expect(arms.right).toBe(vector.slice(450, 465))
  })

  it('refuses arms that would run off a linear vector', () => {
    expect('error' in homologyArms(template(100), 'linear', 5, 5, 20)).toBe(true)
  })

  it('prefers a binding part in the Tm range', () => {
    const b = bindingPart(T, false, 500, 1, C)!
    expect(b.inRange).toBe(true)
  })
})

describe('mutagenesis', () => {
  const at = { start: 1000, end: 1003 }

  it('back-to-back: the new bases lead the forward primer; the primers meet at the edit', () => {
    const d = designMutagenesis({ template: T, topology: 'circular', at, replacement: 'GGG', method: 'back-to-back', constraints: C })
    if ('error' in d) throw new Error(d.error)
    expect(d.forward.startsWith('GGG')).toBe(true)
    expect(T.slice(1003).startsWith(d.forward.slice(3))).toBe(true)
    expect(T.slice(0, 1000).endsWith(reverseComplement(d.reverse))).toBe(true)
  })

  it('overlapping: the edit sits in the middle and the reverse is the reverse complement', () => {
    const d = designMutagenesis({ template: T, topology: 'circular', at, replacement: 'GGG', method: 'overlapping', constraints: C })
    if ('error' in d) throw new Error(d.error)
    expect(d.reverse).toBe(reverseComplement(d.forward))
    const i = d.forward.indexOf('GGG', 9)
    expect(d.forward.slice(0, i)).toBe(T.slice(1000 - i, 1000))
    expect(d.forward.length).toBeGreaterThanOrEqual(25)
  })

  it('handles a deletion and an insertion', () => {
    const del = designMutagenesis({ template: T, topology: 'circular', at, replacement: '', method: 'back-to-back', constraints: C })
    const ins = designMutagenesis({ template: T, topology: 'circular', at: { start: 1000, end: 1000 }, replacement: 'CATCAT', method: 'back-to-back', constraints: C })
    expect('error' in del).toBe(false)
    expect('error' in ins).toBe(false)
    if (!('error' in ins)) expect(ins.summary).toMatch(/Insert CATCAT/)
  })

  it('refuses a no-op', () => {
    const same = T.slice(1000, 1003)
    expect('error' in designMutagenesis({ template: T, topology: 'circular', at, replacement: same, method: 'back-to-back', constraints: C })).toBe(true)
  })

  it('applies the edit to give the mutant', () => {
    expect(applyEdit('AAACCCGGG', { start: 3, end: 6 }, 'tt')).toBe('AAATTGGG')
  })

  it('computes the QuikChange Tm by its rule', () => {
    // 81.5 + 0.41·50 − 675/30 − (1/30·100)
    expect(quikChangeTm('GC'.repeat(7) + 'AT'.repeat(8), 1, false)).toBeCloseTo(81.5 + 0.41 * 46.667 - 22.5 - 3.333, 1)
  })
})

describe('sequencing primers', () => {
  it('tiles a region with primers that each bind once, leaving no gaps', () => {
    const plan = tileSequencingPrimers(T, 'linear', { start: 600, end: 2200 }, C,
      { readLength: 700, overlap: 100, lead: 50, strands: 'forward' })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.primers.length).toBeGreaterThanOrEqual(3)
    for (const p of plan.primers) {
      const sites = findBindingSites([{ id: 'p', name: 'p', sequence: p.sequence, role: 'primer' }], T, 'linear').get('p')!
      expect(sites).toHaveLength(1)
      expect(p.strand).toBe(1)
    }
    expect(plan.gaps).toEqual([])
  })

  it('reads the reverse strand too when asked', () => {
    const plan = tileSequencingPrimers(T, 'linear', { start: 600, end: 1400 }, C)
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.primers.some(p => p.strand === -1)).toBe(true)
  })
})

describe('off-target scan', () => {
  it('finds a weak second site where only the 3′ end pairs', () => {
    const primer = T.slice(500, 522)
    // Plant the primer's last 13 bases elsewhere, with a different 5' part.
    const planted = T.slice(0, 2000) + 'TTTTTTTTT' + primer.slice(9) + T.slice(2022)
    const r = offTargets({ id: 'p', name: 'p', sequence: primer, role: 'primer' }, planted, 'linear')
    expect(r.sites).toHaveLength(1)
    expect(r.weak.length).toBeGreaterThanOrEqual(1)
  })

  it('reports nothing weak for a clean primer', () => {
    const r = offTargets({ id: 'p', name: 'p', sequence: T.slice(500, 522), role: 'primer' }, T, 'linear')
    expect(r.weak).toEqual([])
  })
})
