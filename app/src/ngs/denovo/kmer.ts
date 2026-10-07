/**
 * k-mers packed two bits a base, for counting short reads.
 *
 * A k-mer of up to 127 bases is a number of 2k bits held in W = ceil(k / 16)
 * 32-bit words, the first word holding the oldest bases (its unused high bits
 * zero). Reading along a read, the k-mer and its reverse complement are both
 * rolled one base at a time, and the smaller of the two (as numbers) is the
 * canonical k-mer, so a k-mer and its reverse complement count as one.
 *
 * KmerTable counts k-mers in typed arrays with open addressing (linear
 * probing), growing as it fills, so millions of k-mers cost bytes each
 * rather than a JavaScript string and map entry each. A Bloom filter in
 * front of it (BloomFilter) keeps out k-mers seen only once, which in short
 * reads are almost all sequencing errors and most of the distinct k-mers.
 */

export const MAX_K = 127

export const BASE_CODE = new Int8Array(256).fill(-1)
for (const [c, v] of [['A', 0], ['C', 1], ['G', 2], ['T', 3], ['a', 0], ['c', 1], ['g', 2], ['t', 3]] as const) BASE_CODE[c.charCodeAt(0)] = v

export const wordsFor = (k: number) => Math.ceil(k / 16)

/** Rolling forward and reverse-complement k-mers along a sequence. */
export class KmerRoller {
  readonly k: number
  readonly W: number
  readonly fwd: Uint32Array
  readonly rev: Uint32Array
  private readonly topBits: number
  private readonly mask0: number
  private valid = 0

  constructor(k: number) {
    if (k < 1 || k > MAX_K) throw new Error(`k must be 1 to ${MAX_K}`)
    this.k = k
    this.W = wordsFor(k)
    this.fwd = new Uint32Array(this.W)
    this.rev = new Uint32Array(this.W)
    this.topBits = 2 * k - 32 * (this.W - 1)
    this.mask0 = this.topBits === 32 ? 0xffffffff : (1 << this.topBits) - 1
  }

  reset(): void {
    this.valid = 0
    this.fwd.fill(0)
    this.rev.fill(0)
  }

  /** Add a base (code 0-3, or -1 for anything else, which restarts). True once k bases are in. */
  push(code: number): boolean {
    if (code < 0) { this.reset(); return false }
    const f = this.fwd
    const r = this.rev
    const W = this.W
    for (let i = 0; i < W - 1; i++) f[i] = ((f[i] << 2) | (f[i + 1] >>> 30)) >>> 0
    f[W - 1] = ((f[W - 1] << 2) | code) >>> 0
    f[0] = (f[0] & this.mask0) >>> 0
    for (let i = W - 1; i > 0; i--) r[i] = ((r[i] >>> 2) | ((r[i - 1] & 3) << 30)) >>> 0
    r[0] = ((r[0] >>> 2) | ((3 - code) << (this.topBits - 2))) >>> 0
    if (this.valid < this.k) this.valid++
    return this.valid >= this.k
  }

  /** The canonical k-mer of the last k bases: the forward one or its reverse complement, whichever is smaller. */
  canonical(): Uint32Array {
    return compareWords(this.fwd, this.rev) <= 0 ? this.fwd : this.rev
  }

  /** True when the forward k-mer is the canonical one. */
  forwardIsCanonical(): boolean {
    return compareWords(this.fwd, this.rev) <= 0
  }
}

