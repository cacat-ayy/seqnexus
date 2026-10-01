import { describe, it, expect } from 'vitest'
import { makeDoc, type AlnDoc } from '../model'
import {
  ALN_FORMATS, detectFormat, readAlignment, writeAlignment, fastaLooksAligned, AlignmentParseError,
  type AlnFormatId,
} from './index'
import { gcgChecksum } from './msf'

const origin = { method: 'manual' as const, at: 0 }

const dna = makeDoc([
  { name: 'Homo sapiens', seq: 'ATGGCC--TTAGCAAGGCTTACCGATTGACCAGT' },
  { name: 'Mus_musculus', seq: 'ATGGCCAATTAGCA--GCTTACCGATTGACCAGT' },
  { name: "O'Brien clone", seq: 'ATGACCAATTAGCAAGGCTTAC-GATTGACC---' },
], origin)

const protein = makeDoc([
  { name: 'P1', seq: 'MKLVFFAEDVGS-NKGAIIGLMVGGVVIA' },
  { name: 'P2', seq: 'MKLVFFAEDVGSNNKGAIIGLMVGGVV--' },
], origin, 'protein')

function rows(d: AlnDoc) {
  return d.rows.map(r => r.seq)
}

describe('round trips', () => {
  for (const f of ALN_FORMATS) {
    it(`${f.label} keeps every residue and gap (DNA)`, () => {
      const text = writeAlignment(dna, f.id, { title: 'test' })
      const back = readAlignment(text, `x${f.extensions[0]}`)
      expect(back.format.id).toBe(f.id)
      expect(rows(back.doc)).toEqual(rows(dna))
      expect(back.doc.kind).toBe('dna')
      expect(back.aligned).toBe(true)
      expect(back.warnings).toEqual([])
    })

    it(`${f.label} keeps every residue and gap (protein)`, () => {
      const back = readAlignment(writeAlignment(protein, f.id), `x${f.extensions[0]}`)
      expect(rows(back.doc)).toEqual(rows(protein))
      expect(back.doc.kind).toBe('protein')
    })
  }

  it('keeps names where the format allows them', () => {
    const names = (id: AlnFormatId) => readAlignment(writeAlignment(dna, id)).doc.rows.map(r => r.name)
    expect(names('nexus')).toEqual(['Homo sapiens', 'Mus_musculus', "O'Brien clone"])
    expect(names('clustal')).toEqual(['Homo_sapiens', 'Mus_musculus', "O'Brien_clone"])
    expect(names('mega')).toEqual(['Homo sapiens', 'Mus musculus', "O'Brien clone"])
  })

  it('writes strict and interleaved PHYLIP that reads back', () => {
    const many = makeDoc(Array.from({ length: 3 }, (_, i) => ({ name: 'Sequence-number', seq: 'ACGT'.repeat(40).slice(i) })), origin)
    for (const phylipNames of ['strict', 'relaxed'] as const) {
      for (const phylipLayout of ['sequential', 'interleaved'] as const) {
        const text = writeAlignment(many, 'phylip', { phylipNames, phylipLayout })
        const back = readAlignment(text)
        expect(rows(back.doc)).toEqual(rows(many))
        if (phylipNames === 'strict') {
          expect(back.doc.rows.map(r => r.name)).toEqual(['Sequence-n', 'Sequence-1', 'Sequence-2'])
        }
      }
    }
  })
})

