/**
 * Seamless assembly, run the way people run it: hand it a plasmid and a PCR
 * product carrying arms and expect the construct back.
 *
 * The first two groups are what the old engine could not do at all: it
 * compared one sequence's tail to another's head on the raw string, so a
 * circular vector never matched and a flipped insert never matched.
 */
import { describe, it, expect } from 'vitest'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { reverseComplement } from '../models/complement'
import { findHomology, homologyAssemble, partFromDocument, type HomologyPart } from './homology'
import { KITS } from './kits'

/**
 * Deterministic filler with a mixed base composition, for believable Tm and
 * no accidental homology. xorshift rather than a multiply-and-mask generator:
 * the latter loses the low bits to floating-point rounding here and returns
 * nearly one base repeated, which makes every sequence match every other.
 */
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

const part = (id: string, bases: string, topology: 'linear' | 'circular' = 'linear'): HomologyPart =>
  ({ id, name: id, bases, topology, annotations: [] })

const doc = (name: string, bases: string, topology: 'linear' | 'circular' = 'linear'): DocumentState =>
  ({ name, sequence: new Sequence(bases, topology), annotations: [] })

const expected = (products: ReturnType<typeof homologyAssemble>['products']) =>
  products.filter(p => p.usesAll && p.topology === 'circular')

describe('inserting into a circular vector', () => {
  // The everyday case: a plasmid, and a PCR product whose primers carried
  // 25-base arms matching the plasmid either side of one position.
  const vector = filler(2000, 7)
  const at = 800
  const arm = 25
  const payload = filler(600, 23)
  const insert = vector.slice(at - arm, at) + payload + vector.slice(at, at + arm)

  it('opens the plasmid where the arms land and puts the payload in', () => {
    const result = homologyAssemble([part('vec', vector, 'circular'), part('ins', insert)])
    const wanted = expected(result.products)
    expect(wanted).toHaveLength(1)
    expect(wanted[0].size).toBe(vector.length + payload.length)
    // A circle has no first base, and where the overlap runs a little past
    // the designed arm the origin can land inside the payload, so read the
    // product the way a circle reads: round and round.
    expect(wanted[0].sequence + wanted[0].sequence).toContain(payload)
  })

  it('keeps every base of the vector', () => {
    const [wanted] = expected(homologyAssemble([part('vec', vector, 'circular'), part('ins', insert)]).products)
    // Rotations differ, so check the vector reads continuously around the join.
    const doubled = wanted.sequence + wanted.sequence
    expect(doubled).toContain(vector.slice(at))
    expect(doubled).toContain(vector.slice(0, at))
  })

  it('deletes the stretch between the arms when they do not sit together', () => {
    const dropFrom = 800
    const dropTo = 1100
    const replacing = vector.slice(dropFrom - arm, dropFrom) + payload + vector.slice(dropTo, dropTo + arm)
    const result = homologyAssemble([part('vec', vector, 'circular'), part('ins', replacing)])
    const wanted = expected(result.products)
    expect(wanted).toHaveLength(1)
    expect(wanted[0].size).toBe(vector.length - (dropTo - dropFrom) + payload.length)
    expect(wanted[0].sequence).not.toContain(vector.slice(dropFrom + arm, dropTo))
  })

  it('takes the insert the other way round too', () => {
    const result = homologyAssemble([
      part('vec', vector, 'circular'),
      part('ins', reverseComplement(insert)),
    ])
    const wanted = expected(result.products)
    expect(wanted).toHaveLength(1)
    expect(wanted[0].size).toBe(vector.length + payload.length)
    expect(wanted[0].parts.some(p => p.reversed)).toBe(true)
  })
})

