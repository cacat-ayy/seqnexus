/**
 * MAFFT WebAssembly wrapper using Aioli.
 *
 * Runs MAFFT alignment via the biowasm CDN through the Aioli library,
 * which handles Emscripten module instantiation, virtual filesystem,
 * and proper argument passing.
 */

import type { AlignmentResult, AlignedSequence } from '../alignment/types'
import { toFasta, fromAlignedFasta } from '../alignment/fasta-io'
import {
  computeConsensus,
  computeConservation,
  pairwiseIdentityMatrix,
} from '../alignment/consensus'

// Lazy-loaded Aioli instance (persists across calls — WASM stays warm)
let aioliInstance: any = null
let aioliLoading: Promise<any> | null = null

/** Check if MAFFT has been initialized (WASM loaded). */
export async function isMafftAvailable(): Promise<boolean> {
  return aioliInstance !== null
}

async function getAioli(onProgress?: (fraction: number) => void): Promise<any> {
  if (aioliInstance) {
    onProgress?.(1)
    return aioliInstance
  }
  if (aioliLoading) {
    onProgress?.(1)
    return aioliLoading
  }

  onProgress?.(0.1)

  aioliLoading = (async () => {
    const Aioli = (await import('@biowasm/aioli')).default
    onProgress?.(0.3)

    const cli = await new Aioli([{
      tool: 'mafft',
      version: '7.520',
      program: 'tbfast',
    }])
    onProgress?.(1)

    aioliInstance = cli
    return cli
  })()

  try {
    return await aioliLoading
  } catch (e) {
    aioliLoading = null
    throw e
  }
}

/**
 * Run MAFFT alignment on the given sequences.
 */
export async function runMafft(
  sequences: { name: string; bases: string }[],
  _seqType: 'dna' | 'protein',
  onProgress?: (fraction: number) => void,
): Promise<AlignmentResult> {
  if (sequences.length < 2) {
    throw new Error('MAFFT requires at least 2 sequences')
  }

  const cli = await getAioli(onProgress)

  // Write input FASTA to the virtual filesystem
  const inputFasta = toFasta(sequences)
  const inputPath = '/data/input.fasta'
  await cli.fs('writeFile', inputPath, inputFasta)

  // Run tbfast — Aioli handles the Emscripten module and filesystem
  const result = await cli.exec(`tbfast ${inputPath}`)

  const stdout: string = typeof result === 'string' ? result : (result?.stdout ?? '')
  const stderr: string = typeof result === 'string' ? '' : (result?.stderr ?? '')

  if (!stdout.trim()) {
    const errMsg = stderr.trim() || 'MAFFT produced no output'
    throw new Error(`MAFFT failed: ${errMsg}`)
  }

  // Parse aligned FASTA output
  const aligned = fromAlignedFasta(stdout)

  if (aligned.length === 0) {
    throw new Error('MAFFT produced no aligned sequences')
  }

  // Build AlignedSequence array, matching back to original sequences by order
  const alignedSeqs: AlignedSequence[] = aligned.map((a, i) => ({
    name: sequences[i]?.name ?? a.name,
    alignedBases: a.alignedBases.toUpperCase(),
    originalBases: sequences[i]?.bases ?? a.alignedBases.replace(/-/g, ''),
  }))

  // Compute alignment statistics
  const alignedBases = alignedSeqs.map(s => s.alignedBases)
  const alnLen = alignedBases[0]?.length ?? 0
  const consensus = computeConsensus(alignedBases)
  const conservation = computeConservation(alignedBases, consensus)
  const pairwiseMatrix = pairwiseIdentityMatrix(alignedBases)

  // Average pairwise identity
  let idSum = 0, idCount = 0
  for (let i = 0; i < pairwiseMatrix.length; i++) {
    for (let j = i + 1; j < pairwiseMatrix[i].length; j++) {
      idSum += pairwiseMatrix[i][j]
      idCount++
    }
  }
  const identity = idCount > 0 ? idSum / idCount : 0

  // Gap fraction
  let gapCols = 0
  for (let col = 0; col < alnLen; col++) {
    if (alignedBases.some(s => s[col] === '-')) gapCols++
  }
  const gaps = alnLen > 0 ? gapCols / alnLen : 0

  return {
    sequences: alignedSeqs,
    consensus,
    conservation,
    score: 0,
    identity,
    similarity: identity,
    gaps,
    alignmentLength: alnLen,
    pairwiseIdentityMatrix: pairwiseMatrix,
    algorithm: 'mafft',
  }
}
