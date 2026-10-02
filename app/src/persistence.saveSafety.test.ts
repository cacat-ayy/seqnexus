/**
 * Saving must never destroy data it could not see.
 *
 *  - A storage read that fails once at startup used to make the next autosave
 *    treat the unread items as orphans and delete them.
 *  - Overlapping autosaves used to interleave, so one save's cleanup could
 *    delete what another had just written.
 *
 * IndexedDB is replaced by an in-memory fake that can be told to fail reads
 * or to stall a write.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const state = {
    seqs: new Map<string, string>(),
    traces: new Map<string, unknown>(),
    aligns: new Map<string, unknown>(),
    undo: new Map<string, unknown>(),
    failSequenceReads: false,
    failTraceReads: false,
    /** When set, saveSequences waits for it: lets a test hold a save mid-flight. */
    gate: null as Promise<void> | null,
    sequenceWrites: 0,
    /** Every write and delete, as "kind:id", for checking what a save touched. */
    log: [] as string[],
  }
  const pick = (m: Map<string, unknown>, ids: string[]) => {
    const out = new Map<string, unknown>()
    for (const id of ids) if (m.has(id)) out.set(id, m.get(id))
    return out
  }
  const drop = (m: Map<string, unknown>, ids: string[]) => { for (const id of ids) m.delete(id) }
  return {
    state,
    api: {
      isAvailable: async () => true,
      saveSequences: async (items: { tabId: string; bases: string }[]) => {
        state.sequenceWrites++
        if (state.gate) await state.gate
        for (const s of items) { state.seqs.set(s.tabId, s.bases); state.log.push(`seq:${s.tabId}`) }
      },
      loadSequences: async (ids: string[]) => {
        if (state.failSequenceReads) throw new Error('read failed')
        return pick(state.seqs, ids)
      },
      deleteSequences: async (ids: string[]) => drop(state.seqs, ids),
      getAllStoredIds: async () => [...state.seqs.keys()],
      saveTraces: async (items: { readId: string; data: unknown }[]) => {
        for (const t of items) { state.traces.set(t.readId, t.data); state.log.push(`trace:${t.readId}`) }
      },
      loadTraces: async (ids: string[]) => {
        if (state.failTraceReads) throw new Error('trace read failed')
        return pick(state.traces, ids)
      },
      deleteTraces: async (ids: string[]) => drop(state.traces, ids),
      getAllStoredTraceIds: async () => [...state.traces.keys()],
      saveAlignments: async (items: { alignId: string; data: unknown }[]) => {
        for (const a of items) state.aligns.set(a.alignId, a.data)
      },
      loadAlignments: async (ids: string[]) => pick(state.aligns, ids),
      deleteAlignments: async (ids: string[]) => drop(state.aligns, ids),
      getAllStoredAlignmentIds: async () => [...state.aligns.keys()],
      saveUndoHistory: async (items: { tabId: string; data: unknown }[]) => {
        for (const u of items) { state.undo.set(u.tabId, u.data); state.log.push(`undo:${u.tabId}`) }
      },
      loadUndoHistory: async (ids: string[]) => pick(state.undo, ids),
      deleteUndoHistory: async (ids: string[]) => { for (const id of ids) if (state.undo.has(id)) state.log.push(`undo-delete:${id}`); drop(state.undo, ids) },
      getAllStoredUndoIds: async () => [...state.undo.keys()],
      clearAll: async () => {
        state.seqs.clear(); state.traces.clear(); state.aligns.clear(); state.undo.clear()
      },
    },
  }
})

vi.mock('./storage/idb', async importOriginal => ({
  ...(await importOriginal<typeof import('./storage/idb')>()),
  ...fake.api,
}))

import {
  loadSession, saveSession, consumeLoadWarnings, savedStateChanged, markSessionSaved,
  hasUnsavedChanges, flushSave, scheduleSave, importSessionFromJson,
} from './persistence'
import type { Ab1Data } from './io/ab1'
import { useEditorStore } from './store'

const STORAGE_KEY = 'seqnexus_session'
const db = fake.state
const store = () => useEditorStore.getState()
const index = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!) as {
  tabs: { id: string; doc: { name: string } }[]
  sequencingReads?: { id: string }[]
}

function tab(id: string, name: string) {
  return {
    id, viewMode: 'linear', zoomLevel: 1,
    doc: { name, topology: 'linear', annotations: [] },
  }
}

function writeIndex(extra: Record<string, unknown> = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 2,
    tabs: [tab('t1', 'pOne'), tab('t2', 'pTwo')],
    activeTabId: 't1',
    folders: [],
    theme: 'light',
    ...extra,
  }))
  db.seqs.set('t1', 'AAAA')
  db.seqs.set('t2', 'CCCC')
}

