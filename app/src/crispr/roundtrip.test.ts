/**
 * What the order tab emits, put back through the app's own cloning engine.
 *
 * The question these tests answer is the one a bench scientist asks: if I
 * order these two oligos and ligate them into the vector the panel names, do
 * I get the guide I designed, with nothing added and nothing lost at either
 * join? Nothing here trusts the order builder's own arithmetic. The oligos go
 * into a vector built from the published cloning arrangement, the vector is
 * digested and ligated by cloning/run.ts, and the product is read back.
 */

import { describe, expect, it } from 'vitest'

import { runDesign } from '../cloning/run'
import type { CloningDesign, DesignPart } from '../cloning/design'
import { annealOligos } from '../cloning/duplex'
import { annealedOligos, vectorPreset } from './order'
import { builtInNuclease } from './nucleases'
import { scaffoldById } from './scaffolds'
import { reverseComplement } from '../models/complement'

const spCas9 = builtInNuclease('spcas9')!
const cas12a = builtInNuclease('ascas12a')!
const sgRna = scaffoldById('spcas9-sgrna')!
const SPACER = 'ACGTTGCATGCAACGTTGCA'

/**
 * A vector arranged the way the widely shared SpCas9 vectors are: the end of
 * the U6 promoter, the four bases the transcript is cloned against, a filler
 * flanked by two inverted BbsI sites, and then the scaffold.
 *
 * BbsI is GAAGAC(2/6), so a site reading left to right leaves the four bases
 * after its two-base spacer as a 5' overhang on the fragment to its right,
 * and a site reading right to left leaves four as a 5' overhang on the
 * fragment to its left. Putting one of each around the filler is what makes
 * the digest offer CACC on one side and the scaffold's own GTTT on the other.
 */
function bbsiVector(): string {
  const u6Tail = 'TTTCCCAAATTTGGGAAACCCTTGGAAAGGACGAAACACC'.slice(0, 36)
  const filler = 'TTGGCCAATTGGCCAATTGG'
  return [
    u6Tail,
    'CACC',          // kept by the upstream fragment's bottom strand
    'AT',            // the two bases BbsI skips
    'GTCTTC',        // BbsI reading right to left
    filler,
    'GAAGAC',        // BbsI reading left to right
    'AT',
    sgRna.sequence,  // starts GTTT, which is the other overhang
    'GGATCCAAGCTTGAATTCACTAGTCCGCGGTACCGTCGACTGCAGGAATTCGATATCAAG',
  ].join('')
}

function part(over: Partial<DesignPart> & Pick<DesignPart, 'id' | 'name' | 'bases'>): DesignPart {
  return {
    role: 'insert',
    topology: 'linear',
    annotations: [],
    orientation: 'either',
    ...over,
  } as DesignPart
}

function design(parts: DesignPart[]): CloningDesign {
  return {
    method: 'restriction',
    parts,
    enzymes: ['BbsI'],
    typeIIS: 'BbsI',
    kit: 'hifi',
    gateway: 'LR',
    topo: 'TA',
    purify: true,
  }
}

