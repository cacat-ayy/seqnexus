/**
 * Explorer header: one place to add something, one to change how the list is
 * shaped, one to change how rows look.
 *
 * The old panel had a single `+` button, in the Sequencing section header,
 * so reads could be imported from the explorer but sequences could not. Both
 * now start from the same menu.
 */

import { useRef, useState, type MouseEvent, type MutableRefObject, type ReactNode } from 'react'
import {
  Plus, FolderPlus, PanelLeftClose, Rows3, Dna, FileUp, FolderUp, Globe,
  Group, ArrowDownUp, Check, ArrowUp, ArrowDown, Network, MoveRight,
} from 'lucide-react'
import { usePopoverDismiss } from '../../hooks/usePopoverDismiss'
import { useClampedPosition } from '../../hooks/useClampedPosition'
import {
  GROUP_BY_OPTIONS, SORT_OPTIONS,
  type Density, type GroupBy, type SortBy, type SortDir,
} from '../../explorer/types'

const DENSITY_LABEL: Record<Density, string> = {
  compact: 'Compact',
  comfortable: 'Comfortable',
  relaxed: 'Relaxed',
}

type OpenMenu = 'add' | 'group' | 'sort' | null

/** px between the trigger button and the menu below it */
const MENU_GAP = 4

/**
 * Drops down from the button that opened it. Fixed and viewport-clamped like
 * ContextMenuPopup: absolutely positioned inside the header, the menu landed
 * centred on the 32px bar and the sidebar's overflow: hidden cut it off.
 */
function ToolbarMenu({ x, y, menuRef, children }: {
  x: number
  y: number
  menuRef: MutableRefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const { ref, pos } = useClampedPosition(x, y)
  return (
    <div
      ref={node => { ref(node); menuRef.current = node }}
      className="ex-menu ctx-menu"
      role="menu"
      style={{ position: 'fixed', left: pos.left, top: pos.top }}
    >
      {children}
    </div>
  )
}

interface Props {
  density: Density
  groupBy: GroupBy
  sortBy: SortBy
  sortDir: SortDir
  nestDerived: boolean
  onCycleDensity: () => void
  onGroupBy: (mode: GroupBy) => void
  onSort: (by: SortBy, dir: SortDir) => void
  onToggleNestDerived: () => void
  onNewSequence: () => void
  /** Paste or import oligos into the primer library. */
  onAddOligos: () => void
  onNewFolder: () => void
  onFetch: () => void
  onPickFiles: () => void
  onPickFolder: () => void
  onCollapse: () => void
}

export default function ExplorerToolbar({
  density, groupBy, sortBy, sortDir, nestDerived,
  onCycleDensity, onGroupBy, onSort, onToggleNestDerived,
  onNewSequence, onAddOligos, onNewFolder, onFetch, onPickFiles, onPickFolder, onCollapse,
}: Props) {
  const [menu, setMenu] = useState<OpenMenu>(null)
  const [anchor, setAnchor] = useState({ x: 0, y: 0 })
  const menuRef = useRef<HTMLDivElement | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  usePopoverDismiss(menu !== null, () => setMenu(null), menuRef, barRef)

  const run = (fn: () => void) => () => { setMenu(null); fn() }
  const toggle = (which: Exclude<OpenMenu, null>) =>
    (e: MouseEvent<HTMLButtonElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      setAnchor({ x: r.left, y: r.bottom + MENU_GAP })
      setMenu(m => (m === which ? null : which))
    }

  return (
    <div className="ex-header" ref={barRef}>
      <span className="ex-title">Explorer</span>

      <button
        className={`ex-hbtn ${menu === 'add' ? 'active' : ''}`}
        title="Add to the explorer"
        aria-haspopup="menu"
        aria-expanded={menu === 'add'}
        onClick={toggle('add')}
      >
        <Plus size={14} />
      </button>

      <button className="ex-hbtn" title="New folder" onClick={onNewFolder}>
        <FolderPlus size={14} />
      </button>

      <button
        className={`ex-hbtn ${menu === 'group' ? 'active' : ''}`}
        title="Group by"
        aria-haspopup="menu"
        aria-expanded={menu === 'group'}
        onClick={toggle('group')}
      >
        <Group size={14} />
      </button>

      <button
        className={`ex-hbtn ${menu === 'sort' ? 'active' : ''}`}
        title="Sort"
        aria-haspopup="menu"
        aria-expanded={menu === 'sort'}
        onClick={toggle('sort')}
      >
        <ArrowDownUp size={14} />
      </button>

      <button
        className="ex-hbtn"
        title={`Row density: ${DENSITY_LABEL[density]}`}
        onClick={onCycleDensity}
      >
        <Rows3 size={14} />
      </button>

      <button className="ex-hbtn" title="Hide sidebar" onClick={onCollapse}>
        <PanelLeftClose size={14} />
      </button>

      {menu === 'add' && (
        <ToolbarMenu x={anchor.x} y={anchor.y} menuRef={menuRef}>
          <button className="ctx-menu-item" role="menuitem" onClick={run(onNewSequence)}>
            <Dna size={13} /> New sequence…
          </button>
          <button className="ctx-menu-item" role="menuitem" onClick={run(onPickFiles)}>
            <FileUp size={13} /> Import files…
          </button>
          <button className="ctx-menu-item" role="menuitem" onClick={run(onPickFolder)}>
            <FolderUp size={13} /> Import folder…
          </button>
          <button className="ctx-menu-item" role="menuitem" onClick={run(onFetch)}>
            <Globe size={13} /> Fetch from NCBI…
          </button>
          <button className="ctx-menu-item" role="menuitem" onClick={run(onAddOligos)}>
            <MoveRight size={13} /> Add oligos to library…
          </button>
        </ToolbarMenu>
      )}

      {menu === 'group' && (
        <ToolbarMenu x={anchor.x} y={anchor.y} menuRef={menuRef}>
          <div className="ctx-menu-header">Group by</div>
          {GROUP_BY_OPTIONS.map(opt => (
            <button
              key={opt.id}
              className="ctx-menu-item ex-check-item"
              role="menuitemradio"
              aria-checked={groupBy === opt.id}
              onClick={run(() => onGroupBy(opt.id))}
            >
              <span className="ex-check">{groupBy === opt.id && <Check size={12} />}</span>
              {opt.label}
            </button>
          ))}
          <div className="ctx-menu-sep" />
          <button
            className="ctx-menu-item ex-check-item"
            role="menuitemcheckbox"
            aria-checked={nestDerived}
            onClick={run(onToggleNestDerived)}
          >
            <span className="ex-check">{nestDerived && <Check size={12} />}</span>
            <Network size={13} /> Nest derived items
          </button>
        </ToolbarMenu>
      )}

      {menu === 'sort' && (
        <ToolbarMenu x={anchor.x} y={anchor.y} menuRef={menuRef}>
          <div className="ctx-menu-header">Sort by</div>
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.id}
              className="ctx-menu-item ex-check-item"
              role="menuitemradio"
              aria-checked={sortBy === opt.id}
              // Picking the active key flips the direction, which is what a
              // second click on a column header does everywhere else.
              onClick={run(() => onSort(
                opt.id,
                sortBy === opt.id ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc',
              ))}
            >
              <span className="ex-check">
                {sortBy === opt.id && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
              </span>
              {opt.label}
            </button>
          ))}
        </ToolbarMenu>
      )}
    </div>
  )
}
