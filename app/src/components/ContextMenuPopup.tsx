import './ContextMenuPopup.css'
/**
 * The app's context menu frame, with its items and submenus.
 *
 * Opens towards whichever side of the pointer has room, and scrolls instead
 * of running off a short screen. Keyboard: arrows, Home/End and type-ahead
 * move between items, Right/Enter opens a submenu and Left/Escape closes it,
 * Escape closes the menu. The pointer moves the same focus, so the two never
 * disagree about which item is current.
 *
 * Submenus are portalled out of the menu, into the themed app root: the menu
 * scrolls, and its blur and entry animation would otherwise clip and
 * re-anchor a fixed-position child.
 */

import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { useClampedPosition } from '../hooks/useClampedPosition'

const ITEM_SELECTOR = '.ctx-menu-item:not(:disabled)'
const MARGIN = 8
/** Grace period for a diagonal move from a submenu trigger to its flyout. */
const CLOSE_DELAY_MS = 200

interface MenuCtx {
  openId: string | null
  open: (id: string) => void
  scheduleClose: () => void
  cancelClose: () => void
  close: () => void
}
const SubmenuContext = createContext<MenuCtx | null>(null)

/** The items of one menu level, excluding those of any nested level. */
function itemsOf(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(ITEM_SELECTOR)]
    .filter(el => el.closest('.ctx-menu') === container)
}

/** Arrow, Home/End, Tab and type-ahead movement within one menu level. */
function moveFocus(e: React.KeyboardEvent, container: HTMLElement): boolean {
  const items = itemsOf(container)
  if (items.length === 0) return false
  const i = items.indexOf(document.activeElement as HTMLElement)
  let next: HTMLElement | undefined
  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) next = items[(i + 1) % items.length]
  else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) next = items[(i - 1 + items.length) % items.length]
  else if (e.key === 'Home') next = items[0]
  else if (e.key === 'End') next = items[items.length - 1]
  else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const ch = e.key.toLowerCase()
    const label = (el: HTMLElement) => (el.querySelector('.ctx-menu-label')?.textContent ?? el.textContent ?? '').trim().toLowerCase()
    for (let k = 1; k <= items.length; k++) {
      const cand = items[(i + k + items.length) % items.length]
      if (label(cand).startsWith(ch)) { next = cand; break }
    }
  }
  if (!next) return false
  e.preventDefault()
  next.focus({ preventScroll: false })
  return true
}

export default function ContextMenuPopup({ x, y, onClose, label, children }: {
  x: number
  y: number
  /** Escape closes the menu when given. */
  onClose?: () => void
  label?: string
  children: ReactNode
}) {
  const { ref, pos } = useClampedPosition(x, y, { flip: true })
  const el = useRef<HTMLDivElement | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== undefined) { clearTimeout(closeTimer.current); closeTimer.current = undefined }
  }, [])
  const ctx = useMemo<MenuCtx>(() => ({
    openId,
    open: id => { cancelClose(); setOpenId(id) },
    scheduleClose: () => {
      if (closeTimer.current !== undefined) return
      closeTimer.current = setTimeout(() => { closeTimer.current = undefined; setOpenId(null) }, CLOSE_DELAY_MS)
    },
    cancelClose,
    close: () => { cancelClose(); setOpenId(null) },
  }), [openId, cancelClose])
  useEffect(() => cancelClose, [cancelClose])

  // Take focus so the keyboard works at once; hand it back on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    el.current?.focus({ preventScroll: true })
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!el.current) return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose?.(); return }
    moveFocus(e, el.current)
  }

  const onMouseOver = (e: React.MouseEvent) => {
    const item = (e.target as Element).closest<HTMLElement>(ITEM_SELECTOR)
    if (!item || !el.current?.contains(item)) return
    if (document.activeElement !== item) item.focus({ preventScroll: true })
    if (item.dataset.submenu && item.dataset.submenu === openId) ctx.cancelClose()
    else if (openId) ctx.scheduleClose()
  }

  return (
    <SubmenuContext.Provider value={ctx}>
      <div
        ref={node => { el.current = node; ref(node) }}
        className="ctx-menu"
        role="menu"
        aria-label={label}
        tabIndex={-1}
        style={{ position: 'fixed', left: pos.left, top: pos.top }}
        onKeyDown={onKeyDown}
        onMouseOver={onMouseOver}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
        onContextMenu={e => e.preventDefault()}
      >
        {children}
      </div>
    </SubmenuContext.Provider>
  )
}

