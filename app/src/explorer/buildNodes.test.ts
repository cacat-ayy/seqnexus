import { describe, it, expect } from 'vitest'
import type { ExplorerFolder } from '../store'
import {
  buildNodes, FAVORITES_KEY, UNGROUPED_KEY, UNTAGGED_KEY, type ExplorerNode,
} from './buildNodes'
import type { ExplorerItem, GroupBy, ItemKind, SortBy, SortDir } from './types'
import { toUid } from './types'

function item(
  kind: ItemKind, id: string, name: string, over: Partial<ExplorerItem> = {},
): ExplorerItem {
  return {
    uid: toUid(kind, id), kind, id, name,
    createdAt: 0, size: 0, isOpen: false, isIncluded: false, isDirty: false,
    isReadOnly: false, isCircular: false, canDuplicate: kind === 'sequence',
    stats: [], badges: [], derivedFrom: [],
    ...over,
  }
}

const empty = { sequence: [], read: [], alignment: [], 'read-alignment': [], contig: [], gel: [], oligo: [] }

/** A folder with the fields a test does not care about filled in. */
function folder(over: Partial<ExplorerFolder> & { id: string }): ExplorerFolder {
  return { name: over.id, itemUids: [], parentId: null, collapsed: false, ...over }
}

function build(over: {
  byKind?: Partial<Record<ItemKind, ExplorerItem[]>>
  folders?: ExplorerFolder[]
  starred?: string[]
  tags?: Record<string, string[]>
  collapsed?: string[]
  query?: string
  groupBy?: GroupBy
  sortBy?: SortBy
  sortDir?: SortDir
  nestDerived?: boolean
  filter?: (i: ExplorerItem) => boolean
  now?: number
} = {}) {
  return buildNodes({
    byKind: { ...empty, ...over.byKind },
    folders: over.folders ?? [],
    starred: new Set(over.starred ?? []),
    tagsByUid: over.tags ?? {},
    collapsedGroups: new Set(over.collapsed ?? []),
    query: over.query ?? '',
    groupBy: over.groupBy ?? 'type',
    sortBy: over.sortBy ?? 'name',
    sortDir: over.sortDir ?? 'asc',
    nestDerived: over.nestDerived,
    filter: over.filter,
  }, over.now)
}

const groups = (nodes: ExplorerNode[]) => nodes.filter(n => n.type === 'group').map(n => n.key)
const uids = (nodes: ExplorerNode[]) => nodes.filter(n => n.type === 'item').map(n => n.type === 'item' ? n.item.uid : '')

describe('buildNodes group order and visibility', () => {
  // Sequences and Sequencing are where work starts, so their headers stay as
  // a place to drop things. The derived kinds only appear once they exist.
  it('always shows sequences and sequencing, even when empty', () => {
    expect(groups(build().nodes)).toEqual(['sequence', 'read'])
  })

  it('shows a derived kind only when it has items', () => {
    const { nodes } = build({ byKind: { contig: [item('contig', 'c1', 'Assembly')] } })
    expect(groups(nodes)).toEqual(['sequence', 'read', 'contig'])
  })

  it('orders groups by kind, not by insertion', () => {
    const { nodes } = build({
      byKind: {
        contig: [item('contig', 'c1', 'c')],
        alignment: [item('alignment', 'a1', 'a')],
        sequence: [item('sequence', 't1', 's')],
      },
    })
    expect(groups(nodes)).toEqual(['sequence', 'read', 'alignment', 'contig'])
  })

  it('puts an empty-state row under an empty group', () => {
    const { nodes } = build()
    const messages = nodes.filter(n => n.type === 'empty').map(n => n.type === 'empty' ? n.message : '')
    expect(messages).toEqual(['No sequences open', 'No sequencing reads imported'])
  })

  it('hides a collapsed group\'s children but keeps its header and count', () => {
    const { nodes } = build({
      byKind: { sequence: [item('sequence', 't1', 'one')] },
      collapsed: ['sequence'],
    })
    const header = nodes.find(n => n.type === 'group' && n.key === 'sequence')
    expect(header && header.type === 'group' && header.count).toBe(1)
    expect(uids(nodes)).toEqual([])
  })
})

