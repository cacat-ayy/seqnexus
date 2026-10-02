/**
 * Cloning marks features cut at a junction as truncated. The mark used to
 * vanish as soon as the product became a document, and was never saved.
 */
import { describe, it, expect } from 'vitest'
import { Annotation } from './Annotation'
import { Sequence } from './Sequence'
import { snapshot, restore } from './Document'

describe('truncated features (M12)', () => {
  const ann = new Annotation({ id: 'a', name: 'lacZ', type: 'CDS', start: 0, end: 30, strand: 1, truncated: true })

  it('keep the mark on the annotation, through edits and copies', () => {
    expect(ann.truncated).toBe(true)
    expect(ann.with({ name: 'lacZ part' }).truncated).toBe(true)
    expect(ann.toData().truncated).toBe(true)
  })

  it('keep it through save and restore', () => {
    const doc = { name: 'p', sequence: new Sequence('A'.repeat(40)), annotations: [ann] }
    expect(restore(snapshot(doc)).annotations[0].truncated).toBe(true)
  })

  it('leave whole features unmarked', () => {
    const whole = new Annotation({ id: 'b', name: 'x', type: 'CDS', start: 0, end: 3, strand: 1 })
    expect(whole.truncated).toBeUndefined()
    expect('truncated' in whole.toData()).toBe(false)
  })
})
