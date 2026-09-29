/**
 * The collapsed explorer: a 40px rail of per-kind counts.
 *
 * Collapsing used to animate the panel to zero width and put a vertical-text
 * "Show sidebar" button in its place, which told you nothing about what was
 * in the session. Clicking a kind here expands the panel and scrolls to that
 * group, so the rail is a way in rather than just a way back.
 */

import { memo } from 'react'
import { PanelLeftOpen, Star } from 'lucide-react'
import { KIND_ICON, KIND_GROUP_LABEL, KIND_ORDER } from '../../explorer/kinds'
import type { ItemKind } from '../../explorer/types'

interface Props {
  counts: Record<ItemKind, number>
  starredCount: number
  /** Which kind the centre panel is showing, highlighted on the rail. */
  openKind: ItemKind | null
  onExpand: (group?: string) => void
}

function ExplorerRail({ counts, starredCount, openKind, onExpand }: Props) {
  return (
    <div className="ex-rail" role="toolbar" aria-orientation="vertical" aria-label="Explorer">
      <button className="ex-rail-btn" title="Show sidebar" onClick={() => onExpand()}>
        <PanelLeftOpen size={14} />
      </button>
      <span className="ex-rail-sep" />

      {starredCount > 0 && (
        <button
          className="ex-rail-btn"
          title={`Favorites (${starredCount})`}
          onClick={() => onExpand('favorites')}
        >
          <Star size={14} fill="currentColor" />
          <span className="ex-rail-count">{starredCount}</span>
        </button>
      )}

      {KIND_ORDER.filter(k => counts[k] > 0).map(kind => {
        const Icon = KIND_ICON[kind]
        return (
          <button
            key={kind}
            className={`ex-rail-btn ${openKind === kind ? 'has-open' : ''}`}
            title={`${KIND_GROUP_LABEL[kind]} (${counts[kind]})`}
            onClick={() => onExpand(kind)}
          >
            <Icon size={14} />
            <span className="ex-rail-count">{counts[kind]}</span>
          </button>
        )
      })}
    </div>
  )
}

export default memo(ExplorerRail)