beforeEach(() => {
  localStorage.clear()
  db.seqs.clear(); db.traces.clear(); db.aligns.clear(); db.undo.clear()
  db.failSequenceReads = false
  db.failTraceReads = false
  db.gate = null
  db.sequenceWrites = 0
  db.log = []
  for (const t of store().tabs) store().closeTab(t.id)
  useEditorStore.setState({ sequencingReads: [] })
  consumeLoadWarnings()
})

describe('a failed read at startup', () => {
  it('keeps the unread sequences through the next autosave', async () => {
    writeIndex()
    db.failSequenceReads = true

    const saved = await loadSession()
    expect(saved?.tabs).toEqual([])
    expect(consumeLoadWarnings().join(' ')).toMatch(/pOne, pTwo.*kept/)

    // What the app does next: nothing restored, so it opens the demo and autosaves.
    store().openDocument('pUC19', 'GGGG', 'circular')
    await saveSession('light')

    expect(db.seqs.get('t1')).toBe('AAAA')
    expect(db.seqs.get('t2')).toBe('CCCC')
    expect(index().tabs.map(t => t.doc.name)).toEqual(['pUC19', 'pOne', 'pTwo'])

    // Storage works again on the next visit: everything comes back.
    db.failSequenceReads = false
    const again = await loadSession()
    expect(again?.tabs.map(t => t.doc.sequence.bases).sort()).toEqual(['AAAA', 'CCCC', 'GGGG'])
  })

  it('keeps the unread reads through the next autosave', async () => {
    writeIndex({ sequencingReads: [{ id: 'r1', name: 'read1', trimStart: 0, trimEnd: 0, edits: [] }] })
    db.traces.set('r1', { name: 'read1' })
    db.failTraceReads = true

    const saved = await loadSession()
    expect(saved?.sequencingReads).toEqual([])
    expect(consumeLoadWarnings().join(' ')).toMatch(/read.*kept/)

    await saveSession('light')
    expect(db.traces.has('r1')).toBe(true)
    expect(index().sequencingReads?.map(r => r.id)).toEqual(['r1'])
  })

  it('still drops sequences whose data is really gone', async () => {
    writeIndex()
    db.seqs.delete('t2')

    const saved = await loadSession()
    expect(saved?.tabs.map(t => t.doc.name)).toEqual(['pOne'])
    expect(consumeLoadWarnings().join(' ')).toMatch(/data missing from storage.*pTwo/)
  })
})

describe('an unreadable saved session', () => {
  it('keeps its stored data, on this visit and later ones', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, tabs: [tab('t1', 'pOne')] }))
    db.seqs.set('t1', 'AAAA')

    expect(await loadSession()).toBeNull()
    store().openDocument('pUC19', 'GGGG', 'circular')
    await saveSession('light')
    expect(db.seqs.get('t1')).toBe('AAAA')

    // Next visit: the index now holds only the demo and reads fine, but the
    // parked copy still needs t1's data.
    const next = await loadSession()
    expect(next?.tabs.map(t => t.doc.name)).toEqual(['pUC19'])
    await saveSession('light')
    expect(db.seqs.get('t1')).toBe('AAAA')
  })
})

describe('overlapping saves', () => {
  it('run one after another, so a newer save is never undone by an older one', async () => {
    await loadSession()
    store().openDocument('pA', 'AAAA')

    let release!: () => void
    db.gate = new Promise(r => { release = r })
    const first = saveSession('light')
    await Promise.resolve()

    // While the first save is held mid-write, the user opens another sequence.
    store().openDocument('pB', 'CCCC')
    const second = saveSession('light')

    db.gate = null
    release()
    await Promise.all([first, second])

    const ids = store().tabs.map(t => t.id)
    expect(index().tabs.map(t => t.doc.name)).toEqual(['pA', 'pB'])
    for (const id of ids) expect(db.seqs.has(id)).toBe(true)
  })

  it('collapse any number of requests made during a save into one more save', async () => {
    await loadSession()
    store().openDocument('pA', 'AAAA')

    // Every save ends by writing the index; count those.
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const indexWrites = () => setItem.mock.calls.filter(([k]) => k === STORAGE_KEY).length

    let release!: () => void
    db.gate = new Promise(r => { release = r })
    const first = saveSession('light')
    const rest = [saveSession('light'), saveSession('light'), saveSession('dark')]
    db.gate = null
    release()
    await Promise.all([first, ...rest])

    expect(indexWrites()).toBe(2)
    setItem.mockRestore()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).theme).toBe('dark')
  })
})

