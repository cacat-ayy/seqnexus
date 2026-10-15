/**
 * ORFs saved as FASTA and CSV: what each record and row holds.
 */
import { describe, it, expect } from 'vitest'
import { Sequence } from '../models/Sequence'
import { orfsCsv, orfsFasta, orfProtein, orfBases } from './export'
import type { ORFResult } from './finder'

// 'CC' + ATG, ten GCC, TAA + 'CC': one ORF of 11 residues on the forward strand.
const sequence = new Sequence('CC' + 'ATG' + 'GCC'.repeat(10) + 'TAA' + 'CC', 'linear')
const ORF: ORFResult = { start: 2, end: 38, strand: 1, frame: 2, codons: 12 }
const src = { name: 'my plasmid', sequence, geneticCodeId: 1, origin: 0 }

describe('ORF export', () => {
  it('writes each ORF as a numbered protein record, the frame and place in its header', () => {
    expect(orfsFasta([ORF], src, 'protein')).toBe('>my_plasmid_ORF1 frame +3 3..38 11 aa\nMAAAAAAAAAA\n')
  })

  it('writes the coding bases with their stop codon', () => {
    expect(orfsFasta([ORF], src, 'bases')).toBe(`>my_plasmid_ORF1 frame +3 3..38 11 aa\nATG${'GCC'.repeat(10)}TAA\n`)
  })

  it('reads a reverse-strand ORF on its own strand, in ASCII', () => {
    const minus = new Sequence('CC' + 'TTA' + 'GGC'.repeat(10) + 'CAT' + 'CC', 'linear')
    const orf: ORFResult = { start: 2, end: 38, strand: -1, frame: 2, codons: 12 }
    expect(orfBases(orf, minus)).toBe('ATG' + 'GCC'.repeat(10) + 'TAA')
    expect(orfsFasta([orf], { ...src, sequence: minus }, 'protein')).toContain('frame -3')
  })

  it('does not read the first codon of an ORF open at its 5\' end as methionine', () => {
    const orf: ORFResult = { start: 5, end: 38, strand: 1, frame: 2, codons: 11, partialStart: true }
    expect(orfProtein(orf, sequence, 1)).toBe('AAAAAAAAAA')
    expect(orfsFasta([orf], src, 'protein')).toContain("partial 5'")
  })

  it('writes the table as CSV, with the mass of each protein', () => {
    const [header, row] = orfsCsv([ORF], src).trim().split('\n')
    expect(header).toBe('ORF,Frame,Strand,First,Last,Residues,Bases,Start codon,Stop codon,Partial,Mass (Da),Protein')
    const cells = row.split(',')
    expect(cells.slice(0, 10)).toEqual(['ORF1', '+3', '+', '3', '38', '11', '36', 'ATG', 'TAA', ''])
    expect(Number(cells[10])).toBeGreaterThan(800)
    expect(cells[11]).toBe('MAAAAAAAAAA')
  })

  it('counts positions from the display origin', () => {
    expect(orfsFasta([ORF], { ...src, origin: 2 }, 'protein')).toContain(' 1..36 ')
  })
})
