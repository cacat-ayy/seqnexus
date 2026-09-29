/**
 * Filter chips under the search box.
 *
 * Collapsed to a single button until opened, because most sessions never
 * need it and the panel has no vertical space to spare. While anything is
 * active the button carries a count and a Clear, so a filtered list can
 * never be mistaken for an empty one.
 */

import { memo } from 'react'
import { Star, Pencil, X } from 'lucide-react'
import type { ItemKind } from '../../explorer/types'
import { KIND_GROUP_LABEL, KIND_ORDER } from '../../explorer/kinds'
import { filterCount, toggleIn, type ExplorerFilters } from '../../explorer/filters'

interface Props {
  filters: ExplorerFilters
  onChange: (next: ExplorerFilters) => void
  /** Kinds that actually have items, so the chips match what is on screen. */
  availableKinds: ReadonlySet<ItemKind>
  allTags: string[]
  tagColors: Record<string, string>
  onClose: () => void
}

function ExplorerFilterBar({ filters, onChange, availableKinds, allTags, tagColors, onClose }: Props) {
  const count = filterCount(filters)

  return (
    <div className="ex-filters">
      <div className="ex-filter-row">
        {KIND_ORDER.filter(k => availableKinds.has(k)).map(kind => (
          <button
            key={kind}
            className={`ex-chip ${filters.kinds.has(kind) ? 'on' : ''}`}
            aria-pressed={filters.kinds.has(kind)}
            onClick={() => onChange({ ...filters, kinds: toggleIn(filters.kinds, kind) })}
          >
            {KIND_GROUP_LABEL[kind]}
          </button>
        ))}
      </div>

      {allTags.length > 0 && (
        <div className="ex-filter-row">
          {allTags.map(tag => (
            <button
              key={tag}
              className={`ex-chip ${filters.tags.has(tag) ? 'on' : ''}`}
              aria-pressed={filters.tags.has(tag)}
              style={{ '--chip-color': tagColors[tag] } as React.CSSProperties}
              onClick={() => onChange({ ...filters, tags: toggleIn(filters.tags, tag) })}
            >
              <span className="ex-chip-dot" />
              {tag}
            </button>
          ))}
        </div>
      )}

      <div className="ex-filter-row">
        <button
          className={`ex-chip ${filters.starredOnly ? 'on' : ''}`}
          aria-pressed={filters.starredOnly}
          onClick={() => onChange({ ...filters, starredOnly: !filters.starredOnly })}
        >
          <Star size={10} /> Starred
        </button>
        <button
          className={`ex-chip ${filters.modifiedOnly ? 'on' : ''}`}
          aria-pressed={filters.modifiedOnly}
          onClick={() => onChange({ ...filters, modifiedOnly: !filters.modifiedOnly })}
        >
          <Pencil size={10} /> Edited
        </button>
        <span className="ex-filter-spacer" />
        {count > 0 && (
          <button
            className="ex-chip ex-chip-clear"
            onClick={() => onChange({
              kinds: new Set(), tags: new Set(), starredOnly: false, modifiedOnly: false,
            })}
          >
            Clear {count}
          </button>
        )}
        <button className="ex-chip ex-chip-close" onClick={onClose} aria-label="Hide filters">
          <X size={10} />
        </button>
      </div>
    </div>
  )
}

export default memo(ExplorerFilterBar)
