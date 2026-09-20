/**
 * Piece Table: an efficient text buffer for large sequences.
 *
 * Stores the original text in a read-only "original" buffer and appends
 * all new text to a single "add" buffer. Edits create/split small piece
 * descriptors instead of copying the entire string.
 *
 * Pieces are stored in a balanced order-statistic tree (AVL) keyed by
 * cumulative length, giving O(log n) insert, delete, and positional access
 * where n is the number of pieces (not the sequence length).
 */

type BufferKind = 'original' | 'add'

interface Piece {
  buffer: BufferKind
  start: number   // offset into the buffer
  length: number
}

// AVL tree node for the piece table
interface PTNode {
  piece: Piece
  // subtree size in characters (piece.length + left.size + right.size)
  size: number
  height: number
  left: PTNode | null
  right: PTNode | null
}

function nodeHeight(n: PTNode | null): number {
  return n ? n.height : 0
}

function nodeSize(n: PTNode | null): number {
  return n ? n.size : 0
}

function updateNode(n: PTNode): void {
  n.height = 1 + Math.max(nodeHeight(n.left), nodeHeight(n.right))
  n.size = n.piece.length + nodeSize(n.left) + nodeSize(n.right)
}

function balanceFactor(n: PTNode): number {
  return nodeHeight(n.left) - nodeHeight(n.right)
}

function rotateRight(n: PTNode): PTNode {
  const l = n.left!
  n.left = l.right
  l.right = n
  updateNode(n)
  updateNode(l)
  return l
}

function rotateLeft(n: PTNode): PTNode {
  const r = n.right!
  n.right = r.left
  r.left = n
  updateNode(n)
  updateNode(r)
  return r
}

function balance(n: PTNode): PTNode {
  updateNode(n)
  const bf = balanceFactor(n)
  if (bf > 1) {
    if (balanceFactor(n.left!) < 0) {
      n.left = rotateLeft(n.left!)
    }
    return rotateRight(n)
  }
  if (bf < -1) {
    if (balanceFactor(n.right!) > 0) {
      n.right = rotateRight(n.right!)
    }
    return rotateLeft(n)
  }
  return n
}

function makeNode(piece: Piece): PTNode {
  return { piece, size: piece.length, height: 1, left: null, right: null }
}

/**
 * Insert a new piece at character offset `pos` within the subtree rooted at `node`.
 * If `pos` falls in the middle of an existing piece, that piece is split.
 */
function insertAt(node: PTNode | null, pos: number, piece: Piece): PTNode {
  if (!node) {
    return makeNode(piece)
  }

  const leftSize = nodeSize(node.left)

  if (pos <= leftSize) {
    // Insert into left subtree
    node.left = insertAt(node.left, pos, piece)
  } else if (pos >= leftSize + node.piece.length) {
    // Insert into right subtree
    node.right = insertAt(node.right, pos - leftSize - node.piece.length, piece)
  } else {
    // pos falls inside this node's piece - split it
    const offset = pos - leftSize
    const leftPiece: Piece = {
      buffer: node.piece.buffer,
      start: node.piece.start,
      length: offset,
    }
    const rightPiece: Piece = {
      buffer: node.piece.buffer,
      start: node.piece.start + offset,
      length: node.piece.length - offset,
    }

    // Replace current node with leftPiece, insert `piece` after it,
    // then insert rightPiece after that.
    node.piece = leftPiece
    // Insert the new piece into the right subtree at position 0
    node.right = insertAt(node.right, 0, rightPiece)
    node.right = insertAt(node.right, 0, piece)
  }

  return balance(node)
}

/**
 * Delete characters in [start, start+count) from the subtree.
 */
