import { describe, it, expect, beforeEach } from 'vitest'
import { loadSession, consumeLoadWarnings } from './persistence'

const STORAGE_KEY = 'seqnexus_session'
const CORRUPT_KEY = 'seqnexus_session_corrupt'

/**
 * Covers the session-restore failure paths.
 *
 * These matter more than the happy path: when restore fails the user loses
 * work, and the failure is invisible unless it is reported. None of these
 * cases reach IndexedDB — they all fail while reading localStorage metadata —
 * so they run without an IndexedDB implementation in jsdom.
 */
describe('loadSession failure handling', () => {
  beforeEach(() => {
    localStorage.clear()
    consumeLoadWarnings()
  })

  it('returns null without warnings when nothing was ever saved', async () => {
    expect(await loadSession()).toBeNull()
    expect(consumeLoadWarnings()).toEqual([])
  })

  it('warns and preserves the payload when the session is not valid JSON', async () => {
    localStorage.setItem(STORAGE_KEY, '{"tabs": [unclosed')

    expect(await loadSession()).toBeNull()

    const warnings = consumeLoadWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/could not be restored/i)

    // The unreadable payload must survive, or the next autosave destroys the
    // only copy of the user's work.
    const kept = JSON.parse(localStorage.getItem(CORRUPT_KEY)!)
    expect(kept.raw).toBe('{"tabs": [unclosed')
    expect(typeof kept.savedAt).toBe('number')
  })

  it('warns and preserves the payload when the format is unrecognised', async () => {
    const raw = JSON.stringify({ version: 99, tabs: [] })
    localStorage.setItem(STORAGE_KEY, raw)

    expect(await loadSession()).toBeNull()

    const warnings = consumeLoadWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/unrecognised format/i)
    expect(JSON.parse(localStorage.getItem(CORRUPT_KEY)!).raw).toBe(raw)
  })

  it('treats a missing tabs array as unrecognised rather than throwing', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2 }))

    expect(await loadSession()).toBeNull()
    expect(consumeLoadWarnings()).toHaveLength(1)
  })

  it('clears warnings once consumed, so they are reported only once', async () => {
    localStorage.setItem(STORAGE_KEY, 'not json at all')
    await loadSession()

    expect(consumeLoadWarnings()).toHaveLength(1)
    expect(consumeLoadWarnings()).toEqual([])
  })

  it('resets warnings from a previous load instead of accumulating them', async () => {
    localStorage.setItem(STORAGE_KEY, 'not json at all')
    await loadSession()
    // Deliberately not consumed — a second load must not stack warnings.
    await loadSession()

    expect(consumeLoadWarnings()).toHaveLength(1)
  })
})
