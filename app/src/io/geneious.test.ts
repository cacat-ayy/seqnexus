/**
 * Tests for the Geneious .geneious reader.
 *
 * The fixtures are small documents built the way Geneious Prime writes them:
 * a flat list of <geneiousDocument> elements whose class says what each is,
 * with fields in <hiddenFields>/<fields> and the content in
 * <originalElement>.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readGeneious, readGeneiousXml, describeSkipped, _resetIdCounter } from './geneious'
import { simpleAb1 } from './abif-testing'

beforeEach(() => {
  _resetIdCounter()
})

const PKG = 'com.biomatters.geneious.publicapi.implementations.sequence'

interface Ann {
  name: string
  type: string
  intervals: [number, number, ('leftToRight' | 'rightToLeft' | 'none')?][]
  qualifiers?: Record<string, string>
}

function annotations(list: Ann[]): string {
  return list.map(a => `<annotation><description>${a.name}</description><type>${a.type}</type><intervals>${
    a.intervals.map(([min, max, dir]) => `<interval><minimumIndex>${min}</minimumIndex><maximumIndex>${max}</maximumIndex><direction>${dir ?? 'leftToRight'}</direction></interval>`).join('')
  }</intervals><qualifiers>${
    Object.entries(a.qualifiers ?? {}).map(([k, v]) => `<qualifier><name>${k}</name><value>${v}</value></qualifier>`).join('')
  }</qualifiers></annotation>`).join('')
}

function document(cls: string, opts: {
  name: string
  override?: string
  description?: string
  fields?: Record<string, string>
  content?: string
}): string {
  const fields = Object.entries(opts.fields ?? {}).map(([k, v]) => `<${k}>${v}</${k}>`).join('')
  return `<geneiousDocument class="${cls}" version="1.3-11">`
    + `<hiddenFields><cache_name>${opts.name}</cache_name>`
    + (opts.override ? `<override_cache_name>${opts.override}</override_cache_name>` : '')
    + (opts.description ? `<description>${opts.description}</description>` : '')
    + `</hiddenFields><fields>${fields}</fields>`
    + `<originalElement>${opts.content ?? ''}</originalElement>`
    + '<additionalXml perUser="true" /></geneiousDocument>'
}

/** A sequence document as Geneious writes a default or GenBank nucleotide sequence. */
function sequenceDoc(opts: {
  name: string
  override?: string
  residues: string
  topology?: 'linear' | 'circular'
  molType?: string
  description?: string
  annotations?: Ann[]
  cls?: string
}): string {
  return document(opts.cls ?? `${PKG}.DefaultNucleotideSequence`, {
    name: opts.name,
    override: opts.override,
    description: opts.description,
    fields: {
      molType: opts.molType ?? 'DNA',
      topology: opts.topology ?? 'linear',
      sequence_length: String(opts.residues.length),
      sequence_residues: opts.residues.slice(0, 500),
    },
    content: `<XMLSerialisableRootElement><name>${opts.name}</name>`
      + `<sequenceAnnotations>${annotations(opts.annotations ?? [])}</sequenceAnnotations>`
      + `<charSequence>${opts.residues}</charSequence></XMLSerialisableRootElement>`,
  })
}

