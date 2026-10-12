import { describe, it, expect } from 'vitest'
import { droppedFiles } from './dropped'

const fileEntry = (name: string) => ({
  isFile: true, isDirectory: false, name,
  file: (ok: (f: File) => void) => ok(new File(['x'], name)),
})
const dirEntry = (name: string, children: unknown[]) => ({
  isFile: false, isDirectory: true, name,
  createReader: () => {
    // Entries come in batches; an empty batch ends the listing.
    const batches = [children.slice(0, 1), children.slice(1), []]
    return { readEntries: (ok: (e: unknown[]) => void) => ok(batches.shift() ?? []) }
  },
})
const item = (entry: unknown) => ({ kind: 'file', webkitGetAsEntry: () => entry })

describe('droppedFiles', () => {
  it('walks dropped folders, keeping each file path inside them', async () => {
    const dt = {
      items: [
        item(dirEntry('Plate', [fileEntry('a.ab1'), dirEntry('sub', [fileEntry('b.gb')])])),
        item(fileEntry('top.fasta')),
      ],
      files: [],
    } as unknown as DataTransfer
    const { files, paths } = await droppedFiles(dt)
    expect(files.map(f => f.name)).toEqual(['a.ab1', 'b.gb', 'top.fasta'])
    expect(files.map(f => paths.get(f))).toEqual(['Plate/a.ab1', 'Plate/sub/b.gb', undefined])
  })

  it('takes the plain file list when nothing dropped is a folder', async () => {
    const plain = new File(['x'], 'p.fasta')
    const dt = { items: [item(fileEntry('p.fasta'))], files: [plain] } as unknown as DataTransfer
    const { files, paths } = await droppedFiles(dt)
    expect(files).toEqual([plain])
    expect(paths.size).toBe(0)
  })
})
