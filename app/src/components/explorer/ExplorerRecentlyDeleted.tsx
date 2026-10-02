/**
 * The delete buffer, shown as a foldable strip above the tree.
 *
 * The buffer already existed and every delete already offers an Undo toast,
 * but a toast is gone in a few seconds. This is the same five entries, still
 * reachable a minute later.
 *
 * Deliberately outside the windowed tree: it is capped at MAX_RECENTLY_CLOSED
 * entries, it is never persisted, and keeping it out of `buildNodes` means
 * grouping and filtering never have to reason about items that do not exist.
 */

import { memo } from 'react'
import { ChevronRight, Undo2 } from 'lucide-react'
import { useEditorStore, type DeletedItem } from '../../store'
import { KIND_ICON, KIND_LABEL } from '../../explorer/kinds'
import type { ItemKind } from '../../explorer/types'

/** What a buffer entry is called and what kind it was. */
function describe(entry: DeletedItem): { name: string; kind: ItemKind } {
  switch (entry.kind) {
    case 'sequence': return { name: entry.tab.doc.name, kind: 'sequence' }
    case 'read': return { name: entry.read.data.name, kind: 'read' }
    case 'alignment': return { name: entry.alignment.name, kind: 'alignment' }
    case 'contig': return { name: entry.contig.name, kind: 'contig' }
    case 'oligo': return { name: entry.oligo.name, kind: 'oligo' }
    case 'gel': return { name: entry.gel.name, kind: 'gel' }
  }
}

interface Props {
  collapsed: boolean
  onToggle: () => void
}

function ExplorerRecentlyDeleted({ collapsed, onToggle }: Props) {
  const recentlyDeleted = useEditorStore(s => s.recentlyDeleted)
  const undoDelete = useEditorStore(s => s.undoDelete)
  if (recentlyDeleted.length === 0) return null

  // Newest first: the thing you just deleted is the thing you want back.
  const entries = [...recentlyDeleted].reverse()

  return (
    <div className="ex-recent">
      <button
        type="button"
        className="ex-group ex-recent-header"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span className={`ex-chevron ${collapsed ? '' : 'open'}`}><ChevronRight size={12} /></span>
        <Undo2 size={11} />
        <span className="ex-group-title">Recently deleted</span>
        <span className="ex-count">{entries.length}</span>
      </button>

      {!collapsed && (
        <ul className="ex-recent-list">
          {entries.map((entry, i) => {
            const { name, kind } = describe(entry)
            const Icon = KIND_ICON[kind]
            // Only the newest can be restored: the buffer is a stack, and
            // restoring out of order would put a read alignment back without
            // the contig edit that went with it.
            const restorable = i === 0
            return (
              <li key={`${kind}:${name}:${i}`} className="ex-recent-row">
                <Icon size={12} />
                <span className="ex-recent-name" title={`${KIND_LABEL[kind]}: ${name}`}>{name}</span>
                {restorable && (
                  <button className="ex-recent-undo" onClick={() => undoDelete()}>Restore</button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default memo(ExplorerRecentlyDeleted)