describe('an ordered guide put back into its vector', () => {
  const order = annealedOligos({
    name: 'g1',
    spacer: SPACER,
    nuclease: spCas9,
    promoter: 'u6',
    vector: vectorPreset('bbsi-cacc'),
  })
  const [top, bottom] = order.oligos

  it('anneals into a duplex with the two overhangs the vector offers', () => {
    const duplex = annealOligos({ top: top.sequence, bottom: bottom.sequence })
    expect(duplex.mismatches).toBe(0)
    expect(duplex.left).toMatchObject({ span: 'CACC', kind: 'five_prime' })
    expect(duplex.right).toMatchObject({ span: 'AAAC', kind: 'five_prime' })
    // AAAC pairs with the first four bases of the scaffold, which is how the
    // spacer ends up against it with nothing in between.
    expect(reverseComplement('AAAC')).toBe(sgRna.sequence.slice(0, 4))
  })

  it('ligates into the construct the panel says it will', () => {
    const vector = bbsiVector()
    const result = runDesign(design([
      part({ id: 'v', name: 'vector', bases: vector, topology: 'circular', role: 'vector', enzymes: ['BbsI'] }),
      part({
        id: 'g',
        name: 'guide',
        bases: top.sequence,
        duplex: { top: top.sequence, bottom: bottom.sequence },
      }),
    ]))
    expect(result.problems).toEqual([])
    const expected = result.products.filter(
      p => p.usesAll && p.topology === 'circular' && p.recut.length === 0)
    expect(expected.length).toBeGreaterThan(0)

    // The transcript, as it should read in the finished plasmid: the first G,
    // the spacer, then the scaffold, in one piece.
    const transcript = 'G' + SPACER + sgRna.sequence
    const found = expected.filter(p => {
      const doubled = (p.sequence + p.sequence).toUpperCase()
      return doubled.includes('CACC' + transcript)
    })
    expect(found.length).toBeGreaterThan(0)
    // Nothing is left over: the product is the vector minus the filler plus
    // the spacer and its G.
    const filler = 'TTGGCCAATTGGCCAATTGG'
    for (const product of found) {
      expect(product.topology).toBe('circular')
      expect(product.sequence.toUpperCase()).not.toContain(filler)
      expect(product.sequence.length).toBe(vector.length - filler.length - 2 * 8 + SPACER.length + 1)
    }
  })

  it('puts a spacer that already starts with G in without doubling it', () => {
    const gSpacer = 'G' + SPACER.slice(1)
    const withG = annealedOligos({
      name: 'g2', spacer: gSpacer, nuclease: spCas9, promoter: 'u6', vector: vectorPreset('bbsi-cacc'),
    })
    const result = runDesign(design([
      part({ id: 'v', name: 'vector', bases: bbsiVector(), topology: 'circular', role: 'vector', enzymes: ['BbsI'] }),
      part({
        id: 'g',
        name: 'guide',
        bases: withG.oligos[0].sequence,
        duplex: { top: withG.oligos[0].sequence, bottom: withG.oligos[1].sequence },
      }),
    ]))
    const transcript = 'CACC' + gSpacer + sgRna.sequence
    const found = result.products.filter(p =>
      p.usesAll && p.topology === 'circular' && p.recut.length === 0
      && (p.sequence + p.sequence).toUpperCase().includes(transcript))
    expect(found.length).toBeGreaterThan(0)
    for (const product of found) {
      expect((product.sequence + product.sequence).toUpperCase()).not.toContain('CACCGG' + SPACER.slice(1))
    }
  })
})

describe('the Cas12a vector preset', () => {
  const repeat = scaffoldById('ascas12a-crrna')!
  const spacer = 'ACGTTGCATGCAACGTTGCATGC'

  it('matches the repeat it has to be cloned against', () => {
    // The repeat comes before the spacer, so the upstream overhang is the
    // repeat's own last four bases.
    const preset = vectorPreset('cas12a-agat')!
    expect(preset.topOverhang).toBe(repeat.sequence.slice(-4))
  })

  it('anneals cleanly, and says what the vector has to carry downstream', () => {
    const order = annealedOligos({
      name: 'c1', spacer, nuclease: cas12a, scaffold: repeat,
      promoter: 'u6', vector: vectorPreset('cas12a-agat'),
    })
    const duplex = annealOligos({
      top: order.oligos[0].sequence,
      bottom: order.oligos[1].sequence,
    })
    expect(duplex.mismatches).toBe(0)
    expect(duplex.left).toMatchObject({ span: 'AGAT', kind: 'five_prime' })
    expect(duplex.right).toMatchObject({ span: 'TGTA', kind: 'five_prime' })
    // Recorded so the gap is visible: the downstream overhang asks the vector
    // to continue with these four bases straight after the spacer, and
    // nothing the app ships does. The preset names no vector either, so it
    // cannot be checked any further here.
    expect(reverseComplement('TGTA')).toBe('TACA')
    expect(repeat.sequence.startsWith('TACA')).toBe(false)
  })
})
