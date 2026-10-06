/**
 * Where a sample's reads should open next: set by the samples page (a click
 * in the matrix) just before it switches to the reads, taken by the mapping
 * view when it opens that sample.
 */

const pending = new Map<string, { ref: number; pos: number }>()

export function revealOnOpen(storageId: string, ref: number, pos: number): void {
  pending.set(storageId, { ref, pos })
}

export function takeReveal(storageId: string): { ref: number; pos: number } | undefined {
  const r = pending.get(storageId)
  pending.delete(storageId)
  return r
}
