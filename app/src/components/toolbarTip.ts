/**
 * What a toolbar button's tooltip says.
 *
 * `why` is shown only while the button is disabled, so call sites can pass it
 * unconditionally; a greyed-out icon that does not say why is a dead end.
 * `status` is for live state worth a line of its own, like a running search.
 */
export interface TipSpec {
  label: string
  shortcut?: string
  desc?: string
  status?: string
  why?: string
}

/**
 * Props that give a toolbar button its tooltip, to spread onto it.
 *
 * Data attributes rather than a wrapper component: one delegated listener on
 * the toolbar serves every button, and the button markup stays as it was. The
 * label doubles as the accessible name, which matters once the density hook
 * has hidden the visible text.
 */
export function tip(spec: TipSpec): Record<string, string> {
  const props: Record<string, string> = { 'aria-label': spec.label, 'data-tip': spec.label }
  if (spec.shortcut) {
    props['data-tip-kbd'] = spec.shortcut
    props['aria-keyshortcuts'] = spec.shortcut.replace(/⌘/g, 'Meta+').replace(/⇧/g, 'Shift+')
  }
  if (spec.desc) props['data-tip-desc'] = spec.desc
  if (spec.status) props['data-tip-status'] = spec.status
  if (spec.why) props['data-tip-why'] = spec.why
  return props
}
