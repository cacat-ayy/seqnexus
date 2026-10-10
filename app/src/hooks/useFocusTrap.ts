import { useEffect, useLayoutEffect, useState } from 'react'

/**
 * Confines keyboard focus to an open dialog and restores it on close.
 *
 * Without this, Tab walks straight out of a modal and into the page behind it:
 * a keyboard or screen-reader user ends up operating controls they cannot see,
 * with no way back. `aria-modal` tells assistive tech the rest of the page is
 * inert, but it does not actually stop Tab; that has to be implemented.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

/**
 * Active traps, innermost last. Only the topmost one reacts to Tab, so a
 * confirmation dialog opened on top of another modal does not fight its parent
 * for focus.
 */
const trapStack: HTMLElement[] = []

/**
 * Whether a modal dialog is open. App-wide key handlers (the sequence editor,
 * the workspaces) must stand down while one is: the page behind a modal is
 * meant to be inert, and focus can sit on a dialog's button or backdrop where
 * the text-field checks don't see it.
 */
export function isFocusTrapActive(): boolean {
  return trapStack.length > 0
}

function isVisible(el: HTMLElement): boolean {
  if (el.hidden || el.closest('[hidden]')) return false
  const style = getComputedStyle(el)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

/** Tabbable descendants in document order. Re-queried per keypress so dialogs with changing content stay correct. */
function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible)
}

export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean,
): void {
  // The element, followed render by render. A dialog that keeps itself
  // mounted through its exit animation (useExitAnimation) renders its
  // backdrop one render after `active` turns true, so the ref is still empty
  // when `active` changes; keyed on the ref alone, the trap never started,
  // focus stayed on the button that opened the dialog, and Escape and Tab
  // never reached it.
  const [container, setContainer] = useState<HTMLElement | null>(null)
  // No dependency list on purpose: a ref changing re-renders nothing, so
  // this checks after every render of the dialog. It only sets state when
  // the element changed, so it settles at once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (containerRef.current !== container) setContainer(containerRef.current)
  })

  useEffect(() => {
    if (!active || !container) return

    // Remember where focus came from so it can be handed back on close. Losing
    // this is what makes keyboard users restart navigation from the top of the
    // page every time they dismiss a dialog.
    const previouslyFocused = document.activeElement as HTMLElement | null

    trapStack.push(container)

    // Focus the dialog itself rather than its first control: several modals
    // focus a specific input asynchronously (rAF/setTimeout), and those should
    // win. Focusing a button here could also land the user on a destructive
    // action by default.
    if (!container.contains(document.activeElement)) {
      container.focus({ preventScroll: true })
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if (trapStack[trapStack.length - 1] !== container) return

      const items = focusables(container)
      if (items.length === 0) {
        // Nothing to move to: keep focus on the dialog rather than letting it
        // escape to the page behind.
        e.preventDefault()
        container.focus({ preventScroll: true })
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      const activeEl = document.activeElement as HTMLElement | null

      // Focus sitting on the container (or somehow outside): pull it to an end.
      if (!activeEl || activeEl === container || !container.contains(activeEl)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }

      if (e.shiftKey && activeEl === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const i = trapStack.lastIndexOf(container)
      if (i !== -1) trapStack.splice(i, 1)

      // Only restore if the origin is still in the document: it may have been
      // unmounted while the dialog was open.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [container, active])
}
