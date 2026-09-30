/**
 * Whether a key event belongs to the element it was aimed at rather than to
 * the app-wide listeners on window/document.
 *
 * The sequence editor and the read/contig views listen globally, so without
 * this every keystroke meant for the explorer tree also moved the caret, and
 * type-ahead or Backspace in the tree edited the sequence.
 *
 * Covers text entry and the ARIA composite widgets, which by definition run
 * their own arrow keys and type-ahead. Modifier shortcuts (Ctrl+K, Ctrl+F)
 * are the caller's call: they are meant to work from anywhere.
 */

const KEY_OWNING_WIDGETS =
  '[role="tree"], [role="listbox"], [role="menu"], [role="grid"], [role="radiogroup"]'

export function isWidgetKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return true
  return target.closest(KEY_OWNING_WIDGETS) !== null
}
