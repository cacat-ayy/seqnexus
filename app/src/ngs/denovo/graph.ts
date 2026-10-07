/**
 * An assembly graph: the pieces an assembler ended with (segments) and how
 * they join (links), as GFA 1 describes them and Bandage draws them.
 *
 * Short reads: the segments are every unitig of the cleaned de Bruijn graph,
 * contigs and the shorter pieces between them alike, and two segments are
 * linked where the end of one leads into the start of the other (in either
 * orientation), overlapping by k-1 bases. Where contigs break, the graph
 * says why: a repeat is a segment that several others lead into and out of,
 * often at a multiple of the usual coverage; a mixed site left after
 * cleaning is a bubble; a plasmid resolved whole is a circle.
 *
 * Long reads of whole products: each contig is a segment of its own, a
 * circle where it closed. Long reads of a genome: every unitig of the
 * string graph (olc.ts), linked where reads overlap from one into the next,
 * each link with its own overlap.
 *
 * Stored with the mapping it belongs to (mappingStorageIds().graph), as one
 * deflated JSON blob with the sequences, since a genome's graph is about its
 * length in bases.
 */

import { deflateSync, inflateSync } from 'fflate'

export type Strand = '+' | '-'

export interface GraphSegment {
  name: string
  length: number
  /** Mean k-mer count (short reads), or mean read depth (long reads). */
  coverage: number
  circular: boolean
  /** Index of the contig this segment became, or null for a piece below the shortest contig. */
  contig: number | null
}

/** End of `from` (in its orientation) joins the start of `to` (in its orientation). */
export type GraphLink = [from: number, fromStrand: Strand, to: number, toStrand: Strand]

export interface AssemblyGraph {
  version: 1
  /** Bases each link overlaps by (k - 1 for a de Bruijn graph, 0 for long-read contigs). */
  overlap: number
  /** Bases each link overlaps by, when they differ (a string graph of long reads); else `overlap` for all. */
  linkOverlaps?: number[]
  /** What `coverage` means. */
  coverageUnit: 'k-mer' | 'depth'
  segments: GraphSegment[]
  links: GraphLink[]
}

export interface StoredGraph extends AssemblyGraph {
  /** Each segment's bases, in order. */
  sequences: string[]
}

const flip = (s: Strand): Strand => (s === '+' ? '-' : '+')

/**
 * A link and its mirror (b- to a- for a+ to b+) are the same join; keep one
 * of each, and drop exact repeats.
 */
export function dedupeLinks(links: readonly GraphLink[]): GraphLink[] {
  return keptLinks(links).map(i => links[i])
}

/** Indices of the links dedupeLinks keeps, for lists that go with them (overlaps). */
export function keptLinks(links: readonly GraphLink[]): number[] {
  const seen = new Set<string>()
  const out: number[] = []
  links.forEach((l, i) => {
    const a = `${l[0]}${l[1]}>${l[2]}${l[3]}`
    const b = `${l[2]}${flip(l[3])}>${l[0]}${flip(l[1])}`
    const key = a < b ? a : b
    if (seen.has(key)) return
    seen.add(key)
    out.push(i)
  })
  return out
}

export function encodeGraph(g: StoredGraph): Uint8Array {
  return deflateSync(new TextEncoder().encode(JSON.stringify(g)), { level: 6 })
}

export function decodeGraph(data: Uint8Array): StoredGraph {
  const g = JSON.parse(new TextDecoder().decode(inflateSync(data))) as StoredGraph
  if (g.version !== 1 || !Array.isArray(g.segments) || !Array.isArray(g.links)) throw new Error('The stored assembly graph is in an unknown format')
  return g
}

/** GFA 1 text: a header, one S line per segment (with its length and coverage), one L line per link. */
export function toGfa(g: StoredGraph): string {
  const lines = ['H\tVN:Z:1.0']
  const name = (i: number) => g.segments[i].name.replace(/\s+/g, '_')
  g.segments.forEach((s, i) => {
    // KC: total k-mer count, which Bandage reads as depth; DP: mean depth.
    const tag = g.coverageUnit === 'k-mer' ? `KC:i:${Math.round(s.coverage * Math.max(1, s.length))}` : `DP:f:${s.coverage.toFixed(2)}`
    lines.push(`S\t${name(i)}\t${g.sequences[i] ?? '*'}\tLN:i:${s.length}\t${tag}`)
  })
  for (const [i, [a, as, b, bs]] of g.links.entries()) {
    // A circle's link to itself carries the overlap it was trimmed of: none.
    const ov = a === b && as === bs && g.segments[a].circular ? 0 : g.linkOverlaps?.[i] ?? g.overlap
    lines.push(`L\t${name(a)}\t${as}\t${name(b)}\t${bs}\t${ov}M`)
  }
  return lines.join('\n') + '\n'
}

/** Segments joined to each segment (either end), for walking components. */
export function adjacency(g: AssemblyGraph): number[][] {
  const adj: number[][] = g.segments.map(() => [])
  for (const [a, , b] of g.links) {
    if (a === b) continue
    adj[a].push(b)
    adj[b].push(a)
  }
  return adj
}

/** Connected components, largest (by bases) first. */
export function components(g: AssemblyGraph): number[][] {
  const adj = adjacency(g)
  const seen = new Uint8Array(g.segments.length)
  const out: number[][] = []
  for (let i = 0; i < g.segments.length; i++) {
    if (seen[i]) continue
    const comp: number[] = []
    const stack = [i]
    seen[i] = 1
    while (stack.length) {
      const x = stack.pop()!
      comp.push(x)
      for (const y of adj[x]) if (!seen[y]) { seen[y] = 1; stack.push(y) }
    }
    out.push(comp)
  }
  const bases = (c: number[]) => c.reduce((n, i) => n + g.segments[i].length, 0)
  return out.sort((a, b) => bases(b) - bases(a))
}

/** The graph of long-read contigs: one segment each, circles linked to themselves. */
export function contigGraph(contigs: readonly { name: string; bases: string; circular: boolean; depth: number }[]): StoredGraph {
  return {
    version: 1,
    overlap: 0,
    coverageUnit: 'depth',
    segments: contigs.map((c, i) => ({ name: c.name, length: c.bases.length, coverage: c.depth, circular: c.circular, contig: i })),
    links: contigs.flatMap((c, i): GraphLink[] => (c.circular ? [[i, '+', i, '+']] : [])),
    sequences: contigs.map(c => c.bases),
  }
}