describe('reading files from other tools', () => {
  it('reads Clustal Omega output with numbered lines and conservation', () => {
    const text = `CLUSTAL O(1.2.4) multiple sequence alignment


seq1      MKLVFFAEDVGSNKGAIIGLMVGGVV	26
seq2      MKLVFFAEDVGSNKGAIIGLMVGGVV	26
          **************************

seq1      IA	28
seq2      --	26

`
    const r = readAlignment(text, 'out.aln')
    expect(r.format.id).toBe('clustal')
    expect(rows(r.doc)).toEqual(['MKLVFFAEDVGSNKGAIIGLMVGGVVIA', 'MKLVFFAEDVGSNKGAIIGLMVGGVV--'])
  })

  it('reads strict interleaved PHYLIP (the PHYLIP manual example)', () => {
    const text = `  5    42
Turkey    AAGCTNGGGC ATTTCAGGGT
Salmo gairAAGCCTTGGC AGTGCAGGGT
H. SapiensACCGGTTGGC CGTTCAGGGT
Chimp     AAACCCTTGC CGTTACGCTT
Gorilla   AAACCCTTGC CGGTACGCTT

GAGCCCGGGC AATACAGGGT AT
GAGCCGTGGC CGGGCACGGT AT
ACAGGTTGGC CGTTCAGGGT AA
AAACCGAGGC CGGGACACTC AT
AAACCATTGC CGGTACGCTT AA
`
    const r = readAlignment(text)
    expect(r.format.id).toBe('phylip')
    expect(r.doc.rows.map(x => x.name)).toEqual(['Turkey', 'Salmo gair', 'H. Sapiens', 'Chimp', 'Gorilla'])
    expect(r.doc.rows[0].seq).toBe('AAGCTNGGGCATTTCAGGGTGAGCCCGGGCAATACAGGGTAT')
    expect(r.doc.rows[4].seq).toHaveLength(42)
  })

  it('reads relaxed sequential PHYLIP wrapped over lines', () => {
    const text = `2 12
alpha ACGTAC
GTACGT
beta  ACGTAC
GTAC--
`
    expect(rows(readAlignment(text).doc)).toEqual(['ACGTACGTACGT', 'ACGTACGTAC--'])
  })

  it('reads NEXUS with comments, quotes, interleave, matchchar and polymorphisms', () => {
    const text = `#NEXUS
[ written by hand ]
BEGIN TAXA;
  DIMENSIONS NTAX=3;
  TAXLABELS 'Homo sapiens' Pan Gorilla;
END;
BEGIN CHARACTERS;
  DIMENSIONS NCHAR=8;
  FORMAT DATATYPE=DNA MISSING=? GAP=- MATCHCHAR=. INTERLEAVE;
  MATRIX
    'Homo sapiens' ACGT [first half]
    Pan            ..C.
    Gorilla        .{AG}-?

    'Homo sapiens' TTAA
    Pan            ....
    Gorilla        ..G-
  ;
END;
BEGIN TREES;
  TREE t = (a,b);
END;
`
    const r = readAlignment(text)
    expect(r.format.id).toBe('nexus')
    expect(r.doc.rows.map(x => x.name)).toEqual(['Homo sapiens', 'Pan', 'Gorilla'])
    expect(rows(r.doc)).toEqual(['ACGTTTAA', 'ACCTTTAA', 'AR-NTTG-'])
  })

  it('reads sequential NEXUS with sequences over several lines', () => {
    const text = `#NEXUS
begin data;
dimensions ntax=2 nchar=10;
format datatype=protein gap=-;
matrix
a MKLVF
  FAEDV
b MKLV-
  FAED-
;
end;`
    const r = readAlignment(text)
    expect(rows(r.doc)).toEqual(['MKLVFFAEDV', 'MKLV-FAED-'])
    expect(r.doc.kind).toBe('protein')
  })

  it('reads interleaved MEGA with identical-to-first dots and comments', () => {
    const text = `#mega
!Title Example alignment;
!Format DataType=Nucleotide
  indel=- identical=.;
"a comment"
#Homo_sapiens  ACGTACGT
#Pan           ...A..-.
#Homo_sapiens  TTTT
#Pan           ..G.
`
    const r = readAlignment(text, 'x.meg')
    expect(r.format.id).toBe('mega')
    expect(r.doc.rows.map(x => x.name)).toEqual(['Homo sapiens', 'Pan'])
    expect(rows(r.doc)).toEqual(['ACGTACGTTTTT', 'ACGAAC-TTTGT'])
  })

  it('refuses a MEGA distance matrix', () => {
    expect(() => readAlignment('#mega\n!Format DataType=Distance;\n', 'd.meg')).toThrow(/distance matrix/)
  })

  it('reads PIR with stops and description lines', () => {
    const text = `>P1;1abc
structureX:1abc:1:A:20:A:protein:::-1.00:-1.00
MKLV*FFAE-DVGS*

>P1;target
sequence:target:::::::0.00: 0.00
MKLVYFFAEEDVG-*
`
    const r = readAlignment(text, 'x.pir')
    expect(r.format.id).toBe('pir')
    expect(rows(r.doc)).toEqual(['MKLV*FFAE-DVGS', 'MKLVYFFAEEDVG-'])
    expect(r.doc.kind).toBe('protein')
  })

  it('reads Stockholm with annotation and interleaving', () => {
    const text = `# STOCKHOLM 1.0
#=GF ID   test
#=GS seq1 DE first
seq1   ACDEF...GH
seq2   ACDEFKL.GH
#=GC SS_cons ....HHHH..

seq1   IK
seq2   I-
//
# STOCKHOLM 1.0
other  AAAA
//
`
    const r = readAlignment(text)
    expect(rows(r.doc)).toEqual(['ACDEF---GHIK', 'ACDEFKL-GHI-'])
    expect(r.warnings[0]).toMatch(/more than one/)
  })

  it('reads MSF with dots and tildes', () => {
    const text = `PileUp

 MSF: 12  Type: P  Check: 1234 ..

 Name: a  Len: 12  Check: 1  Weight: 1.0
 Name: b  Len: 12  Check: 2  Weight: 1.0

//

           1                   12
a     MKLV.FFAED VG
b     ~~LVKFFAED V.
`
    const r = readAlignment(text, 'x.msf')
    expect(r.format.id).toBe('msf')
    expect(rows(r.doc)).toEqual(['MKLV-FFAEDVG', '--LVKFFAEDV-'])
    expect(r.doc.kind).toBe('protein')
  })

  it('computes GCG checksums', () => {
    // Every character contributes ((i % 57) + 1) × its code.
    expect(gcgChecksum('A')).toBe(65)
    expect(gcgChecksum('ab')).toBe(65 + 2 * 66)
  })

  it('reads FASTA and A2M', () => {
    const r = readAlignment('>one desc\nAC-gt\n>two\nac.GT\n')
    expect(r.doc.rows.map(x => x.name)).toEqual(['one desc', 'two'])
    expect(rows(r.doc)).toEqual(['AC-GT', 'AC-GT'])
    expect(r.aligned).toBe(true)
  })

  it('flags FASTA of unequal lengths as unaligned', () => {
    const r = readAlignment('>a\nACGTACGT\n>b\nACG\n')
    expect(r.aligned).toBe(false)
    expect(rows(r.doc)).toEqual(['ACGTACGT', 'ACG-----'])
  })
})

