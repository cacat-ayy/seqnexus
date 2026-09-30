import './HoverCard.css'
/**
 * The frame every hover card on the sequence and map is drawn in, and the
 * pinned copy of one.
 *
 * A hover card follows the pointer and ignores it, so its text cannot be
 * selected or copied. Tapping Shift while one is open pins a copy in place:
 * it takes the pointer, stays until Escape, its close button or a click
 * elsewhere, and a second pin replaces it. A tap means Shift pressed and
 * released on its own: Shift-click and Shift-arrow extend the selection and
 * must not pin anything.
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useClampedPosition } from '../hooks/useClampedPosition'

interface PinnedCard {
  /** Identity of what the card describes, so its hover twin can step aside. */
  pinKey: string
  left: number
  top: number
  className: string
  content: ReactNode
}

let pinned: PinnedCard | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

function pinCard(card: PinnedCard): void { pinned = card; emit() }
function unpinCard(): void { if (pinned) { pinned = null; emit() } }

function usePinnedCard(): PinnedCard | null {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => { listeners.delete(l) } },
    () => pinned,
  )
}

export default function HoverCard({ x, y, pinKey, className = 'ft-tooltip', children }: {
  x: number
  y: number
  pinKey: string
  className?: string
  children: ReactNode
}) {
  const { ref, pos } = useClampedPosition(x, y)
  const current = usePinnedCard()
  const latest = useRef({ pinKey, pos, className, children })
  latest.current = { pinKey, pos, className, children }

  useEffect(() => {
    let armed = false
    const down = (e: KeyboardEvent) => {
      armed = e.key === 'Shift' && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey
    }
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || !armed) return
      armed = false
      const l = latest.current
      pinCard({ pinKey: l.pinKey, left: l.pos.left, top: l.pos.top, className: l.className, content: l.children })
    }
    const disarm = () => { armed = false }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('mousedown', disarm, true)
    window.addEventListener('wheel', disarm, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('mousedown', disarm, true)
      window.removeEventListener('wheel', disarm, true)
    }
  }, [])

  // The pinned copy sits exactly here already.
  if (current?.pinKey === pinKey) return null

  return (
    <div
      ref={ref}
      className={className}
      style={{ position: 'fixed', left: pos.left, top: pos.top, pointerEvents: 'none' }}
    >
      {children}
      <div className="hc-hint">Tap <kbd>Shift</kbd> to pin</div>
    </div>
  )
}

/** Mounted once, at the app root. */
export function PinnedCardHost() {
  const card = usePinnedCard()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!card) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') unpinCard() }
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) unpinCard()
    }
    window.addEventListener('keydown', key)
    window.addEventListener('mousedown', down, true)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('mousedown', down, true)
    }
  }, [card])

  if (!card) return null
  return (
    <div
      ref={ref}
      className={`${card.className} hc-pinned`}
      style={{ position: 'fixed', left: card.left, top: card.top }}
      role="dialog"
      aria-label="Pinned details"
    >
      <button className="hc-close" onClick={unpinCard} aria-label="Unpin" title="Unpin (Esc)">
        <X size={12} />
      </button>
      {card.content}
    </div>
  )
}
