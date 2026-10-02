import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_RECORD, sanitizeRecord, backupOverdue, shouldRemind, shouldWarnQuota,
  overdueAfterMs, daysAgo, useBackupStore, loadRecord, type BackupRecord,
} from './backup'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 2)
const rec = (patch: Partial<BackupRecord>): BackupRecord => ({ ...DEFAULT_RECORD, ...patch })

describe('when a backup is overdue', () => {
  it('is never overdue with nothing outside a backup', () => {
    expect(backupOverdue(rec({ lastBackupAt: NOW - 400 * DAY }), NOW, true)).toBe(false)
  })

  it('counts from the first change not in a backup', () => {
    expect(backupOverdue(rec({ firstUnbackedChangeAt: NOW - 6 * DAY }), NOW, true)).toBe(false)
    expect(backupOverdue(rec({ firstUnbackedChangeAt: NOW - 7 * DAY }), NOW, true)).toBe(true)
  })

  it('comes twice as soon when the browser may clear storage', () => {
    expect(overdueAfterMs(7, false)).toBe(3.5 * DAY)
    expect(backupOverdue(rec({ firstUnbackedChangeAt: NOW - 4 * DAY }), NOW, false)).toBe(true)
  })

  it('follows the monthly setting, and stays weekly for the status bar when reminders are off', () => {
    const r = rec({ firstUnbackedChangeAt: NOW - 10 * DAY })
    expect(backupOverdue({ ...r, reminderDays: 30 }, NOW, true)).toBe(false)
    expect(backupOverdue({ ...r, reminderDays: 0 }, NOW, true)).toBe(true)
  })
})

describe('when to remind', () => {
  const overdue = rec({ firstUnbackedChangeAt: NOW - 10 * DAY })

  it('reminds when overdue and never reminded', () => {
    expect(shouldRemind(overdue, NOW, true)).toBe(true)
  })

  it('does not remind when reminders are off', () => {
    expect(shouldRemind({ ...overdue, reminderDays: 0 }, NOW, true)).toBe(false)
  })

  it('waits a full interval after the last reminder', () => {
    expect(shouldRemind({ ...overdue, lastRemindedAt: NOW - 2 * DAY }, NOW, true)).toBe(false)
    expect(shouldRemind({ ...overdue, lastRemindedAt: NOW - 7 * DAY }, NOW, true)).toBe(true)
  })
})

describe('the nearly-full warning', () => {
  it('warns above 80% at most once a day, whatever the reminder setting', () => {
    const off = rec({ reminderDays: 0 })
    expect(shouldWarnQuota(off, NOW, 79, 100)).toBe(false)
    expect(shouldWarnQuota(off, NOW, 85, 100)).toBe(true)
    expect(shouldWarnQuota({ ...off, lastQuotaWarnAt: NOW - DAY / 2 }, NOW, 85, 100)).toBe(false)
    expect(shouldWarnQuota(off, NOW, 85, 0)).toBe(false)
  })
})

describe('the stored record', () => {
  beforeEach(() => {
    localStorage.removeItem('seqnexus:backup')
    useBackupStore.setState({ record: DEFAULT_RECORD, persisted: null })
  })

  it('repairs bad fields and rejects non-objects', () => {
    expect(sanitizeRecord('x')).toBeNull()
    expect(sanitizeRecord({ lastBackupAt: 'yesterday', reminderDays: 12, persistAsked: 1 }))
      .toEqual(DEFAULT_RECORD)
    expect(sanitizeRecord({ reminderDays: 0 })?.reminderDays).toBe(0)
  })

  it('reports a first run, then keeps what was written', () => {
    expect(useBackupStore.getState().load()).toBe(true)
    useBackupStore.getState().noteChange(NOW)
    expect(loadRecord()?.firstUnbackedChangeAt).toBe(NOW)
    expect(useBackupStore.getState().load()).toBe(false)
  })

  it('keeps the first change, and a backup clears it', () => {
    const s = () => useBackupStore.getState()
    s().noteChange(NOW - DAY)
    s().noteChange(NOW)
    expect(s().record.firstUnbackedChangeAt).toBe(NOW - DAY)
    s().noteBackup(NOW)
    expect(s().record).toMatchObject({ lastBackupAt: NOW, firstUnbackedChangeAt: null })
  })
})

describe('daysAgo', () => {
  it('reads naturally', () => {
    expect(daysAgo(NOW - 1000, NOW)).toBe('today')
    expect(daysAgo(NOW - DAY, NOW)).toBe('yesterday')
    expect(daysAgo(NOW - 12 * DAY, NOW)).toBe('12 days ago')
  })
})