export function compareWords(a: ArrayLike<number>, b: ArrayLike<number>, ao = 0, bo = 0, W = a.length): number {
  for (let i = 0; i < W; i++) {
    const x = a[ao + i]
    const y = b[bo + i]
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** A 32-bit hash of W words (murmur3's finalizer, mixed word by word). */
export function hashWords(w: ArrayLike<number>, o: number, W: number): number {
  let h = 0x9747b28c ^ W
  for (let i = 0; i < W; i++) {
    let x = w[o + i] | 0
    x = Math.imul(x, 0xcc9e2d51)
    x = (x << 15) | (x >>> 17)
    x = Math.imul(x, 0x1b873593)
    h ^= x
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 0xe6546b64) | 0
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** Base `i` (0 = oldest) of a packed k-mer. */
export function baseAt(w: ArrayLike<number>, o: number, k: number, i: number): number {
  const W = wordsFor(k)
  // Bit offset of base i from the least significant end of the whole number.
  const fromEnd = 2 * (k - 1 - i)
  const word = W - 1 - (fromEnd >>> 5)
  return (w[o + word] >>> (fromEnd & 31)) & 3
}

/** A packed k-mer as text. */
export function kmerText(w: ArrayLike<number>, o: number, k: number): string {
  let s = ''
  for (let i = 0; i < k; i++) s += 'ACGT'[baseAt(w, o, k, i)]
  return s
}

/** Pack a k-mer from text (ACGT only). */
export function packKmer(s: string): Uint32Array {
  const r = new KmerRoller(s.length)
  for (let i = 0; i < s.length; i++) r.push(BASE_CODE[s.charCodeAt(i)])
  return Uint32Array.from(r.fwd)
}

/** Reverse complement of a packed k-mer, into `out`. */
export function revcompWords(w: ArrayLike<number>, o: number, k: number, out: Uint32Array): Uint32Array {
  const r = new KmerRoller(k)
  for (let i = k - 1; i >= 0; i--) r.push(3 - baseAt(w, o, k, i))
  out.set(r.fwd)
  return out
}

/** The k-mer shifted one base on, with base `b` appended, into `out`. */
export function shiftAppend(w: ArrayLike<number>, o: number, k: number, b: number, out: Uint32Array): Uint32Array {
  const W = wordsFor(k)
  const topBits = 2 * k - 32 * (W - 1)
  const mask0 = topBits === 32 ? 0xffffffff : (1 << topBits) - 1
  for (let i = 0; i < W - 1; i++) out[i] = ((w[o + i] << 2) | (w[o + i + 1] >>> 30)) >>> 0
  out[W - 1] = ((w[o + W - 1] << 2) | b) >>> 0
  out[0] = (out[0] & mask0) >>> 0
  return out
}

/**
 * A hash scrambled before it is scaled to a slot or block. Callers sample
 * k-mers by the hash's value (only those below a limit, spectrum.ts), and
 * scaling that same value would start every sampled key in the lower part
 * of the table: one long cluster that linear probing crawls through, which
 * made counting quadratic. Multiplying by an odd constant (Knuth's golden
 * ratio) spreads any range of hashes over the whole table.
 */
const spread = (h: number) => Math.imul(h, 0x9e3779b1) >>> 0

/**
 * Counts of canonical k-mers. Slots hold W words of key and a count; a count
 * of 0 is an empty slot. `remove` marks a k-mer gone without breaking the
 * probe chains of the others.
 *
 * The capacity is any number, not a power of two (a key's first slot is its
 * hash scaled to the capacity), so a table sized for a genome's k-mers
 * takes what they need: at 70% full, a 5 Mb genome's k-mers at k 99 take
 * about 250 MB, where rounding up to a power of two would take twice that.
 * Every method takes the key's hash when the caller has it, so a k-mer is
 * hashed once for the Bloom filter and the table.
 */
export class KmerTable {
  readonly k: number
  readonly W: number
  keys: Uint32Array
  counts: Uint32Array
  removed: Uint8Array
  size = 0
  private scale: number

  /** Fullest the table gets before it grows by half. */
  static readonly LOAD = 0.7

  constructor(k: number, capacity = 1 << 16) {
    this.k = k
    this.W = wordsFor(k)
    const cap = Math.max(1024, Math.ceil(capacity))
    this.keys = new Uint32Array(cap * this.W)
    this.counts = new Uint32Array(cap)
    this.removed = new Uint8Array(cap)
    this.scale = cap / 4294967296
  }

  /** A table for about `n` k-mers. */
  static forKmers(k: number, n: number): KmerTable {
    return new KmerTable(k, n / KmerTable.LOAD + 1024)
  }

  get capacity(): number { return this.counts.length }

  /** Slot of a key, or -1. */
  find(key: ArrayLike<number>, o = 0, h = hashWords(key, o, this.W)): number {
    const W = this.W
    const cap = this.counts.length
    let s = Math.floor(spread(h) * this.scale)
    for (;;) {
      if (this.counts[s] === 0) return -1
      if (compareWords(this.keys, key, s * W, o, W) === 0) return s
      if (++s === cap) s = 0
    }
  }

  /** Add `n` to a key's count, or insert it with count `first` (n by default); returns its slot. */
  add(key: ArrayLike<number>, n = 1, o = 0, h = hashWords(key, o, this.W), first = n): number {
    if (this.size + 1 > this.counts.length * KmerTable.LOAD) {
      this.grow()
    }
    const W = this.W
    const cap = this.counts.length
    let s = Math.floor(spread(h) * this.scale)
    for (;;) {
      if (this.counts[s] === 0) {
        for (let i = 0; i < W; i++) this.keys[s * W + i] = key[o + i]
        this.counts[s] = first
        this.size++
        return s
      }
      if (compareWords(this.keys, key, s * W, o, W) === 0) {
        this.counts[s] += n
        return s
      }
      if (++s === cap) s = 0
    }
  }

  /** The count of a key that is present and not removed, else 0. */
  count(key: ArrayLike<number>, o = 0): number {
    const s = this.find(key, o)
    return s < 0 || this.removed[s] ? 0 : this.counts[s]
  }

  remove(slot: number): void { this.removed[slot] = 1 }

  private grow(): void {
    const { keys, counts, removed, W } = this
    const cap = Math.ceil(this.capacity * 1.5)
    this.keys = new Uint32Array(cap * W)
    this.counts = new Uint32Array(cap)
    this.removed = new Uint8Array(cap)
    this.scale = cap / 4294967296
    this.size = 0
    for (let s = 0; s < counts.length; s++) {
      if (counts[s] === 0 || removed[s]) continue
      this.add(keys, counts[s], s * W)
    }
  }

  /** Every present slot. */
  *slots(): Generator<number> {
    for (let s = 0; s < this.counts.length; s++) if (this.counts[s] && !this.removed[s]) yield s
  }
}

/** Bits a Bloom filter block holds: one 64-byte cache line. */
const BLOCK_BITS = 512

/**
 * A Bloom filter over packed k-mers: `seen` says whether a k-mer was added
 * before (with a small chance of a false yes) and adds it.
 *
 * Blocked (Putze, Sanders and Singler 2007): a k-mer's seven bits all lie in
 * one 512-bit block, chosen by its hash, so a lookup touches one cache line
 * instead of seven far apart. That made counting about twice as fast, for a
 * false-positive rate of about 1.5% instead of 1% at the same size: a few
 * more k-mers seen once get into the table, below the solid threshold.
 */
export class BloomFilter {
  private readonly bits: Uint32Array
  private readonly blocks: number
  private readonly hashes = 7

  /** Sized for `n` items, 9.6 bits each. */
  constructor(n: number) {
    this.blocks = Math.max(128, Math.ceil((n * 9.6) / BLOCK_BITS))
    this.bits = new Uint32Array(this.blocks * (BLOCK_BITS / 32))
  }

  get bytes(): number { return this.bits.byteLength }

  seen(key: ArrayLike<number>, o: number, W: number, h1 = hashWords(key, o, W)): boolean {
    const base = Math.floor(spread(h1) * (this.blocks / 4294967296)) * (BLOCK_BITS / 32)
    // Two more hashes from the first, by other finalizer rounds, for the bits in the block.
    let h2 = Math.imul(h1 ^ (h1 >>> 15), 0x2c1b3c6d)
    h2 = (h2 ^ (h2 >>> 12)) >>> 0
    let h3 = Math.imul(h2 ^ (h2 >>> 13), 0x297a2d39)
    h3 = ((h3 ^ (h3 >>> 16)) | 1) >>> 0
    let all = true
    for (let i = 0; i < this.hashes; i++) {
      const b = (h2 + Math.imul(i, h3)) & (BLOCK_BITS - 1)
      const word = base + (b >>> 5)
      const bit = 1 << (b & 31)
      if ((this.bits[word] & bit) === 0) { all = false; this.bits[word] |= bit }
    }
    return all
  }
}
