import { describe, it, expect } from 'vitest'
import { exportSessionToJson, importSessionFromJson } from './persistence'

function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

describe('structure files in a session file', () => {
  it("carries a structure file of the user's own through export and import", async () => {
    const structures = [{ key: 'file:ABC123', text: 'ATOM      1  N   MET A   1' }]
    const blob = exportSessionToJson('light', { includeReads: false, includeAlignments: false, includeContigs: false }, { structures })
    expect(JSON.parse(await blobText(blob)).structures).toEqual(structures)
    expect(importSessionFromJson(await blobText(blob)).structures).toEqual(structures)
  })

  it('leaves the field out when there are none, and ignores malformed entries', async () => {
    const blob = exportSessionToJson('light', { includeReads: false, includeAlignments: false, includeContigs: false })
    const json = JSON.parse(await blobText(blob))
    expect(json.structures).toBeUndefined()
    json.structures = [{ key: 'k', text: 'ok' }, { key: 3 }, null]
    expect(importSessionFromJson(JSON.stringify(json)).structures).toEqual([{ key: 'k', text: 'ok' }])
  })
})
