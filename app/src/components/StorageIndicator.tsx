import './StorageIndicator.css'
/**
 * Small storage usage indicator for the status bar.
 *
 * Shows a color-coded bar (green/yellow/red) with a percentage label.
 * Uses navigator.storage.estimate() for IndexedDB quota/usage.
 * Falls back to estimating localStorage usage if the Storage API is
 * unavailable. Hides entirely if neither source is available.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { HardDrive } from 'lucide-react'
import { estimateStorage } from '../storage/idb'

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

export interface StorageIndicatorProps {
  /** Increment this value to trigger a refresh after saves. */
  refreshKey?: number
}

export default function StorageIndicator({ refreshKey }: StorageIndicatorProps) {
  const [usage, setUsage] = useState<number | null>(null)
  const [quota, setQuota] = useState<number | null>(null)
  const [available, setAvailable] = useState(true)
  const [hover, setHover] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

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

  if (!available || usage === null || quota === null) return null

  const pct = Math.min(100, (usage / quota) * 100)
  const color = barColor(pct)

  return (
    <span
      ref={wrapRef}
      className="storage-indicator"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
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
      {hover && (
        <span className="storage-indicator-tooltip">
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
        </span>
      )}
    </span>
  )
}
