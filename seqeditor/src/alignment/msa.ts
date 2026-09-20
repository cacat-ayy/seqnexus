/**
 * Progressive multiple sequence alignment.
 *
 * 1. Compute all-pairs distance matrix via pairwise NW scores.
 * 2. Build UPGMA guide tree.
 * 3. Align sequences/profiles progressively following the tree.
 *
 * Profile-profile alignment uses position-specific scoring:
 * score(col_A, col_B) = average of all pairwise residue scores.
 */

import { needlemanWunsch } from './nw'
import type { Scorer } from './matrices'

/** A profile is a list of aligned sequences (columns are aligned). */
type Profile = string[]

interface TreeNode {
  left: TreeNode | null
  right: TreeNode | null
  seqIdx: number // -1 for internal nodes
}

/**
 * Progressive MSA: returns aligned sequences in input order.
 */
export function progressiveMSA(
  sequences: string[],
  scorer: Scorer,
  gapOpen: number,
  gapExtend: number,
): string[] {
  const n = sequences.length
  if (n === 0) return []
  if (n === 1) return [sequences[0]]
  if (n === 2) {
    const r = needlemanWunsch(sequences[0], sequences[1], scorer, gapOpen, gapExtend)
    return [r.alignedA, r.alignedB]
  }

  // Step 1: All-pairs distance matrix
  const dist: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  const scores: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = needlemanWunsch(sequences[i], sequences[j], scorer, gapOpen, gapExtend)
      scores[i][j] = r.score
      scores[j][i] = r.score
      // Convert score to distance: higher score = lower distance
      // Use negative score as distance (shifted so min distance = 0)
      dist[i][j] = -r.score
      dist[j][i] = -r.score
    }
  }

  // Step 2: UPGMA guide tree
  const tree = buildUPGMA(dist, n)

  // Step 3: Progressive alignment following the tree
  // Each leaf starts as a single-sequence profile
  const profiles: (Profile | null)[] = sequences.map(s => [s])
  // Track which original sequence indices are in each profile
  const profileIndices: (number[] | null)[] = sequences.map((_, i) => [i])

  const aligned = alignTree(tree, profiles, profileIndices, scorer, gapOpen, gapExtend)

  // Reorder to match input order
  const result = new Array<string>(n)
  for (let k = 0; k < aligned.profile.length; k++) {
    result[aligned.indices[k]] = aligned.profile[k]
  }
  return result
}

interface AlignedProfile {
  profile: Profile
  indices: number[]
}

function alignTree(
  node: TreeNode,
  profiles: (Profile | null)[],
  profileIndices: (number[] | null)[],
  scorer: Scorer,
  gapOpen: number,
  gapExtend: number,
): AlignedProfile {
  if (node.seqIdx >= 0) {
    return {
      profile: profiles[node.seqIdx]!,
      indices: profileIndices[node.seqIdx]!,
    }
  }

  const left = alignTree(node.left!, profiles, profileIndices, scorer, gapOpen, gapExtend)
  const right = alignTree(node.right!, profiles, profileIndices, scorer, gapOpen, gapExtend)

  const merged = alignProfiles(left.profile, right.profile, scorer, gapOpen, gapExtend)

  return {
    profile: merged,
    indices: [...left.indices, ...right.indices],
  }
}

// ── UPGMA ───────────────────────────────────────────────────────────────────

function buildUPGMA(dist: number[][], n: number): TreeNode {
  // Active clusters
  const nodes: TreeNode[] = Array.from({ length: n }, (_, i) => ({
    left: null, right: null, seqIdx: i,
  }))
  const sizes = new Array(n).fill(1)
  const active = new Set<number>()
  for (let i = 0; i < n; i++) active.add(i)

  // Working distance matrix (mutable copy)
  const d: number[][] = dist.map(row => [...row])

  while (active.size > 1) {
    // Find closest pair
    let minDist = Infinity
    let minI = -1, minJ = -1
    const activeArr = [...active]
    for (let ai = 0; ai < activeArr.length; ai++) {
      for (let aj = ai + 1; aj < activeArr.length; aj++) {
        const i = activeArr[ai], j = activeArr[aj]
        if (d[i][j] < minDist) {
          minDist = d[i][j]
          minI = i; minJ = j
        }
      }
    }

    // Merge minI and minJ into minI
    const newNode: TreeNode = {
      left: nodes[minI],
      right: nodes[minJ],
      seqIdx: -1,
    }
    nodes[minI] = newNode

    // Update distances (UPGMA: weighted average)
    const sI = sizes[minI], sJ = sizes[minJ]
    for (const k of active) {
      if (k === minI || k === minJ) continue
      d[minI][k] = (d[minI][k] * sI + d[minJ][k] * sJ) / (sI + sJ)
      d[k][minI] = d[minI][k]
    }
    sizes[minI] = sI + sJ
    active.delete(minJ)
  }

  return nodes[[...active][0]]
}

