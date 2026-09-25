/**
 * Command palette (Ctrl/Cmd+K).
 *
 * Every tool in the app is reachable from here, which matters because the
 * toolbar holds ~18 controls at once and had no overflow story — on a narrow
 * window it simply wrapped onto a second row and pushed the canvas down.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Search } from 'lucide-react'
import { searchCommands, type Command, type ScoredCommand } from '../commands'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import './CommandPalette.css'

interface Props {
  open: boolean
  onClose: () => void
  commands: Command[]
}

/** Split a label into matched/unmatched runs so hits can be emphasised. */
function highlight(label: string, hits: number[]) {
  if (hits.length === 0) return label
  const hitSet = new Set(hits)
  const parts: React.ReactNode[] = []
  let run = ''
  let runIsHit = hitSet.has(0)

  for (let i = 0; i < label.length; i++) {
    const isHit = hitSet.has(i)
    if (isHit !== runIsHit) {
      parts.push(runIsHit ? <mark key={i} className="cp-hit">{run}</mark> : run)
      run = ''
      runIsHit = isHit
    }
    run += label[i]
  }
  parts.push(runIsHit ? <mark key="last" className="cp-hit">{run}</mark> : run)
  return parts
}

export default function CommandPalette({ open, onClose, commands }: Props) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const backdropRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useFocusTrap(backdropRef, open)
  const { visible, closing, onAnimationEnd } = useExitAnimation(open)

  const results = useMemo(() => searchCommands(commands, query), [commands, query])

  // The first selectable row, skipping disabled entries.
  const firstEnabled = useMemo(
    () => results.findIndex(r => !r.command.disabled),
    [results],
  )

  // Reset each time the palette is summoned, and whenever the query changes:
  // keeping a stale selection makes Enter unpredictable.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
    }
  }, [open])

  useEffect(() => {
    setActiveIndex(firstEnabled === -1 ? 0 : firstEnabled)
  }, [query, firstEnabled])

  // Focus as soon as the input exists. Deferring this to a rAF leaves a frame
  // in which keystrokes land on <body> and are lost — long enough to swallow
  // the first character when the palette is opened mid-typing. preventScroll
  // covers what the deferral was guarding against.
  useEffect(() => {
    if (!visible || closing) return
    inputRef.current?.focus({ preventScroll: true })
  }, [visible, closing])

  // Keep the active row in view during keyboard navigation. Guarded because
  // scrollIntoView is not implemented in jsdom, and a missing scroll should
  // never be able to break navigation itself.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  const runCommand = useCallback((entry: ScoredCommand | undefined) => {
    if (!entry || entry.command.disabled) return
    onClose()
    entry.command.run()
  }, [onClose])

  /** Move the selection, skipping disabled rows and wrapping at both ends. */
  const move = useCallback((delta: 1 | -1) => {
    setActiveIndex(current => {
      if (results.length === 0) return current
      let next = current
      for (let step = 0; step < results.length; step++) {
        next = (next + delta + results.length) % results.length
        if (!results[next].command.disabled) return next
      }
      return current
    })
  }, [results])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.stopPropagation()
        onClose()
        break
      case 'ArrowDown':
        e.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(-1)
        break
      case 'Enter':
        e.preventDefault()
        runCommand(results[activeIndex])
        break
    }
  }, [onClose, move, runCommand, results, activeIndex])

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  if (!visible) return null

  // Group headings are emitted inline as the list is walked, so the rendered
  // order always matches the ranked order rather than a fixed group order.
  let lastGroup: string | null = null

  return (
    <div
      ref={backdropRef}
      className={closing ? 'modal-backdrop cp-backdrop closing' : 'modal-backdrop cp-backdrop'}
      onAnimationEnd={onAnimationEnd}
      onClick={handleBackdrop}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="modal-dialog cp-dialog" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cp-search">
          <Search size={15} className="cp-search-icon" />
          <input
            ref={inputRef}
            className="cp-input"
            type="text"
            placeholder="Search commands…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="cp-list"
            aria-activedescendant={results[activeIndex] ? `cp-opt-${results[activeIndex].command.id}` : undefined}
            aria-autocomplete="list"
          />
        </div>

        <div className="cp-list" id="cp-list" role="listbox" ref={listRef} aria-label="Commands">
          {results.length === 0 && (
            <div className="cp-empty">No matching command</div>
          )}

          {results.map((entry, index) => {
            const { command, hits } = entry
            const Icon = command.icon
            const header = command.group !== lastGroup ? command.group : null
            lastGroup = command.group

            return (
              <div key={command.id}>
                {header && <div className="cp-group">{header}</div>}
                <div
                  id={`cp-opt-${command.id}`}
                  className={`cp-row${index === activeIndex ? ' active' : ''}${command.disabled ? ' disabled' : ''}`}
                  data-active={index === activeIndex}
                  role="option"
                  aria-selected={index === activeIndex}
                  aria-disabled={command.disabled}
                  onMouseMove={() => { if (!command.disabled) setActiveIndex(index) }}
                  onClick={() => runCommand(entry)}
                >
                  <span className="cp-row-icon">{Icon && <Icon size={14} />}</span>
                  <span className="cp-row-label">{highlight(command.label, hits)}</span>
                  {command.shortcut && <kbd className="cp-row-kbd">{command.shortcut}</kbd>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="cp-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
