/**
 * Put new contigs in place of a de novo assembly's: polished ones from a
 * file, or one turned to match an expected sequence. The reads are mapped to
 * the new contigs (stored apart until done, so a failure leaves the old
 * assembly whole), their variant sites counted, the assembly graph carried
 * over, and the assembly swapped with an Undo.
 */

import { useEditorStore, type Assembly, type ReadSet } from '../../store'
import { mappingStorageIds } from '../../ngs/builder'
import { denovoPreset } from '../../ngs/denovo/run'
import type { DeNovoReport } from '../../ngs/denovo/types'
import { deleteMappingStorage, getReadChunk, putReadChunk } from '../../storage/idb'
import { startCallVariants, startMap, wasmBase } from '../../workers/readset'
import type { RefFeature } from '../../assembly/variants'

export interface NewContig {
  name: string
  bases: string
  circular: boolean
  /** An open sequence the contig is (to show its features over the reads), or null. */
  tabId: string | null
  /** Its features, when it has any in the same coordinates (see ReferenceReport). */
  features?: RefFeature[]
}

/** Map the reads to `contigs` and swap them in; returns the Undo, or null if the assembly is gone. */
export async function remapContigs(o: {
  assembly: Assembly
  readSet: ReadSet
  contigs: NewContig[]
  /** The report as it should read afterwards. */
  denovo: DeNovoReport
  onProgress?: (fraction: number) => void
}): Promise<(() => void) | null> {
  const sample = o.assembly.samples?.[0]
  if (!sample) throw new Error('The assembly has no mapping')
  const store = useEditorStore.getState()
  const storageId = store.newAssemblyId()
  const rs = o.readSet
  try {
    const report = await startMap({
      type: 'map', storageId, refs: o.contigs, preset: denovoPreset(rs.technology, o.denovo.settings.method), wasmBase: wasmBase(),
      readSet: { id: rs.id, chunks: rs.chunks, paired: rs.paired, technology: rs.technology, maxLength: rs.stats.maxLength, bases: rs.stats.bases },
    }, (n, t) => o.onProgress?.(t ? (0.9 * n) / t : 0)).promise
    await startCallVariants({ type: 'call-variants', storageId, references: o.contigs.map(r => ({ name: r.name, length: r.bases.length, circular: r.circular })) },
      (n, t) => o.onProgress?.(0.9 + (t ? (0.1 * n) / t : 0))).promise
    // The graph is the assembler's; it goes with the new mapping.
    const graph = await getReadChunk(mappingStorageIds(sample.storageId).graph, 0)
    if (graph) await putReadChunk(mappingStorageIds(storageId).graph, 0, graph)
    return useEditorStore.getState().replaceDeNovo(o.assembly.id, { ...sample, storageId, report }, o.denovo)
  } catch (err) {
    void deleteMappingStorage(storageId)
    throw err
  }
}
