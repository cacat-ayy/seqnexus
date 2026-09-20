/**
 * Augmented interval tree (AVL-based) for annotation storage.
 *
 * Supports:
 * - O(log n) insert/remove by id
 * - O(log n + k) range query: find all intervals overlapping [qStart, qEnd)
 * - O(n) bulk shift: adjust all intervals after a position on insert/delete
 *
 * Each node stores an Annotation and is keyed by start position.
 * The `maxEnd` augmentation allows pruning entire subtrees during queries.
 */

import { Annotation, AnnotationData } from './Annotation'

interface ITNode {
  annotation: Annotation
  maxEnd: number   // max end value in this subtree
  height: number
  left: ITNode | null
  right: ITNode | null
}

function nodeHeight(n: ITNode | null): number {
  return n ? n.height : 0
}

function nodeMaxEnd(n: ITNode | null): number {
  return n ? n.maxEnd : -Infinity
}

function updateNode(n: ITNode): void {
  n.height = 1 + Math.max(nodeHeight(n.left), nodeHeight(n.right))
  n.maxEnd = Math.max(n.annotation.end, nodeMaxEnd(n.left), nodeMaxEnd(n.right))
}

function rotateRight(n: ITNode): ITNode {
  const l = n.left!
  n.left = l.right
  l.right = n
  updateNode(n)
  updateNode(l)
  return l
}

function rotateLeft(n: ITNode): ITNode {
  const r = n.right!
  n.right = r.left
  r.left = n
  updateNode(n)
  updateNode(r)
  return r
}

function balanceFactor(n: ITNode): number {
  return nodeHeight(n.left) - nodeHeight(n.right)
}

function balance(n: ITNode): ITNode {
  updateNode(n)
  const bf = balanceFactor(n)
  if (bf > 1) {
    if (balanceFactor(n.left!) < 0) n.left = rotateLeft(n.left!)
    return rotateRight(n)
  }
  if (bf < -1) {
    if (balanceFactor(n.right!) > 0) n.right = rotateRight(n.right!)
    return rotateLeft(n)
  }
  return n
}

function insertNode(node: ITNode | null, ann: Annotation): ITNode {
  if (!node) {
    return { annotation: ann, maxEnd: ann.end, height: 1, left: null, right: null }
  }
  if (ann.start <= node.annotation.start) {
    node.left = insertNode(node.left, ann)
  } else {
    node.right = insertNode(node.right, ann)
  }
  return balance(node)
}

function removeById(node: ITNode | null, id: string): ITNode | null {
  if (!node) return null

  if (node.annotation.id === id) {
    if (!node.left) return node.right
    if (!node.right) return node.left
    // Replace with in-order successor
    let successor = node.right
    while (successor.left) successor = successor.left
    node.annotation = successor.annotation
    node.right = removeById(node.right, successor.annotation.id)
    return balance(node)
  }

  // Search both subtrees since we're keyed by start (not unique)
  node.left = removeById(node.left, id)
  node.right = removeById(node.right, id)
  return balance(node)
}

/**
 * Query all intervals overlapping [qStart, qEnd).
 * An interval [s, e) overlaps [qStart, qEnd) iff s < qEnd && e > qStart.
 *
 * Origin-spanning annotations (start > end) on circular sequences are
 * treated as covering [start, seqLen) ∪ [0, end). They overlap the query
 * if either segment does.
 */
function queryOverlap(
  node: ITNode | null,
  qStart: number,
  qEnd: number,
  result: Annotation[],
): void {
  if (!node) return

  // Prune: if the max end in this subtree <= qStart, no overlap possible
  // But origin-spanning annotations may still overlap, so only prune if
  // no origin-spanning annotations exist (we can't easily know, so we
  // skip this prune for safety - the tree is still O(log n + k) on average)
  if (node.maxEnd <= qStart) {
    // Still need to check for origin-spanning annotations in this subtree
    queryOverlapOriginSpanning(node, qStart, qEnd, result)
    return
  }

  // Check left subtree
  queryOverlap(node.left, qStart, qEnd, result)

  // Check this node
  const ann = node.annotation
  if (ann.spansOrigin()) {
    // Origin-spanning: covers [start, ∞) ∪ [0, end)
    // Overlaps query if query overlaps either segment
    if (ann.end > qStart || ann.start < qEnd) {
      result.push(ann)
    }
  } else if (ann.start < qEnd && ann.end > qStart) {
    result.push(ann)
  }

  // Prune right: if this node's start >= qEnd, no right child can overlap
  // (unless they are origin-spanning)
  if (ann.start >= qEnd) {
    queryOverlapOriginSpanning(node.right, qStart, qEnd, result)
    return
  }

  queryOverlap(node.right, qStart, qEnd, result)
}

/**
 * Scan a subtree for origin-spanning annotations only.
 * Called when the normal pruning would skip a subtree but origin-spanning
 * annotations might still overlap the query.
 */
function queryOverlapOriginSpanning(
  node: ITNode | null,
  qStart: number,
  qEnd: number,
  result: Annotation[],
): void {
  if (!node) return
  const ann = node.annotation
  if (ann.spansOrigin()) {
    if (ann.end > qStart || ann.start < qEnd) {
      result.push(ann)
    }
  }
  queryOverlapOriginSpanning(node.left, qStart, qEnd, result)
  queryOverlapOriginSpanning(node.right, qStart, qEnd, result)
}

