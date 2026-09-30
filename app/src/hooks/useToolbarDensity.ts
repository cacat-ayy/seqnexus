import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * How much air the toolbar is allowed, richest first.
 *
 * `full` is the designed layout. `tight` buys ~200px by squeezing padding and
 * collapsing the command palette to its icon, which is enough to keep the
 * labels on a 1280px laptop. `icons` drops the labels — the last step before
 * the row stops fitting at all.
 */
export type ToolbarDensity = 'full' | 'tight' | 'icons'

const DENSITIES: ToolbarDensity[] = ['full', 'tight', 'icons']

export interface ToolbarFit {
  density: ToolbarDensity
  /** True when even `icons` overflows and wrapping is the lesser evil. */
  wrapped: boolean
}

/**
 * Whether the row's items spill past the toolbar's content box.
 *
 * scrollWidth cannot answer this. A flex spacer grows to fill any spare room,
 * so a row that fits reports scrollWidth === clientWidth rather than less;
 * and a row that overflows by a few pixels only pushes into the right padding,
 * which scrollWidth does not count, so it reads as fitting too. The last
 * item's right edge against the inner edge of the box has neither problem:
 * the items do not shrink, so once they run out of room the last one is
 * pushed past it.
 */
function overflows(el: HTMLElement): boolean {
  const last = el.lastElementChild
  if (!last) return false
  const style = getComputedStyle(el)
  const inner =
    el.getBoundingClientRect().right -
    (parseFloat(style.borderRightWidth) || 0) -
    (parseFloat(style.paddingRight) || 0)
  // Half a pixel of tolerance for subpixel layout.
  return last.getBoundingClientRect().right > inner + 0.5
}

/**
 * Pick the richest toolbar density that still fits on one row.
 *
 * The toolbar is a fixed set of buttons whose combined width lands around
 * 1300px, so a plain width breakpoint has to be guessed, and a guess that is
 * off by 20px either wraps the last two buttons onto a second row — which
 * moves the theme and info buttons, and with them their popovers — or strips
 * labels from screens wide enough to show them. So instead of modelling the
 * width in JS, each density is applied to the real element and measured: the
 * first one that does not overflow wins, whatever the fonts, zoom level or
 * button set happen to be.
 *
 * The caller renders the returned classes; this only decides which they are.
 */
export function useToolbarDensity(ref: RefObject<HTMLElement | null>): ToolbarFit {
  const [fit, setFit] = useState<ToolbarFit>({ density: 'full', wrapped: false })

  // Layout effect, not effect: the first measurement has to land before the
  // browser paints, or the toolbar shows one frame at full width and snaps.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    let frame = 0

    const apply = (d: ToolbarDensity, wrapped: boolean) => {
      el.classList.toggle('is-tight', d !== 'full')
      el.classList.toggle('is-icons', d === 'icons')
      el.classList.toggle('is-wrap', wrapped)
    }

    const measure = () => {
      frame = 0
      // A hidden toolbar (or jsdom, which does no layout) measures zero —
      // there is nothing to decide, and any comparison would be noise.
      if (el.clientWidth === 0) return

      let chosen = DENSITIES[DENSITIES.length - 1]
      for (const d of DENSITIES) {
        apply(d, false)
        if (!overflows(el)) {
          chosen = d
          break
        }
      }
      // Narrower than even the icon row: let it wrap rather than push the
      // trailing buttons past the edge of the window where nobody can hit them.
      apply(chosen, false)
      const wrapped = overflows(el)
      apply(chosen, wrapped)
      setFit(prev =>
        prev.density === chosen && prev.wrapped === wrapped ? prev : { density: chosen, wrapped },
      )
    }

    // Measurement writes classes that change the toolbar's height, which the
    // observer reports back. Coalescing into a frame keeps that from turning
    // into a burst of reflows; the result is idempotent, so it settles.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }

    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    measure()
    // Labels are wider before the webfont lands than after, so a measurement
    // taken during the fallback font can pick a denser layout than needed.
    document.fonts?.ready.then(schedule).catch(() => {})

    return () => {
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ref])

  return fit
}
