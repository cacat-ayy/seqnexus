import { describe, it, expect, vi, afterEach } from 'vitest'
import { DEFAULT_ENGINE_SETTINGS } from './catalog'

const fromDisk = vi.hoisted(() => ({ value: false }))
vi.mock('../../utils/opened-as-file', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/opened-as-file')>()),
  openedAsFile: () => fromDisk.value,
}))

import { startAlignment } from './runner'

const SEQS = ['ACGTACGTACGTAAAC', 'ACGTACGAACGTAAAC', 'ACGTACGTACGTTAAC']

describe('startAlignment when the aligner cannot start', () => {
  afterEach(() => { fromDisk.value = false })

  // Opened from disk, Chrome throws on `new Worker` at once. That used to
  // escape startAlignment, and the dialog waited on "Aligning…" for good.
  it('rejects the job instead of throwing, and says why when opened from disk', async () => {
    fromDisk.value = true
    const job = startAlignment(SEQS, 'dna', { ...DEFAULT_ENGINE_SETTINGS, engine: 'mafft' })
    await expect(job.promise).rejects.toThrow(/cannot run while SeqNexus is opened as a file/)
  })

  it('rejects with the reason when a served page cannot start the worker either', async () => {
    const job = startAlignment(SEQS, 'dna', { ...DEFAULT_ENGINE_SETTINGS, engine: 'kalign' })
    await expect(job.promise).rejects.toThrow(/could not start/)
  })
})