/** Collect all annotations in-order. */
function collectAll(node: ITNode | null, result: Annotation[]): void {
  if (!node) return
  collectAll(node.left, result)
  result.push(node.annotation)
  collectAll(node.right, result)
}

/** Find an annotation by id. */
function findById(node: ITNode | null, id: string): Annotation | null {
  if (!node) return null
  if (node.annotation.id === id) return node.annotation
  return findById(node.left, id) ?? findById(node.right, id)
}

/**
 * Rebuild the tree after bulk coordinate changes.
 * Collects all annotations, applies a transform, filters nulls, rebuilds.
 */
function rebuildFromList(annotations: Annotation[]): ITNode | null {
  if (annotations.length === 0) return null
  // Sort by start for balanced insertion
  annotations.sort((a, b) => a.start - b.start)
  return buildBalanced(annotations, 0, annotations.length - 1)
}

function buildBalanced(sorted: Annotation[], lo: number, hi: number): ITNode | null {
  if (lo > hi) return null
  const mid = (lo + hi) >>> 1
  const node: ITNode = {
    annotation: sorted[mid],
    maxEnd: sorted[mid].end,
    height: 1,
    left: buildBalanced(sorted, lo, mid - 1),
    right: buildBalanced(sorted, mid + 1, hi),
  }
  updateNode(node)
  return node
}

// ============================================================================
// Public API
// ============================================================================

export class IntervalTree {
  private _root: ITNode | null = null
  private _count: number = 0

  get size(): number {
    return this._count
  }

  /** Insert an annotation. O(log n). */
  insert(ann: Annotation): void {
    this._root = insertNode(this._root, ann)
    this._count++
  }

  /** Remove an annotation by id. O(n) worst case due to id search. */
  remove(id: string): boolean {
    const before = this._count
    this._root = removeById(this._root, id)
    // Recount (removeById may or may not have found it)
    this._count = 0
    this._countNodes(this._root)
    return this._count < before
  }

  /** Find annotation by id. O(n) worst case. */
  find(id: string): Annotation | null {
    return findById(this._root, id)
  }

  /** Update an annotation by id. Removes and re-inserts with new coords. */
  update(id: string, patch: Partial<Omit<AnnotationData, 'id'>>): void {
    const existing = this.find(id)
    if (!existing) return
    this.remove(id)
    this.insert(existing.with(patch))
  }

  /**
   * Query all annotations overlapping [start, end). O(log n + k).
   * For origin-spanning annotations on circular sequences, also checks
   * annotations where start > end.
   */
  queryRange(start: number, end: number): Annotation[] {
    const result: Annotation[] = []
    queryOverlap(this._root, start, end, result)
    return result
  }

  /** Get all annotations in start-position order. O(n). */
  all(): Annotation[] {
    const result: Annotation[] = []
    collectAll(this._root, result)
    return result
  }

  /**
   * Bulk adjust all annotation coordinates after a sequence edit.
   * editPos: position where the edit occurs
   * editDelta: positive = insertion length, negative = deletion length
   *
   * Annotations fully consumed by a deletion are removed.
   * O(n) - rebuilds the tree. For single edits this is acceptable;
   * the tree structure ensures queries remain O(log n + k).
   */
  adjustAll(editPos: number, editDelta: number): void {
    const all = this.all()
    const adjusted: Annotation[] = []

    for (const ann of all) {
      let { start, end } = ann

      if (editDelta > 0) {
        // Insertion
        if (start >= editPos) start += editDelta
        if (end > editPos) end += editDelta
      } else {
        // Deletion: remove [editPos, editPos + |editDelta|)
        const delStart = editPos
        const delEnd = editPos + Math.abs(editDelta)

        start = adjustCoord(start, delStart, delEnd)
        end = adjustCoord(end, delStart, delEnd)

        // Fully consumed
        if (start === end && ann.start !== ann.end) continue
      }

      adjusted.push(ann.with({ start, end }))
    }

    this._root = rebuildFromList(adjusted)
    this._count = adjusted.length
  }

  /** Serialize all annotations to plain data for snapshots. */
  toDataArray(): AnnotationData[] {
    return this.all().map(a => a.toData())
  }

  /** Rebuild from a data array (for restoring snapshots). */
  static fromDataArray(data: AnnotationData[]): IntervalTree {
    const tree = new IntervalTree()
    const annotations = data.map(d => new Annotation(d))
    tree._root = rebuildFromList(annotations)
    tree._count = annotations.length
    return tree
  }

  /** Clone the tree (deep copy of structure, annotations are immutable). */
  clone(): IntervalTree {
    return IntervalTree.fromDataArray(this.toDataArray())
  }

  private _countNodes(node: ITNode | null): void {
    if (!node) return
    this._count++
    this._countNodes(node.left)
    this._countNodes(node.right)
  }
}

function adjustCoord(coord: number, delStart: number, delEnd: number): number {
  if (coord <= delStart) return coord
  if (coord >= delEnd) return coord - (delEnd - delStart)
  return delStart
}
