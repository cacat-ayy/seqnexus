/**
 * Calling mixed bases (heterozygous positions) from second peaks.
 *
 * Where the second-tallest channel reaches a set fraction of the called one,
 * the call becomes the IUPAC code for both bases (A + G → R). The calls are
 * stored as edits marked `by: 'mixed'`, so they show as edits, undo as one
 * step, and running the caller again first clears its previous calls.
 * Calls the user typed are left alone.
 */

import type { TraceData } from '../io/trace'
import type { BaseEdit } from '../store'
import { baseBits, codeForBits } from '../msa/iupac'
import { peakTable } from './peaks'

const CHANNELS = ['A', 'C', 'G', 'T'] as const

export interface MixedSettings {
  enabled: boolean
  /** Second-to-first peak height that counts as mixed. */
  ratio: number
  /** Leave bases the user edited by hand as they are. */
  keepUserEdits: boolean
}

export const DEFAULT_MIXED: MixedSettings = { enabled: false, ratio: 0.33, keepUserEdits: true }

export interface MixedPlan {
  edits: BaseEdit[]
  /** Mixed calls made. */
  calls: number
  /** Previous mixed calls cleared (re-called or not). */
  cleared: number
}

/** Edits with mixed bases called inside [trimStart, trimEnd). */
export function planMixedCalls(
  data: TraceData,
  edits: readonly BaseEdit[],
  trimStart: number,
  trimEnd: number,
  s: Pick<MixedSettings, 'ratio' | 'keepUserEdits'>,
): MixedPlan {
  const kept = edits.filter(e => !(e.type === 'substitute' && e.by === 'mixed'))
  const cleared = edits.length - kept.length
  const handEdited = new Set<number>()
  for (const e of kept) if (e.type !== 'insert') handEdited.add(e.pos)
  const t = peakTable(data)
  const out: BaseEdit[] = [...kept]
  let calls = 0
  for (let i = Math.max(0, trimStart); i < Math.min(trimEnd, t.length); i++) {
    if (handEdited.has(i)) {
      if (s.keepUserEdits) continue
    }
    const p = t.primary[i]
    if (p <= 0 || t.secondary[i] / p < s.ratio) continue
    const code = codeForBits(baseBits(CHANNELS[t.primaryBase[i]]) | baseBits(CHANNELS[t.secondaryBase[i]]))
    const original = data.bases[i]
    if (code === original) continue
    if (handEdited.has(i)) {
      // Replacing a hand edit: drop it first.
      for (let k = out.length - 1; k >= 0; k--) {
        const e = out[k]
        if (e.type !== 'insert' && e.pos === i) out.splice(k, 1)
      }
    }
    out.push({ type: 'substitute', pos: i, original, base: code, by: 'mixed' })
    calls++
  }
  return { edits: out, calls, cleared }
}

/** The edits without any mixed calls. */
export function clearMixedCalls(edits: readonly BaseEdit[]): BaseEdit[] {
  return edits.filter(e => !(e.type === 'substitute' && e.by === 'mixed'))
}

export function countMixedCalls(edits: readonly BaseEdit[]): number {
  let k = 0
  for (const e of edits) if (e.type === 'substitute' && e.by === 'mixed') k++
  return k
}
