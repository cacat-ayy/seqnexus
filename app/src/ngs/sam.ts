/**
 * A mapping written out as SAM, sorted by position, for IGV, samtools and
 * the rest.
 *
 * The stored alignments carry no bases (see mapper.ts); each names its read
 * by number. The read set is read through once, in order, and every
 * alignment gets its read's name, bases and qualities back: reverse
 * complemented for a reverse-strand alignment, as SAM stores them, and
 * without the bases a hard clip (H) leaves out. Then the lines are sorted by
 * reference and position.
 *
 * The whole file is built in memory, which suits plasmids, amplicons and
 * small genomes; a bacterial genome at depth wants a streamed, merged sort.
 * On a circular reference, a read across the origin keeps the position
 * where it starts, so its alignment runs past the end of the reference.
 */

import { inflateSync } from 'fflate'
import { decodeChunk } from './codec'

const COMP: Record<string, string> = {
  A: 'T', C: 'G', G: 'C', T: 'A', N: 'N', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D', '=': '=',
}
const revComp = (s: string) => { let o = ''; for (let i = s.length - 1; i >= 0; i--) o += COMP[s[i]] ?? 'N'; return o }
const reverse = (s: string) => s.split('').reverse().join('')

/** A reference name SAM accepts: no whitespace. */
export function samName(name: string): string {
  return name.trim().replace(/\s+/g, '_') || 'reference'
}

/** Bases a CIGAR hard-clips at its start and end. */
function hardClips(cigar: string): [number, number] {
  const lead = cigar.match(/^(\d+)H/)
  const tail = cigar.match(/(\d+)H$/)
  return [lead ? Number(lead[1]) : 0, tail ? Number(tail[1]) : 0]
}

export async function buildSam(o: {
  references: readonly { name: string; length: number }[]
  alignmentChunks: number
  getAlignments: (index: number) => Promise<Uint8Array | undefined>
  readChunks: number
  getReads: (index: number) => Promise<Uint8Array | undefined>
  /** The minimap2 command line, for the @PG header line. */
  command: string
  onProgress?: (done: number, total: number) => void
}): Promise<string> {
  const total = o.alignmentChunks + o.readChunks
  // Alignments, grouped by the read they belong to.
  const byRead = new Map<number, string[][]>()
  const unnamed: string[][] = []
  const dec = new TextDecoder()
  for (let c = 0; c < o.alignmentChunks; c++) {
    const packed = await o.getAlignments(c)
    if (!packed) throw new Error(`Part ${c + 1} of the alignments is missing from storage`)
    for (const line of dec.decode(inflateSync(packed)).split('\n')) {
      if (!line) continue
      const f = line.split('\t')
      const read = Number(f[2])
      if (read < 0) { unnamed.push(f); continue }
      const list = byRead.get(read)
      if (list) list.push(f)
      else byRead.set(read, [f])
    }
    o.onProgress?.(c + 1, total)
  }

  const names = o.references.map(r => samName(r.name))
  const rows: { ref: number; pos: number; text: string }[] = []
  const emit = (f: string[], qname: string, seq: string, qual: string) => {
    const ref = Number(f[0])
    const pos = Number(f[1])
    const flag = Number(f[3])
    const cigar = f[5]
    let s = seq
    let q = qual
    if (s !== '*') {
      if (flag & 0x10) { s = revComp(s); q = q === '*' ? q : reverse(q) }
      const [lead, tail] = hardClips(cigar)
      if (lead || tail) {
        s = s.slice(lead, s.length - tail)
        if (q !== '*') q = q.slice(lead, q.length - tail)
      }
    }
    const mateRef = f.length > 6 ? Number(f[6]) : -1
    const rnext = mateRef < 0 ? '*' : mateRef === ref ? '=' : names[mateRef]
    const pnext = mateRef < 0 ? 0 : Number(f[7]) + 1
    const tlen = f.length > 8 ? f[8] : '0'
    rows.push({ ref, pos, text: `${qname}\t${flag}\t${names[ref]}\t${pos + 1}\t${f[4]}\t${cigar}\t${rnext}\t${pnext}\t${tlen}\t${s || '*'}\t${q || '*'}` })
  }

  let first = 0
  for (let c = 0; c < o.readChunks; c++) {
    const packed = await o.getReads(c)
    if (!packed) throw new Error(`Part ${c + 1} of the reads is missing from storage`)
    const chunk = decodeChunk(packed)
    for (let i = 0; i < chunk.count; i++) {
      const recs = byRead.get(first + i)
      if (!recs) continue
      const seq = chunk.seq(i)
      const qual = chunk.hasQuality ? chunk.qualText(i) : '*'
      for (const f of recs) emit(f, chunk.ids[i], seq, qual)
    }
    first += chunk.count
    o.onProgress?.(o.alignmentChunks + c + 1, total)
  }
  // Alignments stored before read numbers were kept for supplementary ones.
  for (const f of unnamed) emit(f, 'unknown', '*', '*')

  rows.sort((a, b) => a.ref - b.ref || a.pos - b.pos)
  const header = [
    '@HD\tVN:1.6\tSO:coordinate',
    ...o.references.map((r, i) => `@SQ\tSN:${names[i]}\tLN:${r.length}`),
    `@PG\tID:minimap2\tPN:minimap2\tVN:2.22\tCL:${o.command}`,
  ]
  return header.join('\n') + '\n' + rows.map(r => r.text).join('\n') + (rows.length ? '\n' : '')
}
