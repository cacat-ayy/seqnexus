/**
 * Copy text to the clipboard and tell the user what happened.
 *
 * Was hand-rolled at roughly eighteen call sites across the sequence view,
 * plasmid map, chromatogram, primer and feature panels, every one of them
 * shaped like:
 *
 *   navigator.clipboard.writeText(t)
 *     .then(() => onCopyFeedback?.('Copied …'))
 *     .catch(e => console.warn('Clipboard write failed:', e))
 *
 * which means a failure produced nothing at all: no success toast, because the
 * promise rejected, and no error either. The user sees an unchanged screen and
 * reasonably assumes the copy worked. Clipboard writes do fail in practice:
 * a page served over plain http, a denied permission, or a call that lost the
 * browser's user-gesture requirement.
 *
 * Feedback goes through `notify` directly, which is also why the components
 * above no longer need an `onCopyFeedback` prop threaded down from App.
 */

import { notify } from '../toast'

/**
 * Copy `text`, reporting success or failure. Resolves to whether it worked.
 *
 * `successMessage` should already read as a finished outcome, e.g.
 * `Copied 240 bp` or `Copied 3 features`. Omit it where the caller shows its
 * own inline confirmation, such as the primer list's tick: a toast on top of
 * that would say the same thing twice. Failures are always reported, because
 * no caller has an inline way to say "that did not work".
 */
export async function copyText(text: string, successMessage?: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(text)
    // Short, and keyed: rapid repeat copies should refresh one toast rather
    // than stack three identical ones.
    if (successMessage) notify.success(successMessage, { duration: 2000, key: 'clipboard' })
    return true
  } catch (err) {
    notify.error('Could not copy to clipboard', {
      detail: window.isSecureContext
        ? 'Your browser blocked clipboard access for this page.'
        : 'Clipboard access needs a secure (https) connection.',
      key: 'clipboard',
    })
    console.warn('Clipboard write failed:', err)
    return false
  }
}

/**
 * Read text from the clipboard, reporting failure.
 *
 * Returns null rather than throwing, so callers can simply bail out.
 */
export async function readText(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) throw new Error('Clipboard API unavailable')
    return await navigator.clipboard.readText()
  } catch (err) {
    notify.error('Could not read the clipboard', {
      detail: window.isSecureContext
        ? 'Your browser blocked clipboard access for this page.'
        : 'Clipboard access needs a secure (https) connection.',
      key: 'clipboard',
    })
    console.warn('Clipboard read failed:', err)
    return null
  }
}