describe('what a save writes (M1)', () => {
  const read = (name: string) => ({ name, bases: 'ACGT' }) as unknown as Ab1Data

  it('schedules a save for edits, not for caret moves', () => {
    store().openDocument('pA', 'AAAA')
    let prev = store()
    store().setCaret(2)
    expect(savedStateChanged(store(), prev)).toBe(false)
    prev = store()
    store().insert(0, 'G')
    expect(savedStateChanged(store(), prev)).toBe(true)
  })

  it('writes only the sequence that changed, and no trace twice', async () => {
    await loadSession()
    store().openDocument('pA', 'AAAA')
    const a = store().activeTabId!
    store().openDocument('pB', 'CCCC')
    store().addSequencingRead(read('r1'))
    await saveSession('light')
    expect(db.log.filter(l => !l.startsWith('undo-delete'))).toHaveLength(3)

    db.log = []
    store().setActiveTab(a)
    store().insert(0, 'G')
    await saveSession('light')
    expect(db.log).toEqual([`seq:${a}`, `undo:${a}`])
    expect(db.seqs.get(a)).toBe('GAAAA')
  })

  it('writes nothing back right after a restore', async () => {
    await loadSession()
    store().openDocument('pA', 'AAAA')
    store().addSequencingRead(read('r1'))
    await saveSession('light')
    for (const t of store().tabs) store().closeTab(t.id)
    useEditorStore.setState({ sequencingReads: [] })

    const saved = (await loadSession())!
    store().restoreSession(saved.tabs, saved.activeTabId, saved.folders, saved.sequencingReads,
      saved.activeSequencingReadIds, saved.alignments, saved.contigs, saved.activeAlignmentId,
      saved.activeContigId, saved.itemMeta, saved.tagColors, saved.oligos)
    markSessionSaved()
    db.log = []
    await saveSession('light')
    expect(db.log).toEqual([])
  })

  it('removes stored history a tab no longer has, so a reload shows the current bases', async () => {
    await loadSession()
    store().openDocument('pA', 'AAAA')
    store().insert(0, 'GG')
    await saveSession('light')
    expect(db.undo.size).toBe(1)

    // Replaces the document and clears its history.
    store().loadDocument('pA', 'TTTT')
    await saveSession('light')
    expect(db.undo.size).toBe(0)
    expect((await loadSession())!.tabs[0].doc.sequence.bases).toBe('TTTT')
  })

  it('ignores stored history that does not match the stored bases', async () => {
    await loadSession()
    store().openDocument('pA', 'AAAA')
    store().insert(0, 'GG')
    await saveSession('light')
    const id = store().activeTabId!
    db.seqs.set(id, 'TTTT') // as if an older save had left the history behind
    const tab = (await loadSession())!.tabs[0]
    expect(tab.doc.sequence.bases).toBe('TTTT')
    expect(tab.undoStack).toBeUndefined()
  })
})

describe('closing the page (M2)', () => {
  it('reports unsaved work while a save waits, and saves at once on flush', async () => {
    await loadSession()
    store().openDocument('pA', 'AAAA')
    await saveSession('light')
    expect(hasUnsavedChanges()).toBe(false)

    store().insert(0, 'G')
    scheduleSave('light')
    expect(hasUnsavedChanges()).toBe(true)
    flushSave('light')
    await saveSession('light') // waits for the flushed save
    expect(db.seqs.get(store().activeTabId!)).toBe('GAAAA')
    expect(hasUnsavedChanges()).toBe(false)
  })
})

describe('items whose data is missing (M4)', () => {
  it('are named in a warning on load, not dropped silently', async () => {
    writeIndex({
      sequencingReads: [{ id: 'r1', name: 'read1', trimStart: 0, trimEnd: 0, edits: [] }],
      alignments: [{ id: 'a1', name: 'my alignment', createdAt: 0 }],
    })
    const saved = await loadSession()
    expect(saved?.sequencingReads).toEqual([])
    const warnings = consumeLoadWarnings().join('\n')
    expect(warnings).toMatch(/1 sequencing read could not be restored.*read1/)
    expect(warnings).toMatch(/1 alignment could not be restored.*my alignment/)
  })

  it('are named when a session file lacks them', () => {
    const json = JSON.stringify({
      format: 'seqnexus-session', version: 1,
      session: {
        version: 2, tabs: [tab('t1', 'pOne'), tab('t2', 'pTwo')], activeTabId: 't1', folders: [], theme: 'light',
        sequencingReads: [{ id: 'r1', name: 'read1', trimStart: 0, trimEnd: 0, edits: [] }],
      },
      sequences: [{ tabId: 't1', bases: 'AAAA' }],
    })
    const session = importSessionFromJson(json)
    expect(session.tabs).toHaveLength(1)
    expect(session.warnings?.join('\n')).toMatch(/1 sequence could not be restored \(not in the file\): pTwo/)
    expect(session.warnings?.join('\n')).toMatch(/read1/)
  })
})
