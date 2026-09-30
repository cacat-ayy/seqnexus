import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

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

/** Hover this long before the first tooltip appears. */
const SHOW_DELAY = 450
/** Moving to a neighbour within this long of the last tooltip shows it at once. */
const WARM_WINDOW = 300
const GAP = 6
const EDGE = 8

interface Shown {
  el: HTMLElement
  label: string
  shortcut?: string
  desc?: string
  status?: string
  why?: string
}

function read(el: HTMLElement): Shown {
  const d = el.dataset
  const disabled = el.matches(':disabled, [aria-disabled="true"]')
  return {
    el,
    label: d.tip ?? '',
    shortcut: d.tipKbd,
    desc: d.tipDesc,
    status: d.tipStatus,
    why: disabled ? d.tipWhy : undefined,
  }
}

/**
 * Tooltips for everything under `container` that carries `tip()` props.
 *
 * Rendered in place rather than portalled to <body>, because the theme's
 * variables live on .app-root and a tooltip outside it would render unstyled;
 * `position: fixed` takes it out of the toolbar's layout all the same.
 */
export function ToolbarTooltip({ container }: { container: RefObject<HTMLElement | null> }) {
  const [shown, setShown] = useState<Shown | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = container.current
    if (!root) return

    let timer = 0
    let current: HTMLElement | null = null
    let visible = false
    let lastHidden = 0
    // After a click the pointer is still over the button, and a tooltip
    // popping back over the menu it just opened is noise. Stay quiet until
    // the pointer moves on to something else.
    let suppressed: HTMLElement | null = null

    const display = (el: HTMLElement | null) => {
      visible = el !== null
      setShown(el ? read(el) : null)
    }

    const hide = () => {
      window.clearTimeout(timer)
      if (visible) lastHidden = performance.now()
      current = null
      display(null)
    }

    const target = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]') ?? null

    const show = (el: HTMLElement, immediate: boolean) => {
      window.clearTimeout(timer)
      current = el
      // An open menu already says what the button does.
      if (el.getAttribute('aria-expanded') === 'true') { display(null); return }
      // Skimming along the row: once one tooltip is up, the next one should
      // not make the user wait again — whether the pointer crossed a gap
      // (just hidden) or went straight from button to button (still showing).
      const warm = visible || performance.now() - lastHidden < WARM_WINDOW
      if (immediate || warm) display(el)
      else timer = window.setTimeout(() => { if (current === el) display(el) }, SHOW_DELAY)
    }

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const el = target(e)
      if (el === current) return
      if (el !== suppressed) suppressed = null
      if (!el || suppressed) { hide(); return }
      show(el, false)
    }
    const onLeave = () => { suppressed = null; hide() }
    const onDown = (e: PointerEvent) => { suppressed = target(e); hide() }
    // Keyboard focus shows the tooltip too, but not the focus a click leaves
    // behind, which is what :focus-visible tells apart.
    const onFocus = (e: FocusEvent) => {
      const el = target(e)
      if (el && el.matches(':focus-visible')) show(el, true)
    }
    const onBlur = () => hide()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }

    root.addEventListener('pointerover', onOver)
    root.addEventListener('pointerleave', onLeave)
    root.addEventListener('pointerdown', onDown, true)
    root.addEventListener('focusin', onFocus)
    root.addEventListener('focusout', onBlur)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      window.clearTimeout(timer)
      root.removeEventListener('pointerover', onOver)
      root.removeEventListener('pointerleave', onLeave)
      root.removeEventListener('pointerdown', onDown, true)
      root.removeEventListener('focusin', onFocus)
      root.removeEventListener('focusout', onBlur)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [container])

  // Centre under the button, then pull back inside the window: the buttons at
  // either end of the toolbar would otherwise push half the tooltip off-screen.
  useLayoutEffect(() => {
    if (!shown || !tipRef.current) { setPos(null); return }
    const r = shown.el.getBoundingClientRect()
    const w = tipRef.current.offsetWidth
    const left = Math.min(
      Math.max(EDGE, r.left + r.width / 2 - w / 2),
      window.innerWidth - w - EDGE,
    )
    setPos({ left, top: r.bottom + GAP })
  }, [shown])

  if (!shown) return null
  return (
    <div
      ref={tipRef}
      className="tb-tooltip"
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      <div className="tb-tooltip-head">
        <span className="tb-tooltip-label">{shown.label}</span>
        {shown.shortcut && <kbd className="tb-tooltip-kbd">{shown.shortcut}</kbd>}
      </div>
      {shown.desc && <div className="tb-tooltip-desc">{shown.desc}</div>}
      {shown.status && <div className="tb-tooltip-status">{shown.status}</div>}
      {shown.why && <div className="tb-tooltip-why">{shown.why}</div>}
    </div>
  )
}