describe('buildNodes favorites', () => {
  const seq = item('sequence', 't1', 'plasmid')
  const read = item('read', 'r1', 'trace')

  it('pins a favorites group above everything, spanning kinds', () => {
    const { nodes } = build({
      byKind: { sequence: [seq], read: [read] },
      starred: [seq.uid, read.uid],
    })
    expect(groups(nodes)[0]).toBe(FAVORITES_KEY)
    expect(uids(nodes).slice(0, 2)).toEqual([seq.uid, read.uid])
  })

  // A favourite that disappears from its own group would be disorienting, so
  // it is listed twice on purpose.
  it('leaves the starred item in its normal group as well', () => {
    const { nodes } = build({ byKind: { sequence: [seq] }, starred: [seq.uid] })
    expect(uids(nodes).filter(u => u === seq.uid)).toHaveLength(2)
  })

  it('has no favorites group when nothing is starred', () => {
    const { nodes } = build({ byKind: { sequence: [seq] } })
    expect(groups(nodes)).not.toContain(FAVORITES_KEY)
  })
})

describe('buildNodes folders', () => {
  const inFolder = item('sequence', 't1', 'filed')
  const loose = item('sequence', 't2', 'loose')
  const cloning = folder({ id: 'f1', name: 'Cloning', itemUids: ['sequence:t1'] })

  it('nests folders inside the sequences group, before the loose items', () => {
    const { nodes } = build({ byKind: { sequence: [inFolder, loose] }, folders: [cloning] })
    const kinds = nodes.map(n => n.type)
    expect(kinds.slice(0, 4)).toEqual(['group', 'folder', 'item', 'item'])
    expect(uids(nodes)).toEqual([inFolder.uid, loose.uid])
  })

  it('indents folder contents one level deeper than loose items', () => {
    const { nodes } = build({ byKind: { sequence: [inFolder, loose] }, folders: [cloning] })
    const items = nodes.filter(n => n.type === 'item')
    expect(items.map(n => n.depth)).toEqual([2, 1])
  })

  it('hides the contents of a collapsed folder', () => {
    const { nodes } = build({
      byKind: { sequence: [inFolder] },
      folders: [{ ...cloning, collapsed: true }],
    })
    expect(uids(nodes)).toEqual([])
  })

  it('invites a drop into an empty folder', () => {
    const { nodes } = build({ folders: [{ ...cloning, itemUids: [] }] })
    const messages = nodes.filter(n => n.type === 'empty').map(n => n.type === 'empty' ? n.message : '')
    expect(messages).toContain('Drag items here')
  })
})

describe('buildNodes search', () => {
  const alpha = item('sequence', 't1', 'alpha')
  const beta = item('sequence', 't2', 'beta')
  const read = item('read', 'r1', 'alpha-read')

  it('keeps only matching items, across kinds', () => {
    const { nodes, matchCount } = build({
      byKind: { sequence: [alpha, beta], read: [read] },
      query: 'alpha',
    })
    expect(uids(nodes)).toEqual([alpha.uid, read.uid])
    expect(matchCount).toBe(2)
  })

  it('reports no matches rather than showing empty groups', () => {
    const { nodes, matchCount } = build({ byKind: { sequence: [alpha] }, query: 'zzz' })
    expect(matchCount).toBe(0)
    expect(groups(nodes)).toEqual([])
  })

  // Searching for a folder is a way to pull up everything filed in it.
  it('shows every item in a folder whose own name matches', () => {
    const { nodes } = build({
      byKind: { sequence: [alpha, beta] },
      folders: [folder({ id: 'f1', name: 'Cloning', itemUids: ['sequence:t1', 'sequence:t2'] })],
      query: 'cloning',
    })
    expect(uids(nodes)).toEqual([alpha.uid, beta.uid])
  })
})

describe('buildNodes item order', () => {
  // Shift-click range selection reads this list, so it has to match what the
  // eye sees. The old explorer kept a separate hand-built array for it.
  it('returns item uids in visual order', () => {
    const seq = item('sequence', 't1', 'one')
    const read = item('read', 'r1', 'two')
    const { nodes, itemUids } = build({ byKind: { sequence: [seq], read: [read] } })
    expect(itemUids).toEqual(uids(nodes))
    expect(itemUids).toEqual([seq.uid, read.uid])
  })
})

