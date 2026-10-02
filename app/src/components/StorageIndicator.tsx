import './StorageIndicator.css'
/**
 * Storage and backup status for the status bar.
 *
 * Shows a color-coded bar (green/yellow/red) with a percentage label, and a
 * dot when changes have gone too long without a backup. Clicking it opens
 * the details: usage, whether the browser has promised to keep the data,
 * when the last backup was made, how often to be reminded, and a way to make
 * one. Uses navigator.storage.estimate() for IndexedDB quota/usage and falls
 * back to estimating localStorage usage if the Storage API is unavailable.
 * Hides entirely if neither source is available.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { HardDrive } from 'lucide-react'
import { estimateStorage } from '../storage/idb'
import { usePopoverDismiss } from '../hooks/usePopoverDismiss'
import { notify, useToastStore } from '../toast'
import {
  useBackupStore, backupOverdue, daysAgo, REMINDER_CHOICES, type ReminderDays,
} from '../backup/backup'

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function barColor(pct: number): string {
  if (pct > 80) return '#e53e3e'
  if (pct > 50) return '#d69e2e'
  return '#38a169'
}

/** Estimate localStorage usage in bytes. */
function estimateLocalStorageBytes(): number {
  try {
    let total = 0
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key) {
        total += key.length * 2 // UTF-16
        const val = localStorage.getItem(key)
        if (val) total += val.length * 2
      }
    }
    return total
  } catch {
    return 0
  }
}

/** "Changes from the last 9 days are only in this browser." */
function unbackedNote(since: number, now: number): string {
  const days = Math.floor((now - since) / 86_400_000)
  if (days <= 0) return 'Changes made today are only in this browser.'
  if (days === 1) return 'Changes made since yesterday are only in this browser.'
  return `Changes from the last ${days} days are only in this browser.`
}

export interface StorageIndicatorProps {
  /** Increment this value to trigger a refresh after saves. */
  refreshKey?: number
  /** Open the session export, which is what a backup is. */
  onBackup?: () => void
}

export default function StorageIndicator({ refreshKey, onBackup }: StorageIndicatorProps) {
  const [usage, setUsage] = useState<number | null>(null)
  const [quota, setQuota] = useState<number | null>(null)
  const [available, setAvailable] = useState(true)
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const record = useBackupStore(s => s.record)
  const persisted = useBackupStore(s => s.persisted)
  const canPersist = useBackupStore(s => s.canPersist)
  const setReminderDays = useBackupStore(s => s.setReminderDays)

  const close = useCallback(() => setOpen(false), [])
  usePopoverDismiss(open, close, popRef, btnRef)

  const refresh = useCallback(async () => {
    const est = await estimateStorage()
    if (est && est.quota > 0) {
      // Add localStorage usage to the IndexedDB estimate
      const lsBytes = estimateLocalStorageBytes()
      setUsage(est.usage + lsBytes)
      setQuota(est.quota)
      setAvailable(true)
    } else {
      // No Storage API - try localStorage-only estimate with 5 MB assumed quota
      const lsBytes = estimateLocalStorageBytes()
      if (lsBytes > 0) {
        setUsage(lsBytes)
        setQuota(5 * 1024 * 1024)
        setAvailable(true)
      } else {
        setAvailable(false)
      }
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh, refreshKey])

  const keepData = useCallback(async () => {
    const granted = await useBackupStore.getState().requestPersistence()
    if (granted) notify.success('The browser will keep this data until you clear it')
    else notify.info('The browser did not agree to keep this data', {
      detail: 'Some browsers decide by how often a site is used. A backup file is the copy that is always safe.',
    })
  }, [])

  if (!available || usage === null || quota === null) return null

  const pct = Math.min(100, (usage / quota) * 100)
  const color = barColor(pct)
  const now = Date.now()
  const overdue = backupOverdue(record, now, !!persisted)

  return (
    <span className="storage-indicator">
      <button
        ref={btnRef}
        type="button"
        className="storage-indicator-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={overdue ? 'Storage and backup: a backup is overdue' : 'Storage and backup'}
        aria-label={`Storage and backup: ${pct.toFixed(0)}% used${overdue ? ', a backup is overdue' : ''}`}
        onClick={() => {
          // Opening the details answers a backup toast, which would
          // otherwise sit on top of them.
          if (!open) {
            const toasts = useToastStore.getState()
            for (const t of toasts.toasts) if (t.key === 'backup-reminder' || t.key === 'backup-quota') toasts.dismiss(t.id)
          }
          setOpen(o => !o)
        }}
      >
        <HardDrive size={11} style={{ opacity: 0.7 }} />
        <span className="storage-indicator-bar-bg">
          <span
            className="storage-indicator-bar-fill"
            style={{ width: `${pct}%`, background: color }}
          />
        </span>
        <span className="storage-indicator-label" style={{ color }}>
          {pct.toFixed(0)}%
        </span>
        {overdue && <span className="storage-indicator-due" aria-hidden="true" />}
      </button>
      {open && (
        <div
          ref={popRef}
          className="storage-indicator-tooltip storage-indicator-pop"
          role="dialog"
          aria-label="Storage and backup"
          onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }}
        >
          <span className="storage-indicator-tooltip-header">Browser Storage</span>
          <span className="storage-indicator-tooltip-row">
            <span className="storage-indicator-tooltip-label">Used</span>
            <span>{formatBytes(usage)}</span>
          </span>
          <span className="storage-indicator-tooltip-row">
            <span className="storage-indicator-tooltip-label">Quota</span>
            <span>{formatBytes(quota)}</span>
          </span>
          <span className="storage-indicator-tooltip-row">
            <span className="storage-indicator-tooltip-label">Available</span>
            <span>{formatBytes(Math.max(0, quota - usage))}</span>
          </span>
          {persisted !== null && (
            <span className="storage-indicator-tooltip-row">
              <span className="storage-indicator-tooltip-label">Kept</span>
              {persisted ? (
                <span>Until you clear it</span>
              ) : (
                <span className="storage-indicator-inline">
                  <span className="storage-indicator-warn">May be cleared</span>
                  {canPersist && <button type="button" className="storage-indicator-link" onClick={keepData}>Ask to keep</button>}
                </span>
              )}
            </span>
          )}

          <span className="storage-indicator-tooltip-header storage-indicator-section">Backup</span>
          <span className="storage-indicator-tooltip-row">
            <span className="storage-indicator-tooltip-label">Last backup</span>
            <span>{record.lastBackupAt ? daysAgo(record.lastBackupAt, now) : 'Never'}</span>
          </span>
          {record.firstUnbackedChangeAt !== null && (
            <span className={overdue ? 'storage-indicator-note storage-indicator-warn' : 'storage-indicator-note'}>
              {unbackedNote(record.firstUnbackedChangeAt, now)}
            </span>
          )}
          <label className="storage-indicator-tooltip-row">
            <span className="storage-indicator-tooltip-label">Remind me</span>
            <select
              className="storage-indicator-select"
              value={record.reminderDays}
              onChange={e => setReminderDays(Number(e.target.value) as ReminderDays)}
            >
              {REMINDER_CHOICES.map(c => <option key={c.days} value={c.days}>{c.label}</option>)}
            </select>
          </label>
          {onBackup && (
            <button
              type="button"
              className="btn btn-primary storage-indicator-backup"
              onClick={() => { setOpen(false); onBackup() }}
            >
              Back up now…
            </button>
          )}
        </div>
      )}
    </span>
  )
}
