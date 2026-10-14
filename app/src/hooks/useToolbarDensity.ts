import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * How much air the toolbar is allowed, richest first.
 *
 * `full` is the designed layout. `tight` buys ~200px by squeezing padding and
 * collapsing the command palette to its icon, which is enough to keep the
 * labels on a 1280px laptop. `icons` drops the labels. `collapsed` folds the
 * analysis and design tools into one Tools menu, the last step before the
 * row stops fitting at all.
 */
export type ToolbarDensity = 'full' | 'tight' | 'icons' | 'collapsed'

/**
 * The steps each orientation tries, richest first. Down the left the toolbar
 * is a rail of icons from the start (labels would need a rail as wide as the
 * longest of them), so the only step left to take is the Tools menu.
 */
const DENSITIES: Record<'row' | 'column', ToolbarDensity[]> = {
  row: ['full', 'tight', 'icons', 'collapsed'],
  column: ['icons', 'collapsed'],
}

export interface ToolbarFit {
  density: ToolbarDensity
  /** True when even `collapsed` overflows and wrapping is the lesser evil. */
  wrapped: boolean
}

/**
 * Whether the toolbar's items spill past its content box, along the axis it
 * runs in.
 *
 * scrollWidth cannot answer this. A flex spacer grows to fill any spare room,
 * so a row that fits reports scrollWidth === clientWidth rather than less;
 * and a row that overflows by a few pixels only pushes into the right padding,
 * which scrollWidth does not count, so it reads as fitting too. The last
 * item's far edge against the inner edge of the box has neither problem:
 * the items do not shrink, so once they run out of room the last one is
 * pushed past it. The same holds for a column, with bottoms for rights.
 */
function overflows(el: HTMLElement, vertical: boolean): boolean {
  const last = el.lastElementChild
  if (!last) return false
  const style = getComputedStyle(el)
  const box = el.getBoundingClientRect()
  const inner = vertical
    ? box.bottom - (parseFloat(style.borderBottomWidth) || 0) - (parseFloat(style.paddingBottom) || 0)
    : box.right - (parseFloat(style.borderRightWidth) || 0) - (parseFloat(style.paddingRight) || 0)
  const end = vertical ? last.getBoundingClientRect().bottom : last.getBoundingClientRect().right
  // Half a pixel of tolerance for subpixel layout.
  return end > inner + 0.5
}

/**
 * Pick the richest toolbar density that still fits on one row, or in one
 * column when the toolbar runs down the left.
 *
 * The toolbar is a fixed set of buttons whose combined width lands around
 * 1300px, so a plain width breakpoint has to be guessed, and a guess that is
 * off by 20px either wraps the last two buttons onto a second row (which
 * moves the theme and info buttons, and with them their popovers) or strips
 * labels from screens wide enough to show them. So instead of modelling the
 * width in JS, each density is applied to the real element and measured: the
 * first one that does not overflow wins, whatever the fonts, zoom level or
 * button set happen to be.
 *
 * The caller renders the returned classes; this only decides which they are.
 */
export function useToolbarDensity(ref: RefObject<HTMLElement | null>, vertical = false): ToolbarFit {
  const steps = DENSITIES[vertical ? 'column' : 'row']
  const [fit, setFit] = useState<ToolbarFit>({ density: steps[0], wrapped: false })

  // Layout effect, not effect: the first measurement has to land before the
  // browser paints, or the toolbar shows one frame at full width and snaps.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    let frame = 0

    const apply = (d: ToolbarDensity, wrapped: boolean) => {
      el.classList.toggle('is-tight', d !== 'full')
      el.classList.toggle('is-icons', d === 'icons' || d === 'collapsed')
      el.classList.toggle('is-collapsed', d === 'collapsed')
      el.classList.toggle('is-wrap', wrapped)
    }

    const measure = () => {
      frame = 0
      // A hidden toolbar (or jsdom, which does no layout) measures zero:
      // there is nothing to decide, and any comparison would be noise.
      if ((vertical ? el.clientHeight : el.clientWidth) === 0) return

      let chosen = steps[steps.length - 1]
      for (const d of steps) {
        apply(d, false)
        if (!overflows(el, vertical)) {
          chosen = d
          break
        }
      }
      // Smaller than even the collapsed toolbar: let it wrap rather than push
      // the trailing buttons past the edge of the window where nobody can hit
      // them. A column wraps into a second column; it does not scroll, since
      // a scrolling toolbar would clip the menus that open out of it.
      apply(chosen, false)
      const wrapped = overflows(el, vertical)
      apply(chosen, wrapped)
      setFit(prev =>
        prev.density === chosen && prev.wrapped === wrapped ? prev : { density: chosen, wrapped },
      )
    }

    // Measurement writes classes that change the toolbar's size, which the
    // observer reports back. Coalescing into a frame keeps that from turning
    // into a burst of reflows; the result is idempotent, so it settles.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }

    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    // The toolbar's own box does not change when its buttons do (tools left
    // out in another workspace, a label swapped), so its content is watched
    // too. Only the children: the classes measure() writes are attributes,
    // so watching them would loop.
    const mo = new MutationObserver(schedule)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    measure()
    // Labels are wider before the webfont lands than after, so a measurement
    // taken during the fallback font can pick a denser layout than needed.
    document.fonts?.ready.then(schedule).catch(() => {})

    return () => {
      ro.disconnect()
      mo.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ref, vertical, steps])

  // Just switched orientation and not yet measured (or never measured, as in
  // jsdom): a density the new orientation does not have reads as its first.
  return steps.includes(fit.density) ? fit : { density: steps[0], wrapped: false }
}