export function MenuItem({ icon, children, onSelect, danger, shortcut, disabled, title }: {
  icon?: ReactNode
  children: ReactNode
  onSelect: () => void
  danger?: boolean
  /** Shown right-aligned: a key or gesture that does the same thing. */
  shortcut?: string
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      role="menuitem"
      tabIndex={-1}
      className={`ctx-menu-item${danger ? ' ctx-menu-danger' : ''}`}
      onClick={onSelect}
      disabled={disabled}
      title={title}
    >
      <span className="ctx-menu-icon" aria-hidden>{icon}</span>
      <span className="ctx-menu-label">{children}</span>
      {shortcut && <span className="ctx-menu-shortcut">{shortcut}</span>}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="ctx-menu-sep" role="separator" />
}

export function Submenu({ icon, label, children }: {
  icon?: ReactNode
  label: string
  children: ReactNode
}) {
  const ctx = useContext(SubmenuContext)
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const flyoutRef = useRef<HTMLDivElement>(null)
  const focusFirst = useRef(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const open = ctx?.openId === id

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const t = triggerRef.current?.getBoundingClientRect()
    const f = flyoutRef.current?.getBoundingClientRect()
    if (!t || !f) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = t.right - 2
    if (left + f.width > vw - MARGIN) left = Math.max(MARGIN, t.left - f.width + 2)
    const top = Math.max(MARGIN, Math.min(t.top - 4, vh - f.height - MARGIN))
    setPos({ left, top })
  }, [open])

  useEffect(() => {
    if (open && pos && focusFirst.current && flyoutRef.current) {
      focusFirst.current = false
      itemsOf(flyoutRef.current)[0]?.focus({ preventScroll: true })
    }
  }, [open, pos])

  if (!ctx) return null

  const openWithKeyboard = () => { focusFirst.current = true; ctx.open(id) }
  const closeToTrigger = () => { ctx.close(); triggerRef.current?.focus({ preventScroll: true }) }

  return (
    <>
      <button
        ref={triggerRef}
        role="menuitem"
        tabIndex={-1}
        aria-haspopup="menu"
        aria-expanded={open}
        data-submenu={id}
        className={`ctx-menu-item ctx-menu-trigger${open ? ' open' : ''}`}
        onMouseEnter={() => ctx.open(id)}
        onClick={openWithKeyboard}
        onKeyDown={e => {
          if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            openWithKeyboard()
          }
        }}
      >
        <span className="ctx-menu-icon" aria-hidden>{icon}</span>
        <span className="ctx-menu-label">{label}</span>
        <ChevronRight size={13} className="ctx-menu-chevron" aria-hidden />
      </button>
      {open && createPortal(
        <div
          ref={flyoutRef}
          className="ctx-menu ctx-submenu"
          role="menu"
          aria-label={label}
          style={{ position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          onMouseEnter={ctx.cancelClose}
          onMouseOver={e => {
            const item = (e.target as Element).closest<HTMLElement>(ITEM_SELECTOR)
            if (item && document.activeElement !== item) item.focus({ preventScroll: true })
          }}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'ArrowLeft' || e.key === 'Escape') { e.preventDefault(); closeToTrigger(); return }
            if (flyoutRef.current) moveFocus(e, flyoutRef.current)
          }}
          onMouseDown={e => e.stopPropagation()}
          onMouseUp={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
        >
          {children}
        </div>,
        // Inside the themed root: the colour variables are defined there, not on body.
        triggerRef.current?.closest('.app-root') ?? document.body,
      )}
    </>
  )
}
