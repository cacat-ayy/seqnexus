import { describe, it, expect, afterEach } from 'vitest'
import { isWidgetKeyTarget } from './key-target'

function mount(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.querySelector<HTMLElement>('[data-target]')!
}

afterEach(() => { document.body.innerHTML = '' })

describe('isWidgetKeyTarget', () => {
  it('leaves keys on the page body to the global listeners', () => {
    expect(isWidgetKeyTarget(document.body)).toBe(false)
    expect(isWidgetKeyTarget(mount('<div><canvas data-target></canvas></div>'))).toBe(false)
  })

  it('claims keys typed into text fields', () => {
    expect(isWidgetKeyTarget(mount('<input data-target>'))).toBe(true)
    expect(isWidgetKeyTarget(mount('<textarea data-target></textarea>'))).toBe(true)
    expect(isWidgetKeyTarget(mount('<select data-target></select>'))).toBe(true)
  })

  // The explorer: arrows, type-ahead and Backspace on a focused row used to
  // move the caret and edit the open sequence too.
  it('claims keys aimed at a row inside the explorer tree', () => {
    const row = mount('<div role="tree"><div role="treeitem" tabindex="0" data-target></div></div>')
    expect(isWidgetKeyTarget(row)).toBe(true)
  })

  it('claims keys inside menus and listboxes', () => {
    expect(isWidgetKeyTarget(mount('<div role="menu"><button data-target></button></div>'))).toBe(true)
    expect(isWidgetKeyTarget(mount('<ul role="listbox"><li data-target></li></ul>'))).toBe(true)
  })

  it('ignores targets that are not elements', () => {
    expect(isWidgetKeyTarget(null)).toBe(false)
    expect(isWidgetKeyTarget(window)).toBe(false)
  })
})
