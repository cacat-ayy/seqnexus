/**
 * Web Worker: auto-annotate from a list of known annotation sequences.
 *
 * For each reference annotation, scans the document sequence (both strands)
 * for regions with >= minSimilarity match. Uses a k-mer index to avoid
 * brute-force sliding window on large sequences.
 *
 * Input:  AnnotateListRequest
 * Output: { matches: AnnotationMatch[] }
 */

export interface ReferenceAnnotation {
  name: string
  type: string
  sequence: string  // nucleotide sequence of the annotation
  color?: string
}

export interface AnnotateListRequest {
  documentBases: string
  references: ReferenceAnnotation[]
  minSimilarity: number  // 0-100 (percentage)
  bestMatchOnly: boolean // if true, keep only the best match per reference per location
}

export interface AnnotationMatch {
  refName: string
  refType: string
  start: number    // 0-based position in document
  end: number
  strand: 1 | -1
  similarity: number  // 0-100
  color?: string
}

const COMPLEMENT: Record<string, string> = {
  A: 'T', T: 'A', G: 'C', C: 'G',
  a: 't', t: 'a', g: 'c', c: 'g',
  N: 'N', n: 'n',
}

function reverseComplement(seq: string): string {
  const len = seq.length
  const result = new Array<string>(len)
  for (let i = 0; i < len; i++) {
    result[len - 1 - i] = COMPLEMENT[seq[i]] ?? 'N'
  }
  return result.join('')
}

/**
 * Compute percent identity between two equal-length sequences.
 * Returns -1 early if the threshold can't be reached.
 */
function percentIdentity(a: string, b: string, minPercent: number): number {
  const len = a.length
  const maxMismatches = Math.floor(len * (1 - minPercent / 100))
  let mismatches = 0
  let matches = 0
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) matches++
    else if (++mismatches > maxMismatches) return -1
  }
  return (matches / len) * 100
}

/**
 * Build a k-mer index mapping each k-mer to its positions in the sequence.
 */
function buildKmerIndex(seq: string, k: number): Map<string, number[]> {
  const index = new Map<string, number[]>()
  for (let i = 0; i <= seq.length - k; i++) {
    const kmer = seq.slice(i, i + k)
    let positions = index.get(kmer)
    if (!positions) {
      positions = []
      index.set(kmer, positions)
    }
    positions.push(i)
  }
  return index
}

/**
 * Build a map from k-mer → list of positions in the reference where it occurs.
 */
function buildRefKmerPositions(refSeq: string, k: number): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (let i = 0; i <= refSeq.length - k; i++) {
    const kmer = refSeq.slice(i, i + k)
    let arr = map.get(kmer)
    if (!arr) { arr = []; map.set(kmer, arr) }
    arr.push(i)
  }
  return map
}

/**
 * Find candidate positions where a reference might match the document.
 * Uses k-mer hits to identify positions worth checking with full alignment.
 */
function findCandidatePositions(
  docLen: number,
  refSeq: string,
  refKmerPositions: Map<string, number[]>,
  kmerIndex: Map<string, number[]>,
  k: number,
  minSimilarity: number,
): number[] {
  const refLen = refSeq.length
  if (refLen < k) {
    const positions: number[] = []
    for (let i = 0; i <= docLen - refLen; i++) positions.push(i)
    return positions
  }

  // Count k-mer hits per candidate start position.
  // For each k-mer shared between ref and doc, each (refPos, docPos) pair
  // implies candidateStart = docPos - refPos.
  const hitCounts = new Map<number, number>()

  for (const [kmer, refPositions] of refKmerPositions) {
    const docPositions = kmerIndex.get(kmer)
    if (!docPositions) continue
    for (const rj of refPositions) {
      for (const dp of docPositions) {
        const cs = dp - rj
        if (cs < 0 || cs + refLen > docLen) continue
        hitCounts.set(cs, (hitCounts.get(cs) ?? 0) + 1)
      }
    }
  }

  const totalPossibleKmers = refLen - k + 1
  const minHits = Math.max(1, Math.floor(totalPossibleKmers * (minSimilarity / 100) * 0.5))

  const candidates: number[] = []
  for (const [pos, count] of hitCounts) {
    if (count >= minHits) candidates.push(pos)
  }
  return candidates
}

