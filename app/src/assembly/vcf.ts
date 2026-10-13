/**
 * Variants as VCF 4.2, for the Sanger contig and the NGS mapping alike.
 *
 * VCF anchors an insertion or deletion on the reference base before it
 * (REF "GCA", ALT "G" for a deletion of CA after a G); at the first base
 * of a reference, where there is no base before, on the base after instead,
 * as the specification says. QUAL is the variant's P-value Phred-scaled
 * (-10 log10 p, at most 999). FILTER is PASS or the filters it failed.
 * Strand counts go in DP4 (reference forward, reference reverse, variant
 * forward, variant reverse), as samtools writes them.
 */

import { FILTERS, variantQual, type FilterId, type Variant } from './variants'
import { allCoding } from './effects'
import { samNames } from '../ngs/refNames'

export interface VcfReference {
  name: string
  /** The reference's bases (positions in the variants count along them). */
  bases: string
  variants: readonly { v: Variant; filters: readonly FilterId[] }[]
}

/** A VCF field value: no spaces, semicolons, commas or equals signs. */
const field = (s: string) => s.replace(/[\s;,=]+/g, '_')

/** A sample column's header: a tab or a line break would end it. */
const sampleName = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim() || 'sample'

/** An HGVS name as a field value: its "=" (an unchanged protein) percent-encoded, as VEP writes it. */
const hgvsField = (s: string) => field(s.replace(/=/g, '%3D'))

/** POS, REF and ALT of a variant, with the anchor base an indel needs. */
export function vcfAlleles(v: Variant, bases: string): { pos: number; ref: string; alt: string } {
  const seq = bases.toUpperCase()
  if (v.type === 'SNP') return { pos: v.position, ref: v.ref.toUpperCase(), alt: v.alt.toUpperCase() }
  if (v.type === 'Deletion') {
    const p0 = v.position - 1
    if (p0 > 0) return { pos: p0, ref: seq[p0 - 1] + v.ref.toUpperCase(), alt: seq[p0 - 1] }
    const after = seq[v.ref.length] ?? 'N'
    return { pos: 1, ref: v.ref.toUpperCase() + after, alt: after }
  }
  const b = v.position - 1
  if (b >= 0) return { pos: b + 1, ref: seq[b], alt: seq[b] + v.alt.toUpperCase() }
  return { pos: 1, ref: seq[0] ?? 'N', alt: v.alt.toUpperCase() + (seq[0] ?? 'N') }
}

export function writeVcf(o: {
  references: readonly VcfReference[]
  /** What the variants were called from, for the header. */
  source: string
  /**
   * The sample's name, for a sample column (GT:AD:DP:AF). Tools that merge
   * or compare call sets (bcftools merge, GATK) need one; without it the
   * file is sites-only.
   */
  sample?: string
  /** Where the reference came from (a sequence's name). */
  referenceName: string
  date?: Date
}): string {
  const d = o.date ?? new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  // The names the BAM export writes, so the two line up in IGV.
  const names = samNames(o.references.map(r => r.name))
  const head = [
    '##fileformat=VCFv4.2',
    `##fileDate=${ymd}`,
    '##source=SeqNexus',
    `##reference=${field(o.referenceName)}`,
    `##SeqNexusCalledFrom=${field(o.source)}`,
    ...o.references.map((r, i) => `##contig=<ID=${names[i]},length=${r.bases.length}>`),
    ...(Object.keys(FILTERS) as FilterId[]).map(f => `##FILTER=<ID=${FILTERS[f].vcf},Description="${FILTERS[f].label}">`),
    '##INFO=<ID=DP,Number=1,Type=Integer,Description="Reads covering the site">',
    '##INFO=<ID=AO,Number=1,Type=Float,Description="Reads carrying the variant">',
    '##INFO=<ID=AF,Number=1,Type=Float,Description="Share of the covering reads carrying the variant">',
    '##INFO=<ID=DP4,Number=4,Type=Integer,Description="Reference forward, reference reverse, variant forward, variant reverse reads">',
    '##INFO=<ID=SB,Number=1,Type=Float,Description="Strand bias: Fisher exact test P on the DP4 counts">',
    '##INFO=<ID=TYPE,Number=1,Type=String,Description="snp, ins or del">',
    '##INFO=<ID=HP,Number=1,Type=Integer,Description="Length of the homopolymer run the indel is in">',
    '##INFO=<ID=REP,Number=1,Type=String,Description="Short tandem repeat the variant is in">',
    '##INFO=<ID=FEAT,Number=.,Type=String,Description="Features of the reference the variant is in">',
    '##INFO=<ID=EFF,Number=.,Type=String,Description="Coding effect in each coding feature, most severe first: effect|feature|HGVS cDNA change|HGVS protein change">',
    ...(o.sample ? [
      '##FORMAT=<ID=GT,Number=1,Type=String,Description="Haploid call: 1 when most reads covering the site carry the variant, 0 when most do not">',
      '##FORMAT=<ID=AD,Number=R,Type=Integer,Description="Reads carrying the reference and the variant">',
      '##FORMAT=<ID=DP,Number=1,Type=Integer,Description="Reads covering the site">',
      '##FORMAT=<ID=AF,Number=A,Type=Float,Description="Share of the covering reads carrying the variant">',
    ] : []),
    `#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO${o.sample ? `\tFORMAT\t${sampleName(o.sample)}` : ''}`,
  ]
  const lines: string[] = []
  o.references.forEach((r, i) => {
    const rows = r.variants.map(x => ({ ...x, a: vcfAlleles(x.v, r.bases) })).sort((x, y) => x.a.pos - y.a.pos)
    for (const { v, filters, a } of rows) {
      const info = [
        `DP=${v.coverage}`,
        `AO=${Number(v.count.toFixed(1))}`,
        `AF=${v.frequency.toFixed(4)}`,
        `DP4=${v.forward.ref},${v.reverse.ref},${v.forward.alt},${v.reverse.alt}`,
        `SB=${v.strandBiasP.toPrecision(3)}`,
        `TYPE=${v.type === 'SNP' ? 'snp' : v.type === 'Insertion' ? 'ins' : 'del'}`,
        ...(v.homopolymer ? [`HP=${v.homopolymer}`] : []),
        ...(v.repeat ? [`REP=${field(v.repeat)}`] : []),
        ...(v.features.length ? [`FEAT=${v.features.map(field).join(',')}`] : []),
        ...(v.coding ? [`EFF=${allCoding(v).map(c => `${field(c.effect)}|${field(c.feature)}|${hgvsField(c.cdna)}|${hgvsField(c.hgvsp)}`).join(',')}`] : []),
      ].join(';')
      const filter = filters.length ? filters.map(f => FILTERS[f].vcf).join(';') : 'PASS'
      // A plasmid or a clone is one haploid molecule: the call is whether most reads carry the variant.
      const sample = o.sample
        ? ['GT:AD:DP:AF', `${v.frequency >= 0.5 ? 1 : 0}:${v.forward.ref + v.reverse.ref},${Math.round(v.count)}:${v.coverage}:${v.frequency.toFixed(4)}`]
        : []
      lines.push([names[i], a.pos, '.', a.ref, a.alt, variantQual(v).toFixed(1), filter, info, ...sample].join('\t'))
    }
  })
  return [...head, ...lines].join('\n') + '\n'
}
