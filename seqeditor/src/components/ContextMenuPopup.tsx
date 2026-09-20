import './ContextMenuPopup.css'
import type React from 'react'
import { useClampedPosition } from '../hooks/useClampedPosition'

export default function ContextMenuPopup({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const { ref, pos } = useClampedPosition(x, y)
  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ position: 'fixed', left: pos.left, top: pos.top }}
      onMouseDown={e => e.stopPropagation()}
      onMouseUp={e => e.stopPropagation()}
    >
      {children}
    </div>
  )
}