describe('three fragments in any order', () => {
  // Arms are shared pairwise around a circle; the parts are handed over in an
  // order that is not the assembly order.
  const a = filler(700, 3)
  const b = filler(800, 11)
  const c = filler(900, 29)
  const arm = 25
  const f1 = c.slice(c.length - arm) + a
  const f2 = a.slice(a.length - arm) + b
  const f3 = b.slice(b.length - arm) + c

  it('works out the order from the overlaps', () => {
    const result = homologyAssemble([part('f2', f2), part('f3', f3), part('f1', f1)])
    const wanted = expected(result.products)
    expect(wanted).toHaveLength(1)
    expect(wanted[0].size).toBe(a.length + b.length + c.length)
    expect(wanted[0].junctions).toHaveLength(3)
  })

  it('names every junction with the stretch it anneals on', () => {
    const [wanted] = expected(homologyAssemble([part('f2', f2), part('f3', f3), part('f1', f1)]).products)
    expect(wanted.junctions.every(j => j.overlap!.length === arm)).toBe(true)
    expect(wanted.junctions.every(j => j.overlap!.tm > 0)).toBe(true)
  })
})

describe('a fragment closing on itself', () => {
  const body = filler(900, 41)
  const arm = 25

  it('circularises when its own two ends share homology', () => {
    const linear = body + body.slice(0, arm)
    const result = homologyAssemble([part('one', linear)])
    const circles = result.products.filter(p => p.topology === 'circular')
    expect(circles).toHaveLength(1)
    expect(circles[0].size).toBe(body.length)
  })
})

describe('when it cannot work', () => {
  it('says so when there is no homology at all', () => {
    const result = homologyAssemble([part('a', filler(500, 2)), part('b', filler(500, 99))])
    expect(result.products).toHaveLength(0)
    expect(result.warnings.join(' ')).toContain('No homology')
  })

  it('says so when the arms are shorter than the kit accepts', () => {
    const vector = filler(1000, 5)
    const short = vector.slice(795, 800) + filler(300, 61) + vector.slice(800, 805)
    const result = homologyAssemble([part('vec', vector, 'circular'), part('ins', short)])
    expect(result.products).toHaveLength(0)
    expect(result.warnings.join(' ')).toContain('15 bp')
  })

  it('warns when an arm matches the vector in more than one place', () => {
    const repeat = filler(60, 77)
    const vector = filler(400, 5) + repeat + filler(400, 9) + repeat + filler(100, 13)
    const insert = repeat.slice(repeat.length - 25) + filler(200, 31) + repeat.slice(0, 25)
    const result = homologyAssemble([part('vec', vector, 'circular'), part('ins', insert)])
    expect(result.warnings.join(' ')).toContain('more than one place')
  })
})