function deleteRange(node: PTNode | null, start: number, count: number): PTNode | null {
  if (!node || count <= 0) return node

  const leftSize = nodeSize(node.left)
  const pieceLen = node.piece.length
  const rightStart = leftSize + pieceLen

  // Deletion entirely in left subtree
  if (start + count <= leftSize) {
    node.left = deleteRange(node.left, start, count)
    return balance(node)
  }

  // Deletion entirely in right subtree
  if (start >= rightStart) {
    node.right = deleteRange(node.right, start - rightStart, count)
    return balance(node)
  }

  // Deletion overlaps this node's piece (and possibly left/right subtrees)
  let remaining = count

  // Part in left subtree
  if (start < leftSize) {
    const leftDel = leftSize - start
    node.left = deleteRange(node.left, start, leftDel)
    remaining -= leftDel
    // After deleting from left, leftSize has changed; recalculate
    // start is now effectively at the beginning of this node's piece
  }

  // Recalculate leftSize after potential left deletion
  const newLeftSize = nodeSize(node.left)
  const pieceStart = Math.max(0, start - newLeftSize)

  // Part in this node's piece
  if (pieceStart < node.piece.length && remaining > 0) {
    const delInPiece = Math.min(remaining, node.piece.length - pieceStart)

    if (pieceStart === 0 && delInPiece === node.piece.length) {
      // Entire piece deleted - remove this node
      remaining -= delInPiece
      const merged = merge(node.left, node.right)
      if (remaining > 0 && merged) {
        return deleteRange(merged, nodeSize(merged) - nodeSize(node.right), remaining)
      }
      return merged
    } else if (pieceStart === 0) {
      // Delete from start of piece
      node.piece = {
        buffer: node.piece.buffer,
        start: node.piece.start + delInPiece,
        length: node.piece.length - delInPiece,
      }
      remaining -= delInPiece
    } else if (pieceStart + delInPiece === node.piece.length) {
      // Delete from end of piece
      node.piece = {
        buffer: node.piece.buffer,
        start: node.piece.start,
        length: pieceStart,
      }
      remaining -= delInPiece
    } else {
      // Delete from middle - split piece
      const rightPiece: Piece = {
        buffer: node.piece.buffer,
        start: node.piece.start + pieceStart + delInPiece,
        length: node.piece.length - pieceStart - delInPiece,
      }
      node.piece = {
        buffer: node.piece.buffer,
        start: node.piece.start,
        length: pieceStart,
      }
      node.right = insertAt(node.right, 0, rightPiece)
      remaining -= delInPiece
    }
  }

  // Part in right subtree
  if (remaining > 0) {
    node.right = deleteRange(node.right, 0, remaining)
  }

  return balance(node)
}

/** Merge two subtrees (used when removing a node). */
function merge(left: PTNode | null, right: PTNode | null): PTNode | null {
  if (!left) return right
  if (!right) return left

  // Find the rightmost node of the left subtree, make it the root
  if (nodeHeight(left) >= nodeHeight(right)) {
    const [newLeft, rightmost] = extractMax(left)
    rightmost.left = newLeft
    rightmost.right = right
    return balance(rightmost)
  } else {
    const [newRight, leftmost] = extractMin(right)
    leftmost.left = left
    leftmost.right = newRight
    return balance(leftmost)
  }
}

function extractMax(node: PTNode): [PTNode | null, PTNode] {
  if (!node.right) {
    return [node.left, { ...node, left: null, right: null, height: 1, size: node.piece.length }]
  }
  const [newRight, max] = extractMax(node.right)
  node.right = newRight
  return [balance(node), max]
}

function extractMin(node: PTNode): [PTNode | null, PTNode] {
  if (!node.left) {
    return [node.right, { ...node, left: null, right: null, height: 1, size: node.piece.length }]
  }
  const [newLeft, min] = extractMin(node.left)
  node.left = newLeft
  return [balance(node), min]
}

/**
 * Collect text from the tree into a string builder (array of strings).
 * For extracting a range [start, end), pass offset tracking.
 */
function collectAll(node: PTNode | null, original: string, add: string, out: string[]): void {
  if (!node) return
  collectAll(node.left, original, add, out)
  const buf = node.piece.buffer === 'original' ? original : add
  out.push(buf.slice(node.piece.start, node.piece.start + node.piece.length))
  collectAll(node.right, original, add, out)
}

/**
 * Extract a substring [start, end) from the tree.
 */
function collectRange(
  node: PTNode | null,
  start: number,
  end: number,
  original: string,
  add: string,
  out: string[],
): void {
  if (!node || start >= end) return

  const leftSize = nodeSize(node.left)
  const pieceEnd = leftSize + node.piece.length

  // Recurse into left subtree if range overlaps
  if (start < leftSize) {
    collectRange(node.left, start, Math.min(end, leftSize), original, add, out)
  }

  // Collect from this node's piece
  if (start < pieceEnd && end > leftSize) {
    const pieceOffset = Math.max(0, start - leftSize)
    const pieceLimit = Math.min(node.piece.length, end - leftSize)
    const buf = node.piece.buffer === 'original' ? original : add
    out.push(buf.slice(node.piece.start + pieceOffset, node.piece.start + pieceLimit))
  }

  // Recurse into right subtree if range overlaps
  if (end > pieceEnd) {
    collectRange(node.right, start - pieceEnd, end - pieceEnd, original, add, out)
  }
}

