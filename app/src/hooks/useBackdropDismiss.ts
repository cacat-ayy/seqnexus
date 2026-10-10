import { useCallback, useRef } from 'react'

/**
 * Close a dialog by clicking its backdrop, and only by clicking it.
 *
 * A click is dispatched to the nearest element that holds both the press and
 * the release. Selecting text in a field with the mouse and letting go past
 * the dialog's edge therefore clicked the backdrop, and every dialog that
 * checked only the click's target closed under the user. Here the press has
 * to start on the backdrop too.
 *
 * Spread both handlers on the backdrop element:
 *   const backdrop = useBackdropDismiss(onClose)
 *   <div className="modal-backdrop" {...backdrop}>
 */
export function useBackdropDismiss(onDismiss: () => void): {
  onMouseDown: (e: React.MouseEvent) => void
  onClick: (e: React.MouseEvent) => void
} {
  const pressedOnBackdrop = useRef(false)
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    pressedOnBackdrop.current = e.target === e.currentTarget
  }, [])
  const onClick = useCallback((e: React.MouseEvent) => {
    const fromBackdrop = pressedOnBackdrop.current
    pressedOnBackdrop.current = false
    if (fromBackdrop && e.target === e.currentTarget) onDismiss()
  }, [onDismiss])
  return { onMouseDown, onClick }
}