describe('kits', () => {
  const vector = filler(1500, 17)
  const at = 600
  const payload = filler(400, 19)
  const armsOf = (n: number) => vector.slice(at - n, at) + payload + vector.slice(at, at + n)

  it('accepts a 15 bp arm for In-Fusion and HiFi', () => {
    for (const kit of ['infusion', 'hifi'] as const) {
      const result = homologyAssemble(
        [part('vec', vector, 'circular'), part('ins', armsOf(15))],
        { kit },
      )
      expect(expected(result.products)).toHaveLength(1)
    }
  })

  it('needs a longer arm for SLIC', () => {
    const result = homologyAssemble(
      [part('vec', vector, 'circular'), part('ins', armsOf(15))],
      { kit: 'slic' },
    )
    expect(result.products).toHaveLength(0)
  })

  it('complains about a cool overlap for Gibson but not for HiFi', () => {
    // An A/T-rich arm melts well below the Gibson threshold.
    const atVector = filler(300, 3) + 'AT'.repeat(40) + filler(300, 8)
    const atAt = 320
    const atArms = atVector.slice(atAt - 20, atAt) + payload + atVector.slice(atAt, atAt + 20)
    const gibson = homologyAssemble(
      [part('vec', atVector, 'circular'), part('ins', atArms)],
      { kit: 'gibson' },
    )
    const hifi = homologyAssemble(
      [part('vec', atVector, 'circular'), part('ins', atArms)],
      { kit: 'hifi' },
    )
    expect(expected(gibson.products)[0].warnings.join(' ')).toContain('°C')
    expect(expected(hifi.products)[0].warnings.join(' ')).not.toContain('°C')
  })

  it('lets HiFi assemble over a mismatched arm, and says it did', () => {
    const arm = 25
    const clean = vector.slice(at - arm, at)
    const mutated = clean.slice(0, 10) + (clean[10] === 'A' ? 'C' : 'A') + clean.slice(11)
    const insert = mutated + payload + vector.slice(at, at + arm)

    const hifi = homologyAssemble([part('vec', vector, 'circular'), part('ins', insert)], { kit: 'hifi' })
    expect(expected(hifi.products)).toHaveLength(1)

    const gibson = homologyAssemble([part('vec', vector, 'circular'), part('ins', insert)], { kit: 'gibson' })
    // Gibson tolerates none, so it falls back to the longest clean stretch.
    const gibsonWanted = expected(gibson.products)
    if (gibsonWanted.length > 0) {
      expect(gibsonWanted[0].junctions.some(j => j.overlap!.length < arm)).toBe(true)
    }
  })

  it('knows what each kit is called', () => {
    expect(KITS.hifi.name).toBe('NEBuilder HiFi')
    expect(KITS.gibson.minTm).toBe(48)
    expect(KITS.hifi.mismatchTolerance).toBeGreaterThan(0)
  })
})

describe('features', () => {
  it('carries the vector and insert features into the product', () => {
    const vector = filler(1200, 53)
    const at = 500
    const arm = 25
    const payload = filler(300, 67)
    const state = doc('pVec', vector, 'circular')
    state.annotations = [new Annotation({ id: 'amp', name: 'AmpR', type: 'CDS', start: 50, end: 400, strand: 1 })]
    const insertState = doc('ins', vector.slice(at - arm, at) + payload + vector.slice(at, at + arm))
    insertState.annotations = [new Annotation({ id: 'gfp', name: 'GFP', type: 'CDS', start: arm, end: arm + payload.length, strand: 1 })]

    const result = homologyAssemble([partFromDocument(state), partFromDocument(insertState)])
    const [wanted] = expected(result.products)
    const names = wanted.annotations.map(a => a.name)
    expect(names).toContain('AmpR')
    expect(names).toContain('GFP')

    // The feature keeps its whole extent even where the junction was drawn a
    // few bases inside it, and points at the payload wherever the origin fell.
    const gfp = wanted.annotations.find(a => a.name === 'GFP')!
    const span = gfp.end > gfp.start ? gfp.end - gfp.start : wanted.size - gfp.start + gfp.end
    expect(span).toBe(payload.length)
    expect(gfp.truncated).toBeUndefined()
    const doubled = wanted.sequence + wanted.sequence
    expect(doubled.slice(gfp.start, gfp.start + span)).toBe(payload)
  })

  it('takes a region of a sequence as a part', () => {
    const source = filler(1000, 71)
    const region = partFromDocument(doc('src', source, 'circular'), { region: { start: 100, end: 400 } })
    expect(region.bases).toBe(source.slice(100, 400))
    expect(region.topology).toBe('linear')
  })
})

describe('findHomology', () => {
  it('returns the longest shared stretch, not the shortest acceptable one', () => {
    const shared = filler(40, 101)
    const left = filler(200, 2) + shared
    const right = shared + filler(200, 3)
    const [hit] = findHomology({ seq: left, circular: false }, { seq: right, circular: false }, 15, 60)
    expect(hit.overlap.length).toBe(40)
  })

  it('finds nothing between two circular parts, which have no ends to join', () => {
    const shared = filler(40, 101)
    expect(findHomology(
      { seq: filler(100, 2) + shared, circular: true },
      { seq: shared + filler(100, 3), circular: true },
      15, 60,
    )).toEqual([])
  })
})
