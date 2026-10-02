/**
 * Backup reminders.
 *
 * Everything the app holds lives in this browser's storage, which the browser
 * may clear: under storage pressure, after a week without a visit in Safari,
 * or when the user clears site data. The only copy that survives that is an
 * exported session file. This tracks when one was last made and whether work
 * has piled up since, and decides when a reminder is worth an interruption.
 *
 * The decisions are pure functions of the record and the clock; the store
 * below only holds the record so the status bar can follow it.
 */

import { create } from 'zustand'

const STORAGE_KEY = 'seqnexus:backup'
const DAY_MS = 24 * 60 * 60 * 1000

/** How often to remind, in days. 0 is off. */
export type ReminderDays = 0 | 7 | 30
export const REMINDER_CHOICES: { days: ReminderDays; label: string }[] = [
  { days: 7, label: 'Weekly' },
  { days: 30, label: 'Monthly' },
  { days: 0, label: 'Never' },
]

/** Above this share of the quota, warn whatever else is going on. */
export const QUOTA_WARN_FRACTION = 0.8

export interface BackupRecord {
  /** The last full session export. */
  lastBackupAt: number | null
  /** The first change not in that export; null when there is none. */
  firstUnbackedChangeAt: number | null
  /** When a reminder was last shown: dismissing one is "later". */
  lastRemindedAt: number | null
  /** When the nearly-full warning was last shown. */
  lastQuotaWarnAt: number | null
  reminderDays: ReminderDays
  /** Whether the browser has been asked to keep our storage. Asked once. */
  persistAsked: boolean
}

export const DEFAULT_RECORD: BackupRecord = {
  lastBackupAt: null,
  firstUnbackedChangeAt: null,
  lastRemindedAt: null,
  lastQuotaWarnAt: null,
  reminderDays: 7,
  persistAsked: false,
}

const time = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

/** A stored record, repaired field by field; null when there is none. */
export function sanitizeRecord(raw: unknown): BackupRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return {
    lastBackupAt: time(r.lastBackupAt),
    firstUnbackedChangeAt: time(r.firstUnbackedChangeAt),
    lastRemindedAt: time(r.lastRemindedAt),
    lastQuotaWarnAt: time(r.lastQuotaWarnAt),
    reminderDays: r.reminderDays === 0 || r.reminderDays === 30 ? r.reminderDays : 7,
    persistAsked: r.persistAsked === true,
  }
}

/** The stored record, or null on the first visit since reminders existed. */
export function loadRecord(): BackupRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? sanitizeRecord(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function saveRecord(record: BackupRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // Reminders are a courtesy; storage that cannot take this small record
    // has bigger problems, which the save path already reports.
  }
}

/**
 * How long changes may sit outside a backup before it counts as overdue.
 * Storage the browser has not promised to keep can go much sooner, so the
 * window halves there.
 */
export function overdueAfterMs(reminderDays: ReminderDays, persisted: boolean): number {
  const days = reminderDays || 7
  return (persisted ? days : days / 2) * DAY_MS
}

/** Whether changes have sat outside a backup for too long. Drives the status bar. */
export function backupOverdue(r: BackupRecord, now: number, persisted: boolean): boolean {
  return r.firstUnbackedChangeAt !== null
    && now - r.firstUnbackedChangeAt >= overdueAfterMs(r.reminderDays, persisted)
}

/** Whether to interrupt with a reminder: overdue, enabled, and not shown too recently. */
export function shouldRemind(r: BackupRecord, now: number, persisted: boolean): boolean {
  if (r.reminderDays === 0 || !backupOverdue(r, now, persisted)) return false
  return r.lastRemindedAt === null || now - r.lastRemindedAt >= overdueAfterMs(r.reminderDays, persisted)
}

/** Whether to warn that storage is nearly full. At most once a day; ignores the reminder setting. */
export function shouldWarnQuota(r: BackupRecord, now: number, usage: number, quota: number): boolean {
  if (quota <= 0 || usage / quota < QUOTA_WARN_FRACTION) return false
  return r.lastQuotaWarnAt === null || now - r.lastQuotaWarnAt >= DAY_MS
}

/** "today", "yesterday", "12 days ago". */
export function daysAgo(ts: number, now: number): string {
  const days = Math.floor((now - ts) / DAY_MS)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

interface BackupStore {
  record: BackupRecord
  /** Null until the browser has said; false where it cannot say. */
  persisted: boolean | null
  /** Whether this browser can be asked to keep storage at all. */
  canPersist: boolean
  /** Replace the record from storage; true when there was none to load. */
  load: () => boolean
  /** Something worth backing up changed. Starts the clock if it is not running. */
  noteChange: (now?: number) => void
  /** A full session export was made. */
  noteBackup: (now?: number) => void
  noteReminded: (now?: number) => void
  noteQuotaWarned: (now?: number) => void
  setReminderDays: (days: ReminderDays) => void
  /** Ask the browser to keep our storage. Resolves to whether it will. */
  requestPersistence: () => Promise<boolean>
  /** Read the browser's current answer without asking. */
  refreshPersisted: () => Promise<void>
}

export const useBackupStore = create<BackupStore>((set, get) => {
  const update = (patch: Partial<BackupRecord>) => {
    const record = { ...get().record, ...patch }
    saveRecord(record)
    set({ record })
  }
  const storage = () => (typeof navigator !== 'undefined' ? navigator.storage : undefined)

  return {
    record: DEFAULT_RECORD,
    persisted: null,
    canPersist: typeof storage()?.persist === 'function',

    load() {
      const stored = loadRecord()
      set({ record: stored ?? DEFAULT_RECORD })
      return stored === null
    },

    noteChange(now = Date.now()) {
      if (get().record.firstUnbackedChangeAt !== null) return
      update({ firstUnbackedChangeAt: now })
    },

    noteBackup(now = Date.now()) {
      update({ lastBackupAt: now, firstUnbackedChangeAt: null })
    },

    noteReminded(now = Date.now()) {
      update({ lastRemindedAt: now })
    },

    noteQuotaWarned(now = Date.now()) {
      update({ lastQuotaWarnAt: now })
    },

    setReminderDays(days) {
      update({ reminderDays: days })
    },

    async requestPersistence() {
      update({ persistAsked: true })
      const s = storage()
      if (!s?.persist) { set({ persisted: false }); return false }
      try {
        const persisted = await s.persist()
        set({ persisted })
        return persisted
      } catch {
        set({ persisted: false })
        return false
      }
    },

    async refreshPersisted() {
      const s = storage()
      if (!s?.persisted) { set({ persisted: false }); return }
      try {
        set({ persisted: await s.persisted() })
      } catch {
        set({ persisted: false })
      }
    },
  }
})
