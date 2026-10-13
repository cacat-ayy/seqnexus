import { describe, it, expect } from 'vitest'
import { gunzipSync } from 'fflate'
import { exportSessionToJson, importSessionFromJson, sessionFileText } from './persistence'
import { blobBytes } from './utils/file-credit'

const opts = { includeReads: false, includeAlignments: false, includeContigs: false }

describe('compressed session files', () => {
  it('writes gzip that reads back as the same session', async () => {
    const plain = await blobBytes(exportSessionToJson('light', opts))
    const gz = await blobBytes(exportSessionToJson('light', { ...opts, compress: true }))
    expect([gz[0], gz[1]]).toEqual([0x1f, 0x8b])
    const plainJson = JSON.parse(new TextDecoder().decode(plain))
    const gzJson = JSON.parse(new TextDecoder().decode(gunzipSync(gz)))
    delete plainJson.exportedAt
    delete gzJson.exportedAt
    expect(gzJson).toEqual(plainJson)
    expect(() => importSessionFromJson(sessionFileText(gz))).not.toThrow()
  })

  it('reads a plain session file as it is', async () => {
    const plain = await blobBytes(exportSessionToJson('light', opts))
    expect(sessionFileText(plain)).toBe(new TextDecoder().decode(plain))
  })
})
