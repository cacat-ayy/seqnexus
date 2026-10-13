import { describe, it, expect } from 'vitest'
import { allCoding, codingChanges, codingLabel } from './effects'
import { describeVariant, type RefFeature, type VariantEvidence } from './variants'
import { mappedFeatures } from './features'
import { writeVcf } from './vcf'

// ATG AAA GCT TGG TAA (M K A W *), then TAGATAG read on past the end.
const SEQ = 'ATGAAAGCTTGGTAA' + 'TAGATAG'
const CDS: RefFeature = { id: 'c', name: 'gfp', type: 'CDS', start: 0, end: 15, strand: 1 }
const one = (...a: Parameters<typeof codingChanges>) => codingChanges(...a)[0] ?? null

describe('substitutions', () => {
  it('reads a lost stop on to the next one', () => {
    // TAA > CAA: Gln, then TAG straight after.
    expect(one('SNP', 12, 'T', 'C', [CDS], SEQ)).toMatchObject({ cdna: 'c.13T>C', protein: '*5Qext*2', hgvsp: 'p.(Ter5GlnextTer2)', effect: 'Stop lost' })
  })

  it('names a synonymous change with =', () => {
    expect(one('SNP', 8, 'T', 'C', [CDS], SEQ)).toMatchObject({ protein: 'A3=', hgvsp: 'p.(Ala3=)', codonFrom: 'GCT', codonTo: 'GCC' })
  })
})

describe('insertions and deletions', () => {
  it('follows a frameshift to its new stop', () => {
    // Without the T of TGG: ATG AAA GCT GGT AAT AGA TAG, M K A G N R *.
    expect(one('Deletion', 9, 'T', '', [CDS], SEQ)).toMatchObject({ cdna: 'c.10del', protein: 'W4Gfs*4', hgvsp: 'p.(Trp4GlyfsTer4)', effect: 'Frameshift' })
  })

  it('moves a deletion 3\' in a run before naming it', () => {
    // Any A of AAA is c.6del; the frame then reads M K L G N R *.
    for (const p of [3, 4, 5]) {
      expect(one('Deletion', p, 'A', '', [CDS], SEQ)).toMatchObject({ cdna: 'c.6del', protein: 'A3Lfs*5' })
    }
  })

  it('names an insertion that repeats the bases before it a duplication', () => {
    expect(one('Insertion', 6, '', 'AAA', [CDS], SEQ)).toMatchObject({ cdna: 'c.4_6dup', protein: 'K2dup', hgvsp: 'p.(Lys2dup)', effect: 'In-frame insertion' })
  })

  it('calls an in-frame insertion of a stop nonsense', () => {
    expect(one('Insertion', 6, '', 'TAA', [CDS], SEQ)).toMatchObject({ cdna: 'c.6_7insTAA', protein: 'A3*', hgvsp: 'p.(Ala3Ter)', effect: 'Nonsense' })
  })

  it('names an in-frame insertion inside a codon by the residues it adds', () => {
    // GCT > GCCCCT: Ala, then a new Pro before Trp.
    const c = one('Insertion', 8, '', 'CCC', [CDS], SEQ)!
    expect(c.effect).toBe('In-frame insertion')
    expect(c.protein).toBe('A3_W4insP')
  })

  it('calls a deletion that takes the start codon from before it start lost', () => {
    const seq = 'CCC' + SEQ
    const f = { ...CDS, start: 3, end: 18 }
    expect(one('Deletion', 2, 'CAT', '', [f], seq)).toMatchObject({ cdna: 'c.-1_2del', protein: 'M1?', hgvsp: 'p.(Met1?)', effect: 'Start lost' })
    // describeVariant puts it in the feature although its first base is outside.
    const v = describeVariant(evidence({ type: 'Deletion', pos: 2, ref: 'CAT', alt: '' }), { refSeq: seq, features: [f], againstConsensus: false })
    expect(v.coding?.effect).toBe('Start lost')
  })

  it('reads a reverse-strand frameshift on its own strand', () => {
    // The minus strand of SEQ[0..15] reads TTA CCA AGC TTT CAT.
    const rev: RefFeature = { ...CDS, strand: -1 }
    const c = one('Deletion', 10, 'G', '', [rev], SEQ)!
    expect(c.effect).toBe('Frameshift')
    expect(c.cdna).toBe('c.5del')
    expect(c.protein.startsWith('P2')).toBe(true)
  })
})