/**
 * Get a single character at position `pos`.
 */
function charAt(node: PTNode | null, pos: number, original: string, add: string): string {
  if (!node) return ''
  const leftSize = nodeSize(node.left)
  if (pos < leftSize) {
    return charAt(node.left, pos, original, add)
  }
  const offset = pos - leftSize
  if (offset < node.piece.length) {
    const buf = node.piece.buffer === 'original' ? original : add
    return buf[node.piece.start + offset]
  }
  return charAt(node.right, offset - node.piece.length, original, add)
}

// ============================================================================
// Public API
// ============================================================================

export class PieceTable {
  private readonly _original: string
  private _add: string
  private _root: PTNode | null
  /** Monotonically increasing version – bumped on every mutation. */
  private _version = 0

  constructor(text: string = '') {
    this._original = text
    this._add = ''
    if (text.length > 0) {
      this._root = makeNode({ buffer: 'original', start: 0, length: text.length })
    } else {
      this._root = null
    }
  }

  /** Current mutation version (increases on insert/delete/restore). */
  get version(): number { return this._version }

  /** The immutable original buffer. */
  get originalBuffer(): string { return this._original }

  /** The append-only add buffer. */
  get addBuffer(): string { return this._add }

  /** Reconstruct a PieceTable from saved buffers and tree snapshot. */
  static fromBuffers(original: string, add: string, snap: PieceTableSnapshot): PieceTable {
    const pt = Object.create(PieceTable.prototype) as PieceTable
    Object.defineProperty(pt, '_original', { value: original, writable: false })
    ;(pt as any)._add = add
    ;(pt as any)._root = snap.root ? cloneTree(snap.root) : null
    ;(pt as any)._version = 0
    return pt
  }

  get length(): number {
    return nodeSize(this._root)
  }

  /** Insert `text` at position `pos`. O(log n) in number of pieces. */
  insert(pos: number, text: string): void {
    if (text.length === 0) return
    if (pos < 0 || pos > this.length) {
      throw new RangeError(`Insert position ${pos} out of bounds [0, ${this.length}]`)
    }
    const piece: Piece = {
      buffer: 'add',
      start: this._add.length,
      length: text.length,
    }
    this._add += text
    this._root = insertAt(this._root, pos, piece)
    this._version++
  }

  /** Delete `count` characters starting at `pos`. O(log n) in number of pieces. */
  delete(pos: number, count: number): void {
    if (count === 0) return
    if (pos < 0 || pos + count > this.length) {
      throw new RangeError(
        `Delete range [${pos}, ${pos + count}) out of bounds for length ${this.length}`,
      )
    }
    this._root = deleteRange(this._root, pos, count)
    this._version++
  }

  /** Get character at position. O(log n). */
  charAt(pos: number): string {
    if (pos < 0 || pos >= this.length) return ''
    return charAt(this._root, pos, this._original, this._add)
  }

  /** Extract substring [start, end). O(log n + k) where k is output length. */
  substring(start: number, end: number): string {
    if (start < 0) start = 0
    if (end > this.length) end = this.length
    if (start >= end) return ''
    const out: string[] = []
    collectRange(this._root, start, end, this._original, this._add, out)
    return out.join('')
  }

  /** Materialize the full string. O(n). Use sparingly on large sequences. */
  toString(): string {
    const out: string[] = []
    collectAll(this._root, this._original, this._add, out)
    return out.join('')
  }

  /** Create a snapshot for undo - stores the tree structure, not the full string. */
  snapshot(): PieceTableSnapshot {
    return {
      root: cloneTree(this._root),
      addLength: this._add.length,
    }
  }

  /** Restore from a snapshot. O(1) - just swaps the tree pointer. */
  restoreSnapshot(snap: PieceTableSnapshot): void {
    this._root = cloneTree(snap.root)
    this._version++
    // The add buffer only grows; we don't truncate it (old pieces may reference it).
    // But we don't need to do anything - the snapshot's pieces reference valid ranges.
  }
}

export interface PieceTableSnapshot {
  root: PTNode | null
  addLength: number
}

/** Deep-clone a tree (pieces are immutable, so we only clone node structure). */
function cloneTree(node: PTNode | null): PTNode | null {
  if (!node) return null
  return {
    piece: node.piece, // pieces are immutable value objects
    size: node.size,
    height: node.height,
    left: cloneTree(node.left),
    right: cloneTree(node.right),
  }
}
