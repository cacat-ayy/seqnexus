import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'
import { toUid } from './explorer/types'

const store = () => useEditorStore.getState()
const A = toUid('sequence', 'a')
const B = toUid('read', 'b')

/**
 * Tag colours live in their own map rather than on each item, because
 * recolouring a tag has to change every row at once.
 */
describe('tags', () => {
  beforeEach(() => {
    useEditorStore.setState({ itemMeta: {}, tagColors: {} })
  })

  it('adds a tag and gives it a colour', () => {
    store().addTag(A, 'cloning')
    expect(store().itemMeta[A]?.tags).toEqual(['cloning'])
    expect(store().tagColors.cloning).toMatch(/^#/)
  })

  it('gives two new tags different colours', () => {
    store().addTag(A, 'one')
    store().addTag(A, 'two')
    expect(store().tagColors.one).not.toBe(store().tagColors.two)
  })

  it('reuses the colour when a second item takes an existing tag', () => {
    store().addTag(A, 'cloning')
    const color = store().tagColors.cloning
    store().addTag(B, 'cloning')
    expect(store().tagColors.cloning).toBe(color)
  })

  it('ignores a duplicate and an empty tag', () => {
    store().addTag(A, 'cloning')
    store().addTag(A, 'cloning')
    store().addTag(A, '   ')
    expect(store().itemMeta[A]?.tags).toEqual(['cloning'])
  })

  it('trims whitespace', () => {
    store().addTag(A, '  spaced  ')
    expect(store().itemMeta[A]?.tags).toEqual(['spaced'])
  })

  it('removes a tag, and drops the entry once nothing is left on it', () => {
    store().addTag(A, 'cloning')
    store().removeTag(A, 'cloning')
    expect(store().itemMeta[A]).toBeUndefined()
  })

  it('keeps the star when the last tag is removed', () => {
    store().toggleItemStar(A)
    store().addTag(A, 'cloning')
    store().removeTag(A, 'cloning')
    expect(store().itemMeta[A]).toEqual({ starred: true })
  })

  it('renames a tag across every item carrying it', () => {
    store().addTag(A, 'old')
    store().addTag(B, 'old')
    store().renameTag('old', 'new')

    expect(store().itemMeta[A]?.tags).toEqual(['new'])
    expect(store().itemMeta[B]?.tags).toEqual(['new'])
    expect(store().tagColors.old).toBeUndefined()
    expect(store().tagColors.new).toMatch(/^#/)
  })

  // Renaming onto a tag the item already has must not leave it twice.
  it('merges when renaming onto an existing tag', () => {
    store().addTag(A, 'alpha')
    store().addTag(A, 'beta')
    store().renameTag('alpha', 'beta')
    expect(store().itemMeta[A]?.tags).toEqual(['beta'])
  })

  it('deletes a tag everywhere and forgets its colour', () => {
    store().addTag(A, 'gone')
    store().addTag(A, 'stays')
    store().addTag(B, 'gone')
    store().deleteTag('gone')

    expect(store().itemMeta[A]?.tags).toEqual(['stays'])
    expect(store().itemMeta[B]).toBeUndefined()
    expect(store().tagColors.gone).toBeUndefined()
  })

  it('sets a colour explicitly', () => {
    store().addTag(A, 'cloning')
    store().setTagColor('cloning', '#ff0000')
    expect(store().tagColors.cloning).toBe('#ff0000')
  })
})