describe('spliced features', () => {
  // Exon ATGAAA, intron GTAAGTCCCCAG, exon GCTTGGTAA.
  const GENE = 'ATGAAA' + 'GTAAGTCCCCAG' + 'GCTTGGTAA' + 'CC'
  const spliced: RefFeature = { id: 's', name: 'gene1', type: 'CDS', start: 0, end: 27, strand: 1, segments: [[0, 6], [18, 27]] }

  it('numbers exon bases through the exons only', () => {
    // C of GCT in exon 2 is c.8.
    expect(one('SNP', 19, 'C', 'A', [spliced], GENE)).toMatchObject({ cdna: 'c.8C>A', protein: 'A3D', effect: 'Missense' })
  })

  it('calls splice site and intron variants from the nearer exon', () => {
    expect(one('SNP', 6, 'G', 'T', [spliced], GENE)).toMatchObject({ cdna: 'c.6+1G>T', protein: '', hgvsp: 'p.?', effect: 'Splice site' })
    expect(one('SNP', 17, 'G', 'A', [spliced], GENE)).toMatchObject({ cdna: 'c.7-1G>A', effect: 'Splice site' })
    expect(one('SNP', 11, 'T', 'A', [spliced], GENE)).toMatchObject({ cdna: 'c.6+6T>A', hgvsp: 'p.(=)', effect: 'Intron' })
    // A deletion across the exon's end takes the splice site with it.
    expect(one('Deletion', 4, 'AAGT', '', [spliced], GENE)).toMatchObject({ cdna: 'c.5_6+2del', effect: 'Splice site' })
  })

  it('labels an intron change by its effect alone', () => {
    expect(codingLabel(one('SNP', 11, 'T', 'A', [spliced], GENE)!)).toBe('intron')
    expect(codingLabel(one('SNP', 19, 'C', 'A', [spliced], GENE)!)).toBe('A3D (missense)')
  })
})

describe('overlapping coding features', () => {
  it('reports every coding feature hit, the most severe first', () => {
    // TGG > TAG stops gfp; on the minus strand the same base turns CCA (P2) into CTA (L).
    const orf: RefFeature = { id: 'o', name: 'orf2', type: 'ORF', start: 0, end: 15, strand: -1 }
    const v = describeVariant(evidence({ type: 'SNP', pos: 10, ref: 'G', alt: 'A' }), { refSeq: SEQ, features: [orf, CDS], againstConsensus: false })
    expect(v.coding).toMatchObject({ feature: 'gfp', protein: 'W4*', effect: 'Nonsense' })
    expect(v.otherCoding).toHaveLength(1)
    expect(v.otherCoding[0]).toMatchObject({ feature: 'orf2', protein: 'P2L', effect: 'Missense' })
    expect(allCoding(v).map(c => c.feature)).toEqual(['gfp', 'orf2'])
  })
})

describe('circular references', () => {
  it('reads a CDS across the origin', () => {
    // ATG AAA GCT TGG TAA split over the origin: its last 5 bases first.
    const seq = 'GGTAA' + 'CCCCC' + 'ATGAAAGCTT'
    const f: RefFeature = { id: 'w', name: 'wrap', type: 'CDS', start: 10, end: 5, strand: 1 }
    // The middle base of TGG (c.11) is index 0: TGG > TAG.
    expect(one('SNP', 0, 'G', 'A', [f], seq, true)).toMatchObject({ cdna: 'c.11G>A', protein: 'W4*' })
  })
})

