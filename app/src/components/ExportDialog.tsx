import './ExportDialog.css'
/**
 * Lightweight filename prompt for non-sequence exports (gel images, CSVs, etc.).
 */

import { useState, useRef, useEffect, useCallback } from 'react'

interface Props {
  /** Default filename (pre-filled, editable). */
  defaultName: string
  /** Called with the final filename when the user confirms. */
  onConfirm: (filename: string) => void
  /** Called when the user cancels. */
  onCancel: () => void
}

export default function FilenamePrompt({ defaultName, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState(defaultName)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus and select the name part (before the last dot) on mount
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    const dotIdx = defaultName.lastIndexOf('.')
    if (dotIdx > 0) {
      el.setSelectionRange(0, dotIdx)
    } else {
      el.select()
    }
  }, [defaultName])

  const handleConfirm = useCallback(() => {
    const trimmed = value.trim()
    if (trimmed) onConfirm(trimmed)
  }, [value, onConfirm])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleConfirm()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }, [handleConfirm, onCancel])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel()
  }, [onCancel])

  return (
    <div className="export-dialog-backdrop" onClick={handleBackdropClick}>
      <div className="export-dialog" onKeyDown={handleKeyDown}>
        <div className="export-dialog-title">Export filename</div>
        <input
          ref={inputRef}
          className="input export-dialog-input"
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
        />
        <div className="export-dialog-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={!value.trim()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
