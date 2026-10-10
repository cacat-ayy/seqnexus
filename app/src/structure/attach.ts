/**
 * Putting a structure on a protein, and opening a structure file as
 * proteins. Both find the chain by aligning (structure/align.ts), so the
 * reference always names the chain the residues were matched against.
 */

import { useEditorStore } from '../store'
import { notify } from '../toast'
import { Sequence } from '../models/Sequence'
import type { DocumentState } from '../models/Document'
import { parseStructure } from './parse'
import { bestChain, identity } from './align'
import type { FetchedStructure } from './sources'

/** Below this identity the chain is probably another protein; say so. */
const LOW_IDENTITY = 0.3

export interface AttachResult {
  chain: string
  identity: number
  aligned: number
}

/** Attach to the open protein, on the chain that matches it best. */
export function attachToOpenProtein(fetched: FetchedStructure): AttachResult {
  const s = useEditorStore.getState()
  const residues = s.doc.sequence.bases
  const parsed = parseStructure(fetched.text, fetched.ref.format)
  if (parsed.chains.length === 0) throw new Error(`${fetched.ref.id} has no protein chains.`)
  const best = bestChain(residues, parsed.chains)
  if (!best || best.aligned === 0) throw new Error(`No chain of ${fetched.ref.id} lines up with this protein.`)
  s.setStructure({ ...fetched.ref, chain: best.chain, title: fetched.ref.title ?? parsed.title })
  const result = { chain: best.chain, identity: identity(best), aligned: best.aligned }
  if (result.identity < LOW_IDENTITY) {
    notify.warning(`Chain ${best.chain} of ${fetched.ref.id} is only ${Math.round(result.identity * 100)}% identical to this protein`, {
      detail: 'Is this the right structure? Residues are mapped through the alignment either way.',
    })
  }
  return result
}

/**
 * A structure file as protein documents: one per distinct chain sequence
 * (the copies of a homodimer are one protein), each with the structure
 * attached on its chain. The sequence is the residues the model has, so
 * disordered stretches missing from the file are missing from it too.
 */
export function proteinsFromStructure(fetched: FetchedStructure, baseName: string): DocumentState[] {
  const parsed = parseStructure(fetched.text, fetched.ref.format)
  const groups = new Map<string, string[]>()
  for (const c of parsed.chains) {
    if (c.sequence.length < 2) continue
    groups.set(c.sequence, [...(groups.get(c.sequence) ?? []), c.id])
  }
  const several = groups.size > 1
  return [...groups].map(([sequence, chains]) => ({
    name: several ? `${baseName} chain ${chains.join('')}` : baseName,
    description: parsed.title,
    sequence: new Sequence(sequence, 'linear', 'protein'),
    annotations: [],
    metadata: {
      origin: 'import' as const,
      structure: { ...fetched.ref, chain: chains[0], title: fetched.ref.title ?? parsed.title },
    },
  }))
}