describe('exports', () => {
  it('lists every coding change in VCF, with = percent-encoded', () => {
    const orf: RefFeature = { id: 'o', name: 'orf2', type: 'ORF', start: 0, end: 15, strand: -1 }
    const v = describeVariant(evidence({ type: 'SNP', pos: 10, ref: 'G', alt: 'A' }), { refSeq: SEQ, features: [orf, CDS], againstConsensus: false })
    const syn = describeVariant(evidence({ type: 'SNP', pos: 8, ref: 'T', alt: 'C' }), { refSeq: SEQ, features: [CDS], againstConsensus: false })
    const vcf = writeVcf({ references: [{ name: 'r', bases: SEQ, variants: [{ v, filters: [] }, { v: syn, filters: [] }] }], source: 'test', referenceName: 'r' })
    expect(vcf).toContain('EFF=Nonsense|gfp|c.11G>A|p.(Trp4Ter),Missense|orf2|c.5C>T|p.(Pro2Leu)')
    expect(vcf).toContain('EFF=Synonymous|gfp|c.9T>C|p.(Ala3%3D)')
  })

  it('writes a sample column with a haploid call when given a sample', () => {
    const v = describeVariant(evidence({ type: 'SNP', pos: 10, ref: 'G', alt: 'A' }), { refSeq: SEQ, features: [CDS], againstConsensus: false })
    const vcf = writeVcf({ references: [{ name: 'r', bases: SEQ, variants: [{ v, filters: [] }] }], source: 'test', sample: 'clone 1', referenceName: 'r' })
    const lines = vcf.trim().split('\n')
    expect(lines).toContain('##FORMAT=<ID=AD,Number=R,Type=Integer,Description="Reads carrying the reference and the variant">')
    expect(lines.find(l => l.startsWith('#CHROM'))!.split('\t').slice(-2)).toEqual(['FORMAT', 'clone 1'])
    const row = lines[lines.length - 1].split('\t')
    expect(row[8]).toBe('GT:AD:DP:AF')
    expect(row[9].split(':')[0]).toBe(v.frequency >= 0.5 ? '1' : '0')
    expect(row[9].split(':')[2]).toBe(String(v.coverage))
  })

  it('stays sites-only without a sample', () => {
    const v = describeVariant(evidence({ type: 'SNP', pos: 10, ref: 'G', alt: 'A' }), { refSeq: SEQ, features: [CDS], againstConsensus: false })
    const vcf = writeVcf({ references: [{ name: 'r', bases: SEQ, variants: [{ v, filters: [] }] }], source: 'test', referenceName: 'r' })
    expect(vcf).not.toContain('FORMAT')
  })
})

describe('features kept with a mapping', () => {
  const kept: RefFeature[] = [{ ...CDS, name: 'kept' }]
  const tab = (length: number) => ({
    id: 't',
    doc: { name: 'ref', sequence: { bases: 'A'.repeat(length), topology: 'linear' }, annotations: [{ toData: () => ({ id: 'a', name: 'open', type: 'CDS', start: 0, end: 15, strand: 1 as const }) }] },
  })

  it('uses the open sequence while it is open and the length mapped to', () => {
    expect(mappedFeatures({ tabId: 't', length: 22, features: kept }, [tab(22)]).map(f => f.name)).toEqual(['open'])
  })

  it('falls back to the copy kept when the sequence is closed or changed length', () => {
    expect(mappedFeatures({ tabId: 't', length: 22, features: kept }, []).map(f => f.name)).toEqual(['kept'])
    expect(mappedFeatures({ tabId: 't', length: 22, features: kept }, [tab(30)]).map(f => f.name)).toEqual(['kept'])
    expect(mappedFeatures({ tabId: null, length: 22 }, [])).toEqual([])
  })
})

function evidence(o: Pick<VariantEvidence, 'type' | 'pos' | 'ref' | 'alt'>): VariantEvidence {
  return {
    ...o, c0: Math.max(0, o.pos), c1: Math.max(0, o.pos) + Math.max(1, o.ref.length),
    coverage: 10, count: 10, pValue: 1e-9, forward: { ref: 0, alt: 5 }, reverse: { ref: 0, alt: 5 }, meanQuality: 30,
  }
}
