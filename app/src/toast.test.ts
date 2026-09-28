import { describe, it, expect, beforeEach } from 'vitest'
import { notify, useToastStore, MAX_VISIBLE } from './toast'

const toasts = () => useToastStore.getState().toasts

describe('toast store', () => {
  beforeEach(() => {
    useToastStore.getState().clear()
  })

  it('defaults duration per severity, and never auto-dismisses errors', () => {
    notify.success('a')
    notify.info('b')
    notify.warning('c')
    useToastStore.getState().clear()
    notify.error('d')

    // Checked one at a time so the visible cap does not evict anything.
    expect(toasts()[0].duration).toBe(0)

    useToastStore.getState().clear()
    notify.success('a')
    expect(toasts()[0].duration).toBe(3000)
  })

  it('honours an explicit duration override', () => {
    notify.success('copied', { duration: 2000 })
    expect(toasts()[0].duration).toBe(2000)
  })

  it('carries detail and action through', () => {
    let ran = false
    notify.error('failed', { detail: 'because', action: { label: 'Undo', onClick: () => { ran = true } } })
    const t = toasts()[0]
    expect(t.detail).toBe('because')
    t.action!.onClick()
    expect(ran).toBe(true)
  })

  it('replaces rather than stacks when a key repeats', () => {
    notify.error('Session save failed', { key: 'save' })
    notify.error('Storage quota exceeded', { key: 'save' })

    expect(toasts()).toHaveLength(1)
    expect(toasts()[0].message).toBe('Storage quota exceeded')
  })

  it('keeps a keyed toast in place rather than moving it to the end', () => {
    notify.error('first', { key: 'save' })
    notify.info('second')
    notify.error('first again', { key: 'save' })

    expect(toasts().map(t => t.message)).toEqual(['first again', 'second'])
  })

  it('caps the visible stack, evicting the oldest dismissable toast', () => {
    for (let i = 1; i <= MAX_VISIBLE + 1; i++) notify.success(`s${i}`)

    expect(toasts()).toHaveLength(MAX_VISIBLE)
    expect(toasts().map(t => t.message)).toEqual(['s2', 's3', 's4'])
  })

  it('never evicts a sticky error to make room for a confirmation', () => {
    notify.error('save failed')
    for (let i = 1; i <= MAX_VISIBLE; i++) notify.success(`s${i}`)

    const messages = toasts().map(t => t.message)
    expect(messages).toContain('save failed')
    expect(toasts()).toHaveLength(MAX_VISIBLE)
  })

  it('never drops the toast being added to stay under the cap', () => {
    // A screen full of sticky errors must not swallow the confirmation for
    // whatever the user just did: that is the silent-action bug all over again.
    for (let i = 1; i <= MAX_VISIBLE; i++) notify.error(`e${i}`)
    notify.success('Copied 240 bp')

    expect(toasts().map(t => t.message)).toContain('Copied 240 bp')
  })

  it('lets the stack grow past the cap when every toast is an error', () => {
    // Nothing is safe to drop, so growing beats silently losing an error.
    for (let i = 1; i <= MAX_VISIBLE + 2; i++) notify.error(`e${i}`)
    expect(toasts()).toHaveLength(MAX_VISIBLE + 2)
  })

  it('dismisses by id', () => {
    const id = notify.info('hello')
    notify.info('other')
    notify.dismiss(id)

    expect(toasts().map(t => t.message)).toEqual(['other'])
  })

  it('ignores a dismiss for an id that is already gone', () => {
    const id = notify.info('hello')
    notify.dismiss(id)
    notify.dismiss(id)
    expect(toasts()).toHaveLength(0)
  })
})
