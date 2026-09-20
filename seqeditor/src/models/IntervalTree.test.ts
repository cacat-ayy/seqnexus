import { describe, it, expect } from 'vitest'
import { IntervalTree } from './IntervalTree'
import { Annotation } from './Annotation'

function makeAnn(id: string, start: number, end: number): Annotation {
  return new Annotation({ id, name: id, type: 'CDS', start, end, strand: 1 })
}

describe('IntervalTree', () => {
  it('starts empty', () => {
    const tree = new IntervalTree()
    expect(tree.size).toBe(0)
    expect(tree.all()).toEqual([])
  })

  it('inserts and retrieves annotations', () => {
    const tree = new IntervalTree()
    tree.insert(makeAnn('a', 10, 20))
    tree.insert(makeAnn('b', 30, 40))
    expect(tree.size).toBe(2)
    expect(tree.all().map(a => a.id)).toEqual(['a', 'b'])
  })

  it('removes by id', () => {
    const tree = new IntervalTree()
    tree.insert(makeAnn('a', 10, 20))
    tree.insert(makeAnn('b', 30, 40))
    tree.remove('a')
    expect(tree.size).toBe(1)
    expect(tree.all()[0].id).toBe('b')
  })

  it('finds by id', () => {
    const tree = new IntervalTree()
    tree.insert(makeAnn('a', 10, 20))
    tree.insert(makeAnn('b', 30, 40))
    expect(tree.find('a')?.id).toBe('a')
    expect(tree.find('c')).toBeNull()
  })

  // --- range queries ---
  it('queryRange returns overlapping intervals', () => {
    const tree = new IntervalTree()
    tree.insert(makeAnn('a', 10, 20))
    tree.insert(makeAnn('b', 30, 40))
    tree.insert(makeAnn('c', 15, 35))

    const result = tree.queryRange(18, 32)
    const ids = result.map(a => a.id).sort()
    // a=[10,20) overlaps 18, b=[30,40) overlaps 32, c=[15,35) overlaps both
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('queryRange excludes non-overlapping', () => {
    const tree = new IntervalTree()
    tree.insert(makeAnn('a', 10, 20))
    tree.insert(makeAnn('b', 30, 40))

    expect(tree.queryRange(20, 30).length).toBe(0) // [20,30) doesn't overlap [10,20) or [30,40)
    expect(tree.queryRange(0, 10).length).toBe(0)
    expect(tree.queryRange(40, 50).length).toBe(0)
  })

  it('queryRange handles exact boundaries', () => {
    const tree = new IntervalTree()
    tree.insert(makeAnn('a', 10, 20))

    expect(tree.queryRange(10, 20).length).toBe(1)
    expect(tree.queryRange(19, 21).length).toBe(1)
    expect(tree.queryRange(5, 11).length).toBe(1)
  })

  // --- adjustAll ---
  it('adjustAll shifts annotations on insertion', () => {
    const tree = new IntervalTree()
    tree.insert(makeAnn('a', 10, 20))
    tree.insert(makeAnn('b', 30, 40))

    tree.adjustAll(5, 3) // insert 3 bases at position 5

    const all = tree.all()
    const a = all.find(x => x.id === 'a')!
    const b = all.find(x => x.id === 'b')!
    expect(a.start).toBe(13)
    expect(a.end).toBe(23)
    expect(b.start).toBe(33)
    expect(b.end).toBe(43)
  })

  it('adjustAll shifts annotations on deletion', () => {
    const tree = new IntervalTree()
    tree.insert(makeAnn('a', 10, 20))
    tree.insert(makeAnn('b', 30, 40))

    tree.adjustAll(5, -3) // delete 3 bases at position 5

    const all = tree.all()
    const a = all.find(x => x.id === 'a')!
    const b = all.find(x => x.id === 'b')!
    expect(a.start).toBe(7)
    expect(a.end).toBe(17)
    expect(b.start).toBe(27)
    expect(b.end).toBe(37)
  })

  it('adjustAll removes fully deleted annotations', () => {
    const tree = new IntervalTree()
    tree.insert(makeAnn('a', 10, 20))
    tree.insert(makeAnn('b', 30, 40))

    tree.adjustAll(8, -15) // delete [8, 23) - fully contains 'a'

    expect(tree.size).toBe(1)
    const b = tree.all()[0]
    expect(b.id).toBe('b')
    expect(b.start).toBe(15) // 30 - 15
    expect(b.end).toBe(25)   // 40 - 15
  })

  // --- update ---
  it('updates annotation fields', () => {
    const tree = new IntervalTree()
    tree.insert(makeAnn('a', 10, 20))

    tree.update('a', { name: 'GFP', color: '#00ff00' })

    const a = tree.find('a')!
    expect(a.name).toBe('GFP')
    expect(a.color).toBe('#00ff00')
    expect(a.start).toBe(10)
  })

  // --- clone ---
  it('clone creates independent copy', () => {
    const tree = new IntervalTree()
    tree.insert(makeAnn('a', 10, 20))

    const clone = tree.clone()
    tree.remove('a')

    expect(tree.size).toBe(0)
    expect(clone.size).toBe(1)
    expect(clone.find('a')?.id).toBe('a')
  })

  // --- fromDataArray ---
  it('fromDataArray rebuilds tree', () => {
    const data = [
      { id: 'a', name: 'a', type: 'CDS', start: 10, end: 20, strand: 1 as const },
      { id: 'b', name: 'b', type: 'CDS', start: 30, end: 40, strand: 1 as const },
    ]
    const tree = IntervalTree.fromDataArray(data)
    expect(tree.size).toBe(2)
    expect(tree.queryRange(15, 25).length).toBe(1)
  })

  // --- many annotations ---
  it('handles many annotations', () => {
    const tree = new IntervalTree()
    for (let i = 0; i < 1000; i++) {
      tree.insert(makeAnn(`ann_${i}`, i * 100, i * 100 + 50))
    }
    expect(tree.size).toBe(1000)

    // Query a small range
    const result = tree.queryRange(500, 600)
    expect(result.length).toBeGreaterThan(0)
    for (const ann of result) {
      expect(ann.start).toBeLessThan(600)
      expect(ann.end).toBeGreaterThan(500)
    }
  })
})