// ── Profile-profile alignment ───────────────────────────────────────────────

/**
 * Align two profiles using NW with profile-profile scoring.
 * Returns the merged profile (all sequences from both, with gaps inserted).
 */
function alignProfiles(
  profA: Profile,
  profB: Profile,
  scorer: Scorer,
  gapOpen: number,
  gapExtend: number,
): Profile {
  const colsA = profA[0]?.length ?? 0
  const colsB = profB[0]?.length ?? 0

  if (colsA === 0) return profB
  if (colsB === 0) return profA

  // Profile-profile scorer: average pairwise score between columns
  const profileScorer = (colIdxA: number, colIdxB: number): number => {
    let total = 0
    let count = 0
    for (const seqA of profA) {
      const a = seqA[colIdxA]
      if (a === '-') continue
      for (const seqB of profB) {
        const b = seqB[colIdxB]
        if (b === '-') continue
        total += scorer(a, b)
        count++
      }
    }
    return count > 0 ? total / count : 0
  }

  // NW on profile columns
  const NEG_INF = -1e9
  const m = colsA, n = colsB

  const M  = Array.from({ length: m + 1 }, () => new Float64Array(n + 1))
  const Ix = Array.from({ length: m + 1 }, () => new Float64Array(n + 1))
  const Iy = Array.from({ length: m + 1 }, () => new Float64Array(n + 1))
  const trM  = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1))
  const trIx = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1))
  const trIy = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1))

  M[0][0] = 0; Ix[0][0] = NEG_INF; Iy[0][0] = NEG_INF
  for (let i = 1; i <= m; i++) { M[i][0] = NEG_INF; Ix[i][0] = gapOpen + gapExtend * i; Iy[i][0] = NEG_INF }
  for (let j = 1; j <= n; j++) { M[0][j] = NEG_INF; Ix[0][j] = NEG_INF; Iy[0][j] = gapOpen + gapExtend * j }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const s = profileScorer(i - 1, j - 1)

      const mFromM = M[i-1][j-1] + s, mFromIx = Ix[i-1][j-1] + s, mFromIy = Iy[i-1][j-1] + s
      if (mFromM >= mFromIx && mFromM >= mFromIy) { M[i][j] = mFromM; trM[i][j] = 0 }
      else if (mFromIx >= mFromIy) { M[i][j] = mFromIx; trM[i][j] = 1 }
      else { M[i][j] = mFromIy; trM[i][j] = 2 }

      const ixM = M[i-1][j] + gapOpen + gapExtend, ixIx = Ix[i-1][j] + gapExtend
      if (ixM >= ixIx) { Ix[i][j] = ixM; trIx[i][j] = 0 } else { Ix[i][j] = ixIx; trIx[i][j] = 1 }

      const iyM = M[i][j-1] + gapOpen + gapExtend, iyIy = Iy[i][j-1] + gapExtend
      if (iyM >= iyIy) { Iy[i][j] = iyM; trIy[i][j] = 0 } else { Iy[i][j] = iyIy; trIy[i][j] = 2 }
    }
  }

  // Traceback - build column mapping
  const finalM = M[m][n], finalIx = Ix[m][n], finalIy = Iy[m][n]
  let mat: number
  if (finalM >= finalIx && finalM >= finalIy) mat = 0
  else if (finalIx >= finalIy) mat = 1
  else mat = 2

  // Collect alignment operations in reverse
  const ops: Array<'match' | 'gapB' | 'gapA'> = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i === 0) {
      ops.push('gapA'); j--
    } else if (j === 0) {
      ops.push('gapB'); i--
    } else if (mat === 0) {
      const prev = trM[i][j]; ops.push('match'); i--; j--; mat = prev
    } else if (mat === 1) {
      const prev = trIx[i][j]; ops.push('gapB'); i--; mat = prev
    } else {
      const prev = trIy[i][j]; ops.push('gapA'); j--; mat = prev
    }
  }
  ops.reverse()

  // Build merged profile
  const nA = profA.length, nB = profB.length
  const merged: string[][] = Array.from({ length: nA + nB }, () => [])

  let ai = 0, bi = 0
  for (const op of ops) {
    if (op === 'match') {
      for (let k = 0; k < nA; k++) merged[k].push(profA[k][ai])
      for (let k = 0; k < nB; k++) merged[nA + k].push(profB[k][bi])
      ai++; bi++
    } else if (op === 'gapB') {
      // Consume column from A, insert gap in B
      for (let k = 0; k < nA; k++) merged[k].push(profA[k][ai])
      for (let k = 0; k < nB; k++) merged[nA + k].push('-')
      ai++
    } else {
      // Consume column from B, insert gap in A
      for (let k = 0; k < nA; k++) merged[k].push('-')
      for (let k = 0; k < nB; k++) merged[nA + k].push(profB[k][bi])
      bi++
    }
  }

  return merged.map(row => row.join(''))
}
