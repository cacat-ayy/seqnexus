import { describe, it, expect, vi, afterEach } from 'vitest'
import { getEnzyme } from '../enzymes/db'
import { findEnzymeSitesAsync, ScanCancelled } from './enzyme-finder'

/** A worker that answers only when told to, so scans can overlap. */
class HeldWorker {
  static all: HeldWorker[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  terminated = false
  constructor() { HeldWorker.all.push(this) }
  postMessage() { /* answered by reply() */ }
  terminate() { this.terminated = true }
  reply() { this.onmessage?.({ data: { sites: [], tooMany: [] } } as unknown as MessageEvent) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  HeldWorker.all = []
})

describe('findEnzymeSitesAsync', () => {
  const EcoRI = getEnzyme('EcoRI')!

  it('lets a scan on one channel finish while another channel scans', async () => {
    vi.stubGlobal('Worker', HeldWorker)
    const panel = findEnzymeSitesAsync('GAATTC', [EcoRI], 'linear', { channel: 'panel' })
    const shown = findEnzymeSitesAsync('GAATTC', [EcoRI], 'linear', { channel: 'shown' })
    const [panelWorker, shownWorker] = HeldWorker.all
    expect(panelWorker.terminated).toBe(false)
    panelWorker.reply()
    shownWorker.reply()
    await expect(panel).resolves.toMatchObject({ sites: [] })
    await expect(shown).resolves.toMatchObject({ sites: [] })
  })

  it('cancels the older scan on the same channel, which rejects instead of hanging', async () => {
    vi.stubGlobal('Worker', HeldWorker)
    const first = findEnzymeSitesAsync('GAATTC', [EcoRI], 'linear', { channel: 'panel' })
    const second = findEnzymeSitesAsync('GAATTC', [EcoRI], 'linear', { channel: 'panel' })
    expect(HeldWorker.all[0].terminated).toBe(true)
    await expect(first).rejects.toBeInstanceOf(ScanCancelled)
    HeldWorker.all[1].reply()
    await expect(second).resolves.toMatchObject({ sites: [] })
  })

  it('runs on the main thread where no worker can start, and rejects if that throws', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('no module workers from file://') } })
    const scan = await findEnzymeSitesAsync('AAGAATTCAA', [EcoRI], 'linear')
    expect(scan.sites.map(s => s.fwdCut)).toEqual([3])
    const broken = { ...EcoRI, recognition: '(' }
    await expect(findEnzymeSitesAsync('AAGAATTCAA', [broken], 'linear')).rejects.toThrow()
  })
})