describe('buildNodes grouping modes', () => {
  const seq = item('sequence', 't1', 'plasmid')
  const read = item('read', 'r1', 'trace')
  const contig = item('contig', 'c1', 'assembly')
  // One folder holding three different kinds, which the old model could not
  // express at all.
  const mixed = folder({
    id: 'f1', name: 'Run 3',
    itemUids: ['sequence:t1', 'read:r1', 'contig:c1'],
  })
  const all = { byKind: { sequence: [seq], read: [read], contig: [contig] }, folders: [mixed] }

  it('folder mode shows one folder holding every kind', () => {
    const { nodes } = build({ ...all, groupBy: 'folder' })
    const folders = nodes.filter(n => n.type === 'folder')
    expect(folders).toHaveLength(1)
    expect(folders[0].type === 'folder' && folders[0].count).toBe(3)
    expect(uids(nodes)).toEqual([contig.uid, seq.uid, read.uid])
  })

  // The same folder, seen through the other dimension: once per type section
  // that it actually holds something for.
  it('type mode shows the folder inside each kind group it has items for', () => {
    const { nodes } = build({ ...all, groupBy: 'type' })
    expect(nodes.filter(n => n.type === 'folder')).toHaveLength(3)
    expect(groups(nodes)).toEqual(['sequence', 'read', 'contig'])
  })

  it('folder mode puts unfiled items under Ungrouped', () => {
    const loose = item('sequence', 't2', 'loose')
    const { nodes } = build({
      byKind: { sequence: [seq, loose] }, folders: [mixed], groupBy: 'folder',
    })
    expect(groups(nodes)).toEqual([UNGROUPED_KEY])
    expect(uids(nodes)).toEqual([seq.uid, loose.uid])
  })

  it('nests folders by parentId', () => {
    const parent = folder({ id: 'p', name: 'Parent' })
    const child = folder({ id: 'c', name: 'Child', parentId: 'p', itemUids: ['sequence:t1'] })
    const { nodes } = build({
      byKind: { sequence: [seq] }, folders: [parent, child], groupBy: 'folder',
    })
    const rows = nodes.filter(n => n.type !== 'group')
    expect(rows.map(n => n.depth)).toEqual([0, 1, 2])
    // The parent counts what its whole subtree holds, not just its own items.
    expect(rows[0].type === 'folder' && rows[0].count).toBe(1)
  })

  // Nothing in the UI can make a cycle, but a hand-edited session could, and
  // an infinite tree is worse than a wrong one.
  it('survives a cycle in parentId', () => {
    const a = folder({ id: 'a', parentId: 'b' })
    const b = folder({ id: 'b', parentId: 'a' })
    const { nodes } = build({ folders: [a, b], groupBy: 'folder' })
    expect(nodes.length).toBeLessThan(50)
  })

  it('tag mode lists a multi-tagged item under each of its tags', () => {
    const { nodes } = build({
      byKind: { sequence: [seq], read: [read] },
      tags: { 'sequence:t1': ['cloning', 'done'], 'read:r1': ['cloning'] },
      groupBy: 'tag',
    })
    expect(groups(nodes)).toEqual(['tag:cloning', 'tag:done'])
    expect(uids(nodes)).toEqual([seq.uid, read.uid, seq.uid])
  })

  it('tag mode collects untagged items last', () => {
    const { nodes } = build({
      byKind: { sequence: [seq], read: [read] },
      tags: { 'sequence:t1': ['cloning'] },
      groupBy: 'tag',
    })
    expect(groups(nodes)).toEqual(['tag:cloning', UNTAGGED_KEY])
  })

  it('date mode buckets by age, newest bucket first', () => {
    const now = 1_700_000_000_000
    const day = 86_400_000
    const { nodes } = build({
      byKind: {
        sequence: [
          item('sequence', 'a', 'today', { createdAt: now - 1000 }),
          item('sequence', 'b', 'old', { createdAt: now - 60 * day }),
          item('sequence', 'c', 'week', { createdAt: now - 3 * day }),
        ],
      },
      groupBy: 'date',
      now,
    })
    expect(groups(nodes)).toEqual(['date-today', 'date-week', 'date-earlier'])
  })

  it('flat mode has no groups at all', () => {
    const { nodes } = build({ byKind: { sequence: [seq], read: [read] }, groupBy: 'flat' })
    expect(groups(nodes)).toEqual([])
    expect(uids(nodes)).toEqual([seq.uid, read.uid])
  })
})

