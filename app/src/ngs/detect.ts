/**
 * Working out what a set of read files is: which files are the two mates of
 * a pair, whether one file holds both mates interleaved, and which
 * technology made the reads. Everything here is a guess the import dialog
 * shows and lets the user change.
 */

import { readId, type RawRead } from './fastq-stream'
import type { Technology } from './types'

const READ_EXT = /\.(f(ast)?q|fa|fasta|fna)(\.gz)?$/i
/** A mate marker at the end of a file name's stem: _R1, .R2, -1, _2, optionally followed by Illumina's _001. */
const MATE = /([._-])R?([12])((?:[._-]\d{3})?)$/i

export function isReadFile(name: string): boolean {
  return READ_EXT.test(name)
}

export interface FileGroup {
  /** A name for the sample: the file name without extension and mate marker. */
  name: string
  /** Indices into the files given; two (R1 first) for a pair. */
  files: number[]
}

/** The file name without its read-file extension (and .gz). */
export function stemOf(name: string): string {
  return name.replace(READ_EXT, '')
}

/**
 * Group files into samples: two files whose names differ only in a mate
 * marker (sample_R1.fastq.gz and sample_R2.fastq.gz, or reads_1.fq and
 * reads_2.fq) are a pair; every other file stands alone.
 */
export function pairFiles(names: readonly string[]): FileGroup[] {
  const byKey = new Map<string, { mate: number; index: number }[]>()
  const keyOf: (string | null)[] = names.map(n => {
    const stem = stemOf(n)
    const m = stem.match(MATE)
    if (!m) return null
    return `${stem.slice(0, m.index)}${m[1]}#${m[3]}`
  })
  names.forEach((n, i) => {
    const key = keyOf[i]
    if (!key) return
    const mate = Number(stemOf(n).match(MATE)![2])
    const list = byKey.get(key)
    if (list) list.push({ mate, index: i })
    else byKey.set(key, [{ mate, index: i }])
  })
  const used = new Set<number>()
  const groups: FileGroup[] = []
  names.forEach((n, i) => {
    if (used.has(i)) return
    const key = keyOf[i]
    const list = key ? byKey.get(key) : undefined
    if (list && list.length === 2 && list[0].mate !== list[1].mate) {
      const [a, b] = list[0].mate === 1 ? list : [list[1], list[0]]
      used.add(a.index)
      used.add(b.index)
      const stem = stemOf(names[a.index])
      const m = stem.match(MATE)!
      groups.push({ name: stem.slice(0, m.index) || stem, files: [a.index, b.index] })
      return
    }
    used.add(i)
    groups.push({ name: stemOf(n), files: [i] })
  })
  return groups
}

/** A read ID without the /1 or /2 some pipelines add to tell the mates apart. */
export function mateKey(id: string): string {
  return id.replace(/\/[12]$/, '')
}

/** Do these two reads look like the two mates of one pair? */
export function areMates(a: RawRead, b: RawRead): boolean {
  return mateKey(readId(a.header)) === mateKey(readId(b.header))
}

/**
 * One file with both mates: consecutive reads come in twos with the same ID.
 * Judged on the first reads only, so at least two pairs are needed.
 */
export function looksInterleaved(reads: readonly RawRead[]): boolean {
  const n = Math.min(reads.length - (reads.length % 2), 200)
  if (n < 4) return false
  for (let i = 0; i < n; i += 2) if (!areMates(reads[i], reads[i + 1])) return false
  return true
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** CASAVA 1.8 read ID: instrument:run:flowcell:lane:tile:x:y. */
const ILLUMINA_ID = /^[^:\s]+:\d+:[^:\s]+:\d+:\d+:\d+:\d+$/
/** Older Illumina IDs: instrument:lane:tile:x:y, often with #index/1. */
const ILLUMINA_OLD = /^[^:\s]+:\d+:\d+:\d+:\d+(#\S*)?(\/[12])?$/

export interface TechGuess {
  technology: Technology
  /** True when a header said so; false when only read lengths did. */
  certain: boolean
}

/** Guess the technology from read headers, then from read lengths. */
export function detectTechnology(reads: readonly RawRead[]): TechGuess {
  const sample = reads.slice(0, 500)
  if (sample.length === 0) return { technology: 'other', certain: false }
  const vote = (test: (r: RawRead) => boolean) => sample.filter(test).length * 2 > sample.length
  if (vote(r => / (runid|ch|read|start_time|flow_cell_id)=/.test(r.header) || UUID.test(readId(r.header)))) {
    return { technology: 'nanopore', certain: true }
  }
  if (vote(r => /^m\d{5,}[a-z]?_\d{6}_\d{6}\//i.test(r.header))) return { technology: 'pacbio', certain: true }
  if (vote(r => {
    const id = readId(r.header)
    return ILLUMINA_ID.test(id) || ILLUMINA_OLD.test(id) || /\s[12]:[YN]:\d+:/.test(r.header)
  })) return { technology: 'illumina', certain: true }
  const lengths = sample.map(r => r.seq.length)
  const max = Math.max(...lengths)
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length
  if (max <= 600) return { technology: 'illumina', certain: false }
  if (mean >= 1000) return { technology: 'nanopore', certain: false }
  return { technology: 'other', certain: false }
}
