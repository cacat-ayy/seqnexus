/**
 * Watches for work that is not in any backup and, once the session is
 * restored, decides whether to say so.
 *
 * Checked on start-up only: it is the one moment the user is not in the middle
 * of something, and a page cannot show its own message while it closes.
 */

import { useEffect, useRef } from 'react'
import { useEditorStore } from '../store'
import { notify } from '../toast'
import { estimateStorage } from '../storage/idb'
import { PUC19_SEQUENCE } from '../demo'
import {
  useBackupStore, shouldRemind, shouldWarnQuota,
} from '../backup/backup'

const DAY_MS = 24 * 60 * 60 * 1000

type EditorState = ReturnType<typeof useEditorStore.getState>

/**
 * Whether anything worth backing up changed. Narrower than what autosave
 * watches: switching tabs or enzyme filters is not work anyone would miss.
 */
export function workChanged(state: EditorState, prev: EditorState): boolean {
  if (state.tabs !== prev.tabs) {
    if (state.tabs.length !== prev.tabs.length) return true
    for (let i = 0; i < state.tabs.length; i++) {
      const a = state.tabs[i]
      const b = prev.tabs[i]
      if (a !== b && (a.id !== b.id || a.doc !== b.doc)) return true
    }
  }
  return state.sequencingReads !== prev.sequencingReads
    || state.alignments !== prev.alignments
    || state.contigs !== prev.contigs
    || state.oligos !== prev.oligos
    || state.gels !== prev.gels
    || state.itemMeta !== prev.itemMeta
}

/** Whether there is anything to lose: not an empty session or the untouched demo. */
export function hasWork(s: EditorState): boolean {
  if (s.sequencingReads.length || s.alignments.length || s.contigs.length || s.oligos.length || s.gels.length) return true
  if (s.tabs.length !== 1) return s.tabs.length > 1
  const doc = s.tabs[0].id === s.activeTabId ? s.doc : s.tabs[0].doc
  const isDemo = doc.sequence.length === PUC19_SEQUENCE.length
    && doc.annotations.every(a => a.id.startsWith('demo_'))
    && doc.sequence.bases === PUC19_SEQUENCE
  return !isDemo
}

function remind(onBackupNow: () => void, persisted: boolean): void {
  const { record, noteReminded } = useBackupStore.getState()
  const since = record.firstUnbackedChangeAt ?? Date.now()
  const days = Math.max(1, Math.floor((Date.now() - since) / DAY_MS))
  notify.info('Back up your session', {
    detail: `${days} day${days === 1 ? '' : 's'} of changes exist only in this browser${persisted ? '' : ', which may clear its storage'}.`
      + ' Reminders can be changed from the storage meter in the status bar.',
    action: { label: 'Back up now', onClick: onBackupNow },
    duration: 15000,
    key: 'backup-reminder',
  })
  noteReminded()
}

export function useBackupReminder(
  /** True once the saved session (or the demo) is in the store. */
  restored: boolean,
  /** Whether what was restored came from storage rather than the demo. */
  restoredFromSave: boolean,
  onBackupNow: () => void,
): void {
  const onBackupRef = useRef(onBackupNow)
  onBackupRef.current = onBackupNow
  const started = useRef(false)

  // Start-up: load the record, ask for persistent storage, maybe remind.
  useEffect(() => {
    if (!restored || started.current) return
    started.current = true
    let cancelled = false
    const backup = useBackupStore.getState()
    const firstRun = backup.load()
    const work = hasWork(useEditorStore.getState())
    // The first visit since reminders existed: whatever was already here has
    // never been tracked, so start its clock now rather than never.
    if (firstRun && restoredFromSave && work) backup.noteChange()

    ;(async () => {
      await backup.refreshPersisted()
      if (cancelled) return
      const s = useBackupStore.getState()
      if (work && !s.record.persistAsked && !s.persisted) await s.requestPersistence()
      if (cancelled) return

      const now = Date.now()
      const { record, persisted } = useBackupStore.getState()
      const est = await estimateStorage().catch(() => null)
      if (cancelled) return
      if (est && shouldWarnQuota(record, now, est.usage, est.quota)) {
        notify.warning(`Browser storage is ${Math.round((est.usage / est.quota) * 100)}% full`, {
          detail: 'Back up your session, then delete what you no longer need. Saving stops when it is full.',
          action: { label: 'Back up now', onClick: () => onBackupRef.current() },
          duration: 15000,
          key: 'backup-quota',
        })
        useBackupStore.getState().noteQuotaWarned(now)
        // One interruption per visit is plenty; the backup it asks for
        // answers the reminder too.
        return
      }
      if (shouldRemind(record, now, !!persisted)) remind(() => onBackupRef.current(), !!persisted)
    })()
    return () => { cancelled = true }
  }, [restored, restoredFromSave])

  // From here on, the first change after a backup starts the clock, and the
  // first real work is when to ask the browser to keep it.
  useEffect(() => {
    if (!restored) return
    return useEditorStore.subscribe((state, prev) => {
      if (!workChanged(state, prev)) return
      const backup = useBackupStore.getState()
      backup.noteChange()
      if (!backup.record.persistAsked && !backup.persisted) void backup.requestPersistence()
    })
  }, [restored])
}