describe('buildNodes sorting', () => {
  const items = [
    item('sequence', 'a', 'beta', { createdAt: 300, size: 10 }),
    item('sequence', 'b', 'alpha', { createdAt: 100, size: 30 }),
    item('sequence', 'c', 'gamma', { createdAt: 200, size: 20 }),
  ]

  const names = (over: Parameters<typeof build>[0]) =>
    build(over).nodes.filter(n => n.type === 'item').map(n => n.type === 'item' ? n.item.name : '')

  it('sorts by name, size and date', () => {
    expect(names({ byKind: { sequence: items }, sortBy: 'name' }))
      .toEqual(['alpha', 'beta', 'gamma'])
    expect(names({ byKind: { sequence: items }, sortBy: 'size' }))
      .toEqual(['beta', 'gamma', 'alpha'])
    expect(names({ byKind: { sequence: items }, sortBy: 'created' }))
      .toEqual(['alpha', 'gamma', 'beta'])
  })

  it('reverses on descending', () => {
    expect(names({ byKind: { sequence: items }, sortBy: 'name', sortDir: 'desc' }))
      .toEqual(['gamma', 'beta', 'alpha'])
  })

  // Sorting at the root only would leave folder contents in insertion order.
  it('sorts inside a folder too', () => {
    const contents = folder({
      id: 'f1', itemUids: ['sequence:a', 'sequence:b', 'sequence:c'],
    })
    expect(names({ byKind: { sequence: items }, folders: [contents], groupBy: 'folder' }))
      .toEqual(['alpha', 'beta', 'gamma'])
  })
})

describe('buildNodes derived nesting', () => {
  const ref = item('sequence', 't1', 'pUC19')
  const align = item('alignment', 'a1', 'MSA', { derivedFrom: ['sequence:t1'] })
  const orphan = item('alignment', 'a2', 'Other', { derivedFrom: ['sequence:gone'] })

  it('draws a derived item under its reference instead of its own group', () => {
    const { nodes } = build({
      byKind: { sequence: [ref], alignment: [align] },
      groupBy: 'flat',
      nestDerived: true,
    })
    const items = nodes.filter(n => n.type === 'item')
    expect(items.map(n => n.type === 'item' ? n.item.name : '')).toEqual(['pUC19', 'MSA'])
    expect(items.map(n => n.depth)).toEqual([0, 1])
  })

  it('leaves it where it was when the toggle is off', () => {
    const { nodes } = build({
      byKind: { sequence: [ref], alignment: [align] },
      groupBy: 'type',
    })
    expect(groups(nodes)).toContain('alignment')
  })

  it('keeps an item whose parent is not on screen at the top level', () => {
    const { nodes } = build({
      byKind: { alignment: [orphan] },
      groupBy: 'flat',
      nestDerived: true,
    })
    expect(uids(nodes)).toEqual([orphan.uid])
  })

  // A starred item has to be findable in Favorites whether or not its parent
  // happens to be visible.
  it('still lists a nested item in favorites', () => {
    const { nodes } = build({
      byKind: { sequence: [ref], alignment: [align] },
      groupBy: 'flat',
      nestDerived: true,
      starred: [align.uid],
    })
    expect(groups(nodes)).toEqual([FAVORITES_KEY])
    expect(uids(nodes).filter(u => u === align.uid)).toHaveLength(2)
  })
})

describe('buildNodes filtering', () => {
  const seq = item('sequence', 't1', 'plasmid')
  const read = item('read', 'r1', 'trace')

  it('applies the predicate before grouping', () => {
    const { nodes, matchCount } = build({
      byKind: { sequence: [seq], read: [read] },
      filter: i => i.kind === 'read',
    })
    expect(uids(nodes)).toEqual([read.uid])
    expect(matchCount).toBe(1)
  })

  // An always-shown group that is empty only because of a filter would read
  // as "you have no sequences", which is not what happened.
  it('hides an always-shown group emptied by a filter', () => {
    const { nodes } = build({
      byKind: { sequence: [seq], read: [read] },
      filter: i => i.kind === 'read',
    })
    expect(groups(nodes)).toEqual(['read'])
  })
})

describe('buildNodes keys', () => {
  // Keys are React keys. A duplicate let a deleted folder's row stay mounted
  // over its neighbours, because the same folder is drawn under every kind
  // it holds and the same item under Favorites and each of its tags.
  const seq = item('sequence', 't1', 'plasmid')
  const read = item('read', 'r1', 'read')
  const aln = item('alignment', 'a1', 'aln', { derivedFrom: [seq.uid] })
  const shared = {
    byKind: { sequence: [seq], read: [read], alignment: [aln] },
    folders: [
      folder({ id: 'f1', itemUids: [seq.uid, read.uid] }),
      folder({ id: 'f2', parentId: 'f1' }),
    ],
    starred: [seq.uid],
    tags: { [seq.uid]: ['a', 'b'] },
    nestDerived: true,
  }

  it.each<GroupBy>(['type', 'folder', 'tag', 'date', 'flat'])('are unique in %s mode', groupBy => {
    const keys = build({ ...shared, groupBy }).nodes.map(n => n.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('still draws a folder under each kind it holds', () => {
    const { nodes } = build(shared)
    expect(nodes.filter(n => n.type === 'folder' && n.folder.id === 'f1')).toHaveLength(2)
  })
})
