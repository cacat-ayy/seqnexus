/**
 * The groups of a menu (New, Import, Export, Session), drawn in either menu
 * style: the File menu's or a context menu's. The New and Import groups are
 * defined once, in App, and drawn by both the File menu and the explorer's
 * + menu, which used to offer different items under different names.
 */

import { Fragment } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface MenuAction {
  id: string
  label: string
  icon: LucideIcon
  /** Shown at the right, as the command palette shows it. */
  shortcut?: string
  /** A line under the label, when the label alone does not say enough. */
  title?: string
  disabled?: boolean
  run: () => void
}

export interface MenuGroup {
  label: string
  actions: MenuAction[]
}

interface Props {
  groups: MenuGroup[]
  variant: 'file' | 'ctx'
  /** Called before an action runs, to close the menu. */
  onPicked?: () => void
}

export default function MenuGroups({ groups, variant, onPicked }: Props) {
  const file = variant === 'file'
  return groups.map((group, i) => (
    <Fragment key={group.label}>
      {i > 0 && <div className={file ? 'file-menu-sep' : 'ctx-menu-sep'} role="separator" />}
      <div className="menu-group-label" role="presentation">{group.label}</div>
      {group.actions.map(action => {
        const Icon = action.icon
        return (
          <button
            key={action.id}
            className={file ? 'file-menu-item' : 'ctx-menu-item'}
            role="menuitem"
            disabled={action.disabled}
            title={action.title}
            onClick={() => { onPicked?.(); action.run() }}
          >
            {file ? <span className="file-menu-icon"><Icon size={14} /></span> : <Icon size={13} />}
            <span className="menu-item-label">{action.label}</span>
            {action.shortcut && <kbd className="menu-kbd">{action.shortcut}</kbd>}
          </button>
        )
      })}
    </Fragment>
  ))
}