function file(folder: string, ...docs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<geneious version="2026.1.1">`
    + `<versions version="2026.1.1" minimumVersion="6.0"/><folder name="${folder}" />`
    + docs.join('\n') + '</geneious>'
}

describe('documents', () => {
  it('opens every sequence in the folder with its own name, description and topology', () => {
    const r = readGeneiousXml(file('Plasmids',
      sequenceDoc({ name: 'pUC19', residues: 'ACGTACGTAC', topology: 'circular', description: 'Cloning vector pUC19' }),
      sequenceDoc({ name: 'insert', residues: 'GGGCCC' }),
    ))
    expect(r.folder).toBe('Plasmids')
    expect(r.sequences.map(d => d.name)).toEqual(['pUC19', 'insert'])
    expect(r.sequences[0].description).toBe('Cloning vector pUC19')
    expect(r.sequences[0].sequence.topology).toBe('circular')
    expect(r.sequences[1].sequence.topology).toBe('linear')
    expect(r.sequences[1].sequence.bases).toBe('GGGCCC')
  })

  it('uses the name the document was renamed to in Geneious', () => {
    const r = readGeneiousXml(file('F', sequenceDoc({ name: 'NC_045512', override: 'SARS-CoV-2', residues: 'AUUAAAGG' })))
    expect(r.sequences[0].name).toBe('SARS-CoV-2')
  })

  it('uppercases the alternating case Geneious writes residues in, and keeps U', () => {
    const r = readGeneiousXml(file('F', sequenceDoc({ name: 'rna', residues: 'AuUaAaGg', molType: 'RNA' })))
    expect(r.sequences[0].sequence.bases).toBe('AUUAAAGG')
    expect(r.sequences[0].sequence.alphabet).toBe('dna')
  })

  it('opens an amino-acid sequence as a protein', () => {
    const r = readGeneiousXml(file('F',
      sequenceDoc({ name: 'GRK1', residues: 'MdFgSlE', molType: 'AA', cls: 'com.biomatters.plugins.ncbi.documents.GenBankAminoAcidSequence', topology: 'circular' }),
    ))
    expect(r.sequences[0].sequence.alphabet).toBe('protein')
    expect(r.sequences[0].sequence.bases).toBe('MDFGSLE')
    expect(r.sequences[0].sequence.topology).toBe('linear')
  })

  it('reads a GenBank download stored as INSDSeq, with the features of its override properties', () => {
    const insd = document('com.biomatters.plugins.ncbi.documents.GenBankNucleotideSequence', {
      name: 'EU545435',
      override: 'chrM',
      description: 'Homo sapiens mitochondrion',
      fields: { molType: 'DNA', sequence_length: '12', sequence_residues: 'GATCACAGGTCT' },
      content: '<INSDSeq><INSDSeq_locus>EU545435</INSDSeq_locus><INSDSeq_topology>circular</INSDSeq_topology>'
        + '<INSDSeq_feature-table><INSDFeature /></INSDSeq_feature-table>'
        + '<INSDSeq_sequence>gatcacaggtct</INSDSeq_sequence>'
        + `<GeneiousOverrideProperties><annotations>${annotations([{ name: 'D-loop', type: 'D-loop', intervals: [[1, 4]] }])}</annotations></GeneiousOverrideProperties>`
        + '</INSDSeq>',
    })
    const r = readGeneiousXml(file('Human', insd))
    const doc = r.sequences[0]
    expect(doc.name).toBe('chrM')
    expect(doc.sequence.bases).toBe('GATCACAGGTCT')
    expect(doc.sequence.topology).toBe('circular')
    expect(doc.annotations.map(a => a.name)).toEqual(['D-loop'])
  })

  it('takes the current features, not the copy from the original download', () => {
    const edited = sequenceDoc({
      name: 'Starling',
      residues: 'ACGTACGTAC',
      annotations: [{ name: 'COII', type: 'CDS', intervals: [[1, 9]] }],
    }).replace('</XMLSerialisableRootElement>',
      `<GeneiousOverrideProperties><annotations>${annotations([{ name: 'as downloaded', type: 'gene', intervals: [[1, 9]] }])}</annotations></GeneiousOverrideProperties></XMLSerialisableRootElement>`)
    const r = readGeneiousXml(file('F', edited))
    expect(r.sequences[0].annotations.map(a => a.name)).toEqual(['COII'])
  })

  it('keeps each document\'s features on that document', () => {
    const r = readGeneiousXml(file('F',
      sequenceDoc({ name: 'a', residues: 'ACGTACGT', annotations: [{ name: 'fa', type: 'CDS', intervals: [[1, 3]] }] }),
      sequenceDoc({ name: 'b', residues: 'ACGTACGT', annotations: [{ name: 'fb', type: 'gene', intervals: [[2, 4]] }] }),
    ))
    expect(r.sequences[0].annotations.map(a => a.name)).toEqual(['fa'])
    expect(r.sequences[1].annotations.map(a => a.name)).toEqual(['fb'])
  })

  it('reads a sequence list as its member sequences', () => {
    const list = document('com.biomatters.geneious.publicapi.documents.sequence.DefaultSequenceListDocument', {
      name: '2 sequences',
      content: '<XMLSerialisableRootElement>'
        + '<nucleotideSequence><fields><topology>linear</topology><molType>RNA</molType></fields><name>HQ1</name><description>isolate 1</description>'
        + `<sequenceAnnotations>${annotations([{ name: 'env CDS', type: 'CDS', intervals: [[1, 3]] }])}</sequenceAnnotations><charSequence>AUGAGA</charSequence></nucleotideSequence>`
        + '<aminoAcidSequence><fields><molType>AA</molType></fields><name>P1</name><charSequence>MKV</charSequence></aminoAcidSequence>'
        + '</XMLSerialisableRootElement>',
    })
    const r = readGeneiousXml(file('F', list))
    expect(r.sequences.map(d => [d.name, d.sequence.bases, d.sequence.alphabet])).toEqual([
      ['HQ1', 'AUGAGA', 'dna'],
      ['P1', 'MKV', 'protein'],
    ])
    expect(r.sequences[0].description).toBe('isolate 1')
    expect(r.sequences[0].annotations.map(a => a.name)).toEqual(['env CDS'])
  })

  it('reads a plain XML file as well as the zipped form', () => {
    const xml = file('F', sequenceDoc({ name: 'a', residues: 'ACGT' }))
    const plain = readGeneious(new TextEncoder().encode(xml).buffer as ArrayBuffer)
    expect(plain.sequences[0].sequence.bases).toBe('ACGT')
  })

  it('throws on a file with no Geneious documents', () => {
    expect(() => readGeneiousXml('<geneious><folder name="x"/></geneious>')).toThrow()
  })
})

describe('features', () => {
  const read = (anns: Ann[], residues = 'A'.repeat(100), topology: 'linear' | 'circular' = 'linear') =>
    readGeneiousXml(file('F', sequenceDoc({ name: 's', residues, topology, annotations: anns }))).sequences[0]

  it('converts 1-based inclusive intervals and reads the strand', () => {
    const doc = read([
      { name: 'lacZ', type: 'CDS', intervals: [[1, 30]] },
      { name: 'pLac', type: 'promoter', intervals: [[40, 60, 'rightToLeft']] },
      { name: 'site', type: 'misc_feature', intervals: [[70, 72, 'none']] },
    ])
    expect(doc.annotations.map(a => [a.name, a.start, a.end, a.strand])).toEqual([
      ['lacZ', 0, 30, 1],
      ['pLac', 39, 60, -1],
      ['site', 69, 72, 0],
    ])
  })

  it('reads a feature across the origin of a circular sequence as wrapped', () => {
    const fwd = read([{ name: 'bla', type: 'CDS', intervals: [[91, 100], [1, 20]] }], 'A'.repeat(100), 'circular').annotations[0]
    expect([fwd.start, fwd.end, fwd.strand]).toEqual([90, 20, 1])
    // On the reverse strand the intervals are listed 5' to 3' too: low end first.
    const rev = read([{ name: 'cat', type: 'CDS', intervals: [[1, 20, 'rightToLeft'], [91, 100, 'rightToLeft']] }], 'A'.repeat(100), 'circular').annotations[0]
    expect([rev.start, rev.end, rev.strand]).toEqual([90, 20, -1])
    expect(rev.segments).toBeUndefined()
  })

  it('keeps exons as segments', () => {
    const a = read([{ name: 'Domain 4', type: 'Region', intervals: [[1, 10], [21, 30], [41, 50]] }]).annotations[0]
    expect([a.start, a.end]).toEqual([0, 50])
    expect(a.segments).toEqual([[0, 10], [20, 30], [40, 50]])
  })

  it('takes the GenBank key over Geneious\'s own type name, and drops Geneious bookkeeping', () => {
    const a = read([{
      name: 'lacZalpha misc', type: 'polylinker', intervals: [[1, 10]],
      qualifiers: { 'NCBI Feature Key': 'misc_feature', 'note': 'MCS', 'annotation group': 'x1', '.hidden_geneious': 'true', 'NCBI_Join_Type': 'join' },
    }]).annotations[0]
    expect(a.type).toBe('misc_feature')
    expect(a.qualifiers).toEqual({ note: ['MCS'] })
  })

  it('maps Geneious type names that are not feature keys', () => {
    const types = read([
      { name: 'ori', type: 'Origin of replication', intervals: [[1, 5]] },
      { name: 'P', type: 'promoter prokaryotic', intervals: [[1, 5]] },
      { name: 'attB1', type: 'attB1', intervals: [[1, 5]] },
      { name: 'helix', type: 'helix', intervals: [[1, 5]] },
      { name: 'Bond', type: 'Bond', intervals: [[2, 2, 'none'], [9, 9, 'none']] },
      { name: 'odd', type: 'terminator', intervals: [[1, 5]] },
    ]).annotations.map(a => a.type)
    expect(types).toEqual(['rep_origin', 'promoter', 'protein_bind', 'SecStr', 'disulfide', 'terminator'])
  })

  it('takes off the type Geneious appends to a name, as a GenBank import names the feature', () => {
    const names = read([
      { name: 'bla CDS', type: 'CDS', intervals: [[1, 5]], qualifiers: { gene: 'bla', 'NCBI Feature Key': 'CDS' } },
      { name: 'lacZalpha misc', type: 'polylinker', intervals: [[1, 5]], qualifiers: { gene: 'lacZalpha', 'NCBI Feature Key': 'misc_feature' } },
      { name: 'CAP protein binding site protein bind', type: 'protein_bind', intervals: [[1, 5]], qualifiers: { note: 'CAP protein binding site' } },
      { name: 'RNAI promoter (clockwise); GCTACA -10 signal', type: '-10_signal', intervals: [[1, 5]], qualifiers: { note: 'RNAI promoter (clockwise); GCTACA' } },
      { name: 'bla signal peptide', type: 'sig_peptide', intervals: [[1, 5]], qualifiers: { gene: 'bla' } },
      { name: 'ORF1ab peptide', type: 'mat_peptide', intervals: [[1, 5]], qualifiers: { gene: 'ORF1ab', product: 'nsp1' } },
      { name: 'expression cassette gene', type: 'gene', intervals: [[1, 5]], qualifiers: { gene: 'expression_cassette' } },
    ]).annotations.map(a => a.name)
    expect(names).toEqual(['bla', 'lacZalpha', 'CAP protein binding site', 'RNAI promoter (clockwise); GCTACA', 'bla', 'ORF1ab', 'expression cassette'])
  })

  it('names a feature Geneious named by its type alone from its qualifiers', () => {
    const names = read([
      { name: 'rep origin', type: 'rep_origin', intervals: [[1, 5]], qualifiers: { note: 'pMB1 origin of replication' } },
      { name: 'RNA', type: 'misc_RNA', intervals: [[1, 5]], qualifiers: { note: 'RNAII transcript' } },
      { name: 'helix SecStr', type: 'helix', intervals: [[1, 5]], qualifiers: { sec_str_type: 'helix', note: 'helix 1', 'NCBI Feature Key': 'SecStr' } },
      // Geneious sometimes keeps its own type name as the "NCBI" key.
      { name: 'helix SecStr', type: 'helix', intervals: [[1, 5]], qualifiers: { sec_str_type: 'helix', note: 'helix 16', 'NCBI Feature Key': 'helix' } },
      { name: 'turn', type: 'turn', intervals: [[1, 5]] },
    ]).annotations.map(a => a.name)
    expect(names).toEqual(['pMB1 origin of replication', 'RNAII transcript', 'helix 1', 'helix 16', 'turn'])
  })

  it('keeps a name typed in Geneious, and a number after the type', () => {
    const names = read([
      { name: 'GFP CDS', type: 'CDS', intervals: [[1, 5]] },
      { name: 'BioBrick suffix', type: 'misc_feature', intervals: [[1, 5]] },
      { name: 'MAPK10 exon 10', type: 'exon', intervals: [[1, 5]], qualifiers: { gene: 'MAPK10', number: '10' } },
      { name: 'my favourite CDS', type: 'CDS', intervals: [[1, 5]], qualifiers: { gene: 'bla' } },
    ]).annotations.map(a => a.name)
    expect(names).toEqual(['GFP CDS', 'BioBrick suffix', 'MAPK10 exon 10', 'my favourite CDS'])
  })

  it('makes spaces in qualifier names underscores', () => {
    const a = read([{ name: 'x', type: 'misc_feature', intervals: [[1, 5]], qualifiers: { 'Extracted interval': '7,083 -&gt; 7,769' } }]).annotations[0]
    expect(a.qualifiers).toEqual({ Extracted_interval: ['7,083 -> 7,769'] })
  })

  it('skips a feature with no readable interval', () => {
    const doc = read([{ name: 'bad', type: 'CDS', intervals: [] }, { name: 'good', type: 'CDS', intervals: [[1, 3]] }])
    expect(doc.annotations.map(a => a.name)).toEqual(['good'])
  })
})

describe('primers', () => {
  const residues = 'TTTTTGTAAAACGACGGCCAGTTTTTTTTTTTTTTTTTTT'

  it('turns a Geneious primer, which records its oligo, into a primer on the sequence', () => {
    const doc = readGeneiousXml(file('F', sequenceDoc({
      name: 'v', residues, annotations: [
        { name: 'M13 (-20) (fwd)', type: 'primer_bind', intervals: [[6, 21]], qualifiers: { Sequence: 'GTAAAACGACGGCCAG', Tm: '52.4' } },
        { name: 'rev', type: 'primer_bind_reverse', intervals: [[30, 40, 'rightToLeft']], qualifiers: { Sequence: 'GGGGAAAAAAAAAAA' } },
      ],
    }))).sequences[0]
    expect(doc.annotations).toEqual([])
    expect(doc.primers?.map(p => [p.name, p.sequence, p.role])).toEqual([
      ['M13 (-20) (fwd)', 'GTAAAACGACGGCCAG', 'primer'],
      ['rev', 'GGGGAAAAAAAAAAA', 'primer'],
    ])
  })

  it('keeps a primer binding site without an oligo as a feature', () => {
    const doc = readGeneiousXml(file('F', sequenceDoc({
      name: 'HIV', residues, annotations: [
        { name: 'primer_bind', type: 'primer_bind', intervals: [[6, 21]] },
        { name: 'sequencing site', type: 'primer_bind', intervals: [[6, 21]], qualifiers: { 'NCBI Feature Key': 'primer_bind', note: 'M13' } },
        { name: 'rev site', type: 'primer_bind_reverse', intervals: [[30, 40]] },
      ],
    }))).sequences[0]
    expect(doc.primers).toBeUndefined()
    expect(doc.annotations.map(a => [a.type, a.strand])).toEqual([['primer_bind', 1], ['primer_bind', 1], ['primer_bind', 1]])
  })

  it('sends oligo documents to the primer library', () => {
    const oligo = (name: string, residues: string, type: string) => document(`${PKG}.OligoSequenceDocument`, {
      name,
      description: `${name} sequencing primer`,
      fields: { oligoType: type, molType: 'DNA', sequence_residues: residues, sequence_length: String(residues.length) },
      content: `<XMLSerialisableRootElement><name>${name}</name><charSequence>${residues}</charSequence></XMLSerialisableRootElement>`,
    })
    const r = readGeneiousXml(file('Primers', oligo('M13-F', 'GtAaAaCgAcGgCcAgT', 'Primer'), oligo('TaqMan', 'ACGTACGTAC', 'Probe')))
    expect(r.sequences).toEqual([])
    expect(r.oligos).toEqual([
      { name: 'M13-F', sequence: 'GTAAAACGACGGCCAGT', role: 'primer', notes: 'M13-F sequencing primer' },
      { name: 'TaqMan', sequence: 'ACGTACGTAC', role: 'probe', notes: 'TaqMan sequencing primer' },
    ])
  })
})

describe('alignments', () => {
  const ALN = 'com.biomatters.geneious.publicapi.implementations.DefaultAlignmentDocument'
  /** A row as Geneious writes it: leading and trailing gaps as counts, not dashes. */
  const row = (name: string, residues: string, lead = 0, trail = 0, extra = '') =>
    `<sequence>${extra}<gappedSequence type="DefaultNucleotideSequence"><name>${name}</name>`
    + `<charSequence${lead ? ` gapPrefixLength="${lead}"` : ''}${trail ? ` gapSuffixLength="${trail}"` : ''}>${residues}</charSequence>`
    + '</gappedSequence><URN class="urn">urn:local:.:x</URN></sequence>'
  const alignment = (alphabet: string, rows: string[], attrs = '') =>
    `<DefaultAlignmentDocument${attrs}><alphabet>${alphabet}</alphabet><name>internal</name><sequences>${rows.join('')}</sequences></DefaultAlignmentDocument>`

  it('opens an alignment with its rows, the end gaps put back', () => {
    const r = readGeneiousXml(file('Alignments', document(ALN, {
      name: 'Nucleotide alignment 8', override: 'People',
      content: alignment('NUCLEOTIDE', [row('Adam', 'AcGt-AcG'), row('Harry', 'gT-aC', 2, 1)]),
    })))
    expect(r.alignments).toHaveLength(1)
    const { name, doc } = r.alignments[0]
    expect(name).toBe('People')
    expect(doc.kind).toBe('dna')
    expect(doc.rows.map(x => [x.name, x.seq])).toEqual([['Adam', 'ACGT-ACG'], ['Harry', '--GT-AC-']])
    expect(doc.origin).toMatchObject({ method: 'import', format: 'Geneious' })
    expect(doc.referenceId).toBeNull()
    expect(r.skipped).toEqual([])
  })

  it('reads a protein alignment as protein', () => {
    const r = readGeneiousXml(file('F', document(ALN, {
      name: 'Pairwise protein', content: alignment('PROTEIN', [row('2ACT', 'MkV-lA'), row('9PAP', 'MRVaLA')]),
    })))
    expect(r.alignments[0].doc.kind).toBe('protein')
    expect(r.alignments[0].doc.rows[0].seq).toBe('MKV-LA')
  })

  it('opens a Sanger contig, marking the read that went in reversed, with its reference', () => {
    const r = readGeneiousXml(file('Contig Assembly', document(ALN, {
      name: 'COI Assembly',
      content: alignment('NUCLEOTIDE', [
        row('COI rev read (reversed)', 'CACTCA', 0, 2, '<reversed>true</reversed>'),
        row('COI fwd read', 'ACTCAGG', 1, 0),
      ], ' is_contig="true" contigReferenceSequenceIndex="1"'),
    })))
    const { doc } = r.alignments[0]
    expect(doc.rows[0].source).toEqual({ name: 'COI rev read', reversed: true })
    expect(doc.rows[1].source).toBeUndefined()
    expect(doc.referenceId).toBe(doc.rows[1].id)
  })

  it('opens the alignment a tree was built from, and says the tree is not drawn', () => {
    const tree = document('com.biomatters.geneious.publicapi.implementations.DefaultPhylogenyDocument', {
      name: 'tree of Nucleotide alignment 8', override: 'People',
      content: '<PhylogenyDocument><OriginalSource><format>nexus</format><text>#NEXUS</text></OriginalSource>'
        + `<alignment>${alignment('NUCLEOTIDE', [row('Adam', 'ACGT'), row('Eve', 'AC-T')])}</alignment></PhylogenyDocument>`,
    })
    const r = readGeneiousXml(file('Trees', tree))
    expect(r.alignments.map(a => [a.name, a.doc.rows.length])).toEqual([['People', 2]])
    expect(r.skipped).toEqual([{ kind: 'treeAlignment', name: 'People' }])
  })
})

describe('chromatograms and structures', () => {
  const READ = 'ACGTACGTACGTACGTACGT'
  const base64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  /** The chromatogram file as Geneious keeps it: the whole .ab1, base64 in <rawdata>. */
  const abiDoc = (name: string, urn: string, raw = base64(simpleAb1(READ))) =>
    `<geneiousDocument class="com.biomatters.plugins.abi.ABIPluginDocument"><hiddenFields><cache_urn type="urn">${urn}</cache_urn>`
    + `<cache_name>${name}</cache_name></hiddenFields><fields /><originalElement><ABIDocument><rawdata>${raw}</rawdata></ABIDocument></originalElement></geneiousDocument>`
  /** The sequence Geneious made from it: the read's name, its trim, and the file's URN. */
  const graphDoc = (name: string, ref: string | null, trims: [number, number][] = []) =>
    `<geneiousDocument class="${PKG}.DefaultNucleotideGraphSequence"><hiddenFields><cache_name>77536205_C02.ab1</cache_name>`
    + `<override_cache_name>${name}</override_cache_name></hiddenFields><fields><molType>DNA</molType></fields>`
    + `<originalElement><XMLSerialisableRootElement><sequenceAnnotations>${
      annotations(trims.map(([a, b]) => ({ name: 'Trimmed', type: 'trimmed', intervals: [[a, b]] as [number, number][] })))
    }</sequenceAnnotations><charSequence>${READ}</charSequence>`
    + (ref ? `<URN class="urn">${ref}</URN>` : '')
    + '</XMLSerialisableRootElement></originalElement>'
    + (ref ? `<referenced_documents>${ref}@0</referenced_documents>` : '')
    + '</geneiousDocument>'

  it('opens the chromatogram file kept in the document, named after the file', () => {
    const r = readGeneiousXml(file('Reads', abiDoc('77536205_C02.ab1', 'urn:local:.:a1')))
    expect(r.traces).toHaveLength(1)
    expect(r.traces[0].name).toBe('77536205_C02')
    expect(r.traces[0].data.bases).toBe(READ)
    expect(r.traces[0].trim).toBeUndefined()
    expect(r.sequences).toEqual([])
  })

  it('names a read as it was named in Geneious, with its trim, and does not open it twice', () => {
    const r = readGeneiousXml(file('Contig Assembly',
      graphDoc('COI fwd read', 'urn:local:.:a1', [[1, 3], [18, 20]]),
      abiDoc('77536205_C02.ab1', 'urn:local:.:a1'),
    ))
    expect(r.traces.map(t => [t.name, t.data.name, t.trim])).toEqual([['COI fwd read', 'COI fwd read', [3, 17]]])
    expect(r.sequences).toEqual([])
  })

  it('pairs two reads from the same file name by their URNs', () => {
    const r = readGeneiousXml(file('F',
      abiDoc('77536205_C02.ab1', 'urn:local:.:a3'),
      abiDoc('77536205_C02.ab1', 'urn:local:.:a1'),
      graphDoc('COI fwd read', 'urn:local:.:a1'),
      graphDoc('COI rev read', 'urn:local:.:a3'),
    ))
    expect(r.traces.map(t => t.name)).toEqual(['COI rev read', 'COI fwd read'])
  })

  it('keeps a graph sequence with no chromatogram in the file as a sequence', () => {
    const r = readGeneiousXml(file('F', graphDoc('consensus', null)))
    expect(r.traces).toEqual([])
    expect(r.sequences.map(d => d.name)).toEqual(['consensus'])
  })

  it('reports a chromatogram document whose file does not read', () => {
    const r = readGeneiousXml(file('F', abiDoc('bad.ab1', 'urn:local:.:b', btoa('not an ABIF file at all'))))
    expect(r.traces).toEqual([])
    expect(r.skipped).toEqual([{ kind: 'trace', name: 'bad.ab1' }])
  })

  it('passes on the PDB text of a structure, and reports one with no coordinates', () => {
    const pdb = (name: string, data: string) => document('com.biomatters.geneious.publicapi.implementations.structure.PdbDocument', {
      name, content: `<XMLSerialisableRootElement><fields><PDBname>1D66</PDBname><data>${data}</data></fields></XMLSerialisableRootElement>`,
    })
    const atoms = 'HEADER    TRANSCRIPTION&#xD;\nATOM      1  N   GLU A   8      35.985  55.042  43.428  1.00 44.52           N&#xD;\nEND'
    const r = readGeneiousXml(file('Protein Documents', pdb('Protein DNA complex (1D66)', atoms), pdb('Empty', 'HEADER    NOTHING')))
    expect(r.structures).toEqual([{
      name: 'Protein DNA complex (1D66)',
      fileName: '1D66.pdb',
      text: 'HEADER    TRANSCRIPTION\nATOM      1  N   GLU A   8      35.985  55.042  43.428  1.00 44.52           N\nEND',
    }])
    expect(r.skipped).toEqual([{ kind: 'structure', name: 'Empty' }])
  })
})

describe('enzyme sets', () => {
  it('reads the names of a set\'s enzymes', () => {
    const r = readGeneiousXml(file('Cloning', document('com.biomatters.geneious.common.restrictionAnalysis.EnzymeSetDocument', {
      name: 'BioBrick',
      content: '<XMLSerialisableRootElement><name>BioBrick</name><enzymes>'
        + '<enzyme><name>EcoRI</name><recognitionSequence>G^AATTC</recognitionSequence></enzyme>'
        + '<enzyme><name>XbaI</name><recognitionSequence>T^CTAGA</recognitionSequence></enzyme>'
        + '</enzymes></XMLSerialisableRootElement>',
    })))
    expect(r.enzymeSets).toEqual([{ name: 'BioBrick', enzymes: ['EcoRI', 'XbaI'] }])
    expect(r.skipped).toEqual([])
  })
})

describe('what is not opened', () => {
  it('reports each kind it does not open, and is silent about history records', () => {
    const r = readGeneiousXml(file('Mixed',
      document('com.biomatters.geneious.publicapi.documents.OperationRecordDocument', { name: 'Extraction' }),
      document('com.biomatters.geneious.publicapi.implementations.DefaultAlignmentDocument', {
        name: 'Illumina assembly', content: '<DefaultAlignmentDocument is_contig="true" xmlFileData="fileData.17"><alphabet>NUCLEOTIDE</alphabet></DefaultAlignmentDocument>',
      }),
      document('com.biomatters.plugins.TreeBuilder.TreeBuilderDocument', {
        name: 'NADH2', content: '<TreeDocument><name>Tree 3</name><OriginalSource><format>nexus</format><text>#NEXUS</text></OriginalSource></TreeDocument>',
      }),
      document('com.biomatters.plugins.abi.ABIPluginDocument', { name: 'read.ab1' }),
      document('com.biomatters.geneious.publicapi.implementations.structure.PdbDocument', { name: '1D66' }),
      document('com.biomatters.geneious.common.restrictionAnalysis.EnzymeSetDocument', { name: 'BioBrick' }),
      document('com.biomatters.geneious.publicapi.documents.sequence.DefaultSequenceListDocument', {
        name: 'Illumina reads', content: '<XMLSerialisableRootElement><fields /><nucleotideSequencesOnDisk size="5060" /></XMLSerialisableRootElement>',
      }),
      document('com.biomatters.plugins.SomethingElse', { name: 'mystery' }),
    ))
    expect(r.sequences).toEqual([])
    expect(r.skipped.map(s => [s.kind, s.name])).toEqual([
      ['assembly', 'Illumina assembly'],
      ['tree', 'NADH2'],
      ['trace', 'read.ab1'],
      ['structure', '1D66'],
      ['enzymeSet', 'BioBrick'],
      ['reads', 'Illumina reads'],
      ['other', 'mystery'],
    ])
  })

  it('reports a genome link, with its accession and length, rather than opening it', () => {
    const link = document('com.biomatters.plugins.ncbi.genome.GenomeSummaryDocument', {
      name: 'NC_008405', override: 'Rice Chr12', fields: { sequence_length: '27757321' },
    }).replace('</hiddenFields>', '<override_accession>NC_008405</override_accession></hiddenFields>')
    const r = readGeneiousXml(file('Plants', link))
    expect(r.skipped).toEqual([{ kind: 'genome', name: 'Rice Chr12', accession: 'NC_008405', length: 27757321 }])
  })

  it('treats a sequence Geneious never downloaded as a genome link', () => {
    const placeholder = document('com.biomatters.plugins.ncbi.documents.GenBankContigSummaryNucleotideSequence', {
      name: 'NC_000913', override: 'E. coli K12 MG1655', fields: { accession: 'NC_000913', sequence_length: '4641652' },
      content: '<XMLSerialisableRootElement><charSequence><xmlSerializedSequence repeat="4641652" type="Repeated">?</xmlSerializedSequence></charSequence></XMLSerialisableRootElement>',
    })
    const r = readGeneiousXml(file('Bacteria', placeholder))
    expect(r.sequences).toEqual([])
    expect(r.skipped).toEqual([{ kind: 'genome', name: 'E. coli K12 MG1655', accession: 'NC_000913', length: 4641652 }])
  })

  it('does not open a sequence of which only the 500-letter preview is stored', () => {
    const gene = document('com.biomatters.plugins.ncbi.NucleotideGeneDocument', {
      name: 'yadF CDS', fields: { sequence_length: '645', sequence_residues: 'A'.repeat(500) },
      content: '<XMLSerialisableRootElement><name>yadF</name></XMLSerialisableRootElement>',
    })
    const r = readGeneiousXml(file('Cloning', gene))
    expect(r.sequences).toEqual([])
    expect(r.skipped).toEqual([{ kind: 'partial', name: 'yadF CDS', length: 645 }])
  })

  it('uses the preview when it is the whole sequence', () => {
    const gene = document('com.biomatters.plugins.ncbi.NucleotideGeneDocument', {
      name: 'short', fields: { sequence_length: '8', sequence_residues: 'ACGTACGT' },
      content: '<XMLSerialisableRootElement><name>short</name></XMLSerialisableRootElement>',
    })
    expect(readGeneiousXml(file('F', gene)).sequences[0].sequence.bases).toBe('ACGTACGT')
  })

  it('reports a document whose XML is broken, and reads the rest', () => {
    const r = readGeneiousXml(file('F',
      '<geneiousDocument class="x"><hiddenFields><cache_name>broken</cache_name><oops></hiddenFields></geneiousDocument>',
      sequenceDoc({ name: 'fine', residues: 'ACGT' }),
    ))
    expect(r.sequences.map(d => d.name)).toEqual(['fine'])
    expect(r.skipped).toEqual([{ kind: 'unreadable', name: 'broken' }])
  })

  it('summarizes what was not opened, one line per kind', () => {
    expect(describeSkipped([
      { kind: 'genome', name: 'chr1' }, { kind: 'genome', name: 'chr2' }, { kind: 'genome', name: 'chr3' }, { kind: 'genome', name: 'chr4' },
      { kind: 'tree', name: 'NADH2' },
      { kind: 'treeAlignment', name: 'People' }, { kind: 'treeAlignment', name: 'COXII' },
    ])).toEqual([
      '4 genome links not opened (chr1, chr2, chr3, …): the file holds a link to NCBI, not the sequence',
      '1 tree not opened (NADH2): no alignment in the file, and trees are not drawn here',
      '2 trees opened as the alignment each was built from (People, COXII): trees are not drawn here',
    ])
  })
})