describe('detection', () => {
  it('detects by content, then by extension', () => {
    expect(detectFormat('#NEXUS\n')).toBe('nexus')
    expect(detectFormat(String.fromCharCode(0xfeff) + '  CLUSTAL W\n')).toBe('clustal')
    expect(detectFormat('>P1;x\n')).toBe('pir')
    expect(detectFormat('>x\nACGT')).toBe('fasta')
    expect(detectFormat('3 10\n')).toBe('phylip')
    expect(detectFormat('nothing here', 'x.sto')).toBe('stockholm')
    expect(detectFormat('nothing here', 'x.txt')).toBeNull()
  })

  it('throws a readable error for unknown files', () => {
    expect(() => readAlignment('hello', 'x.txt')).toThrow(AlignmentParseError)
    expect(() => readAlignment('CLUSTAL\n\n')).toThrow(/No sequences/)
  })

  it('tells aligned FASTA from a plain multi-FASTA', () => {
    expect(fastaLooksAligned('>a\nAC-T\n>b\nACGT\n')).toBe(true)
    expect(fastaLooksAligned('>a\nACGT\n>b\nACGT\n')).toBe(false)
    expect(fastaLooksAligned('>a\nAC-T\n>b\nACGTT\n')).toBe(false)
    expect(fastaLooksAligned('>a\nAC-T\n')).toBe(false)
  })
})