/**
 * Search for a single reference annotation in the document.
 */
function searchReference(
  docUpper: string,
  ref: ReferenceAnnotation,
  kmerIndex: Map<string, number[]>,
  k: number,
  minSimilarity: number,
  bestMatchOnly: boolean,
): AnnotationMatch[] {
  const refUpper = ref.sequence.toUpperCase()
  const refLen = refUpper.length
  if (refLen === 0 || refLen > docUpper.length) return []

  const rcRef = reverseComplement(refUpper)
  const matches: AnnotationMatch[] = []

  // Pre-compute k-mer positions for both strands
  const fwdKmerPos = buildRefKmerPositions(refUpper, k)
  const revKmerPos = buildRefKmerPositions(rcRef, k)

  // Search forward strand
  const fwdCandidates = findCandidatePositions(docUpper.length, refUpper, fwdKmerPos, kmerIndex, k, minSimilarity)
  for (const pos of fwdCandidates) {
    const docSub = docUpper.slice(pos, pos + refLen)
    const sim = percentIdentity(refUpper, docSub, minSimilarity)
    if (sim >= minSimilarity) {
      matches.push({
        refName: ref.name,
        refType: ref.type,
        start: pos,
        end: pos + refLen,
        strand: 1,
        similarity: Math.round(sim * 10) / 10,
        color: ref.color,
      })
    }
  }

  // Search reverse strand
  const revCandidates = findCandidatePositions(docUpper.length, rcRef, revKmerPos, kmerIndex, k, minSimilarity)
  for (const pos of revCandidates) {
    const docSub = docUpper.slice(pos, pos + refLen)
    const sim = percentIdentity(rcRef, docSub, minSimilarity)
    if (sim >= minSimilarity) {
      matches.push({
        refName: ref.name,
        refType: ref.type,
        start: pos,
        end: pos + refLen,
        strand: -1,
        similarity: Math.round(sim * 10) / 10,
        color: ref.color,
      })
    }
  }

  if (bestMatchOnly && matches.length > 1) {
    // Group by overlapping regions and keep only the best per region
    matches.sort((a, b) => a.start - b.start)
    const best: AnnotationMatch[] = []
    let current = matches[0]
    for (let i = 1; i < matches.length; i++) {
      const m = matches[i]
      // Check overlap (75% of shorter annotation length)
      const overlapStart = Math.max(current.start, m.start)
      const overlapEnd = Math.min(current.end, m.end)
      const overlapLen = Math.max(0, overlapEnd - overlapStart)
      const minLen = Math.min(current.end - current.start, m.end - m.start)
      if (overlapLen >= minLen * 0.75) {
        // Overlapping - keep the better one
        if (m.similarity > current.similarity) {
          current = m
        }
      } else {
        best.push(current)
        current = m
      }
    }
    best.push(current)
    return best
  }

  return matches
}

self.onmessage = (e: MessageEvent<AnnotateListRequest>) => {
  const { documentBases, references, minSimilarity, bestMatchOnly } = e.data
  const docUpper = documentBases.toUpperCase()

  // Choose k based on document size (larger k = faster but less sensitive)
  const k = docUpper.length > 100000 ? 10 : docUpper.length > 10000 ? 8 : 6

  // Build k-mer index of the document once
  const kmerIndex = buildKmerIndex(docUpper, k)

  const allMatches: AnnotationMatch[] = []

  for (const ref of references) {
    const matches = searchReference(docUpper, ref, kmerIndex, k, minSimilarity, bestMatchOnly)
    allMatches.push(...matches)
  }

  // Sort by position
  allMatches.sort((a, b) => a.start - b.start)

  self.postMessage({ matches: allMatches })
}
