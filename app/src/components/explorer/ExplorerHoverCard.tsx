/**
 * Richer preview than a title attribute can carry.
 *
 * The row itself stays terse because the sidebar is narrow; this is where
 * the description, the note, the tags and a picture of the thing live. Built
 * only on hover, so a session of several hundred items costs nothing to
 * scroll.
 */

import { useEditorStore } from '../../store'
import { useClampedPosition } from '../../hooks/useClampedPosition'
import { KIND_LABEL } from '../../explorer/kinds'
import type { ExplorerItem } from '../../explorer/types'
import { PlasmidThumbnail, QualitySparkline } from './ExplorerPreview'

interface Props {
  item: ExplorerItem
  x: number
  y: number
  note?: string
  tags: string[]
  tagColors: Record<string, string>
}

/** First bases of whatever this item is made of, for a glance at the content. */
function previewBases(item: ExplorerItem): string | null {
  const s = useEditorStore.getState()
  switch (item.kind) {
    case 'sequence':
      return s.tabs.find(t => t.id === item.id)?.doc.sequence.bases.slice(0, 60) ?? null
    case 'read':
      return s.sequencingReads.find(r => r.id === item.id)?.data.bases.slice(0, 60) ?? null
    case 'alignment':
      return s.alignments.find(a => a.id === item.id)?.result.consensus.slice(0, 60) ?? null
    case 'read-alignment':
      return s.readAlignments.find(r => r.id === item.id)?.result.consensus.slice(0, 60) ?? null
    default:
      return null
  }
}

export default function ExplorerHoverCard({ item, x, y, note, tags, tagColors }: Props) {
  const { ref, pos } = useClampedPosition(x, y)
  const store = useEditorStore.getState()

  const tab = item.kind === 'sequence' ? store.tabs.find(t => t.id === item.id) : undefined
  const read = item.kind === 'read' ? store.sequencingReads.find(r => r.id === item.id) : undefined
  const bases = previewBases(item)

  return (
    <div ref={ref} className="ex-hovercard" style={{ position: 'fixed', left: pos.left, top: pos.top }}>
      <div className="ex-hovercard-title">{item.name}</div>
      <div className="ex-hovercard-kind">{KIND_LABEL[item.kind]}</div>

      {tab && tab.doc.sequence.length > 0 && (
        <div className="ex-hovercard-figure"><PlasmidThumbnail doc={tab.doc} /></div>
      )}
      {read && (
        <div className="ex-hovercard-figure">
          <QualitySparkline data={read.data} trimStart={read.trimStart} trimEnd={read.trimEnd} />
        </div>
      )}

      <div className="ex-hovercard-stats">{item.stats.join(' · ')}</div>

      {tab?.doc.description && (
        <div className="ex-hovercard-desc">{tab.doc.description}</div>
      )}

      {bases && <div className="ex-hovercard-bases">{bases}{bases.length === 60 ? '…' : ''}</div>}

      {tags.length > 0 && (
        <div className="ex-hovercard-tags">
          {tags.map(tag => (
            <span
              key={tag}
              className="ex-tag-chip"
              style={{ '--tag-color': tagColors[tag] } as React.CSSProperties}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {note && <div className="ex-hovercard-note">{note}</div>}
    </div>
  )
}
