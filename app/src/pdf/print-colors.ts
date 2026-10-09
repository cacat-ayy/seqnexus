/**
 * Colours for printing: the light theme's, whatever theme the app is in.
 *
 * "As seen" in print means the view's colours on paper. A dark theme's
 * colours are made for a dark canvas (pale text, bright bases) and would
 * print as faint marks on white, so the export reads the default light
 * theme's tokens instead. They are read off a hidden probe element carrying
 * the light theme, so they stay in step with App.css rather than being
 * copied here.
 */

import { readSequenceColors, type SequenceColors } from '../components/sequence-paint'
import { resolvePlasmidColors, type PlasmidColors, type PlasmidStyle } from '../plasmid/styles'

/** Paper. A fixed output colour: the page is white in every theme. */
export const PAPER = '#ffffff'

function withLightTheme<T>(read: (el: HTMLElement) => T): T {
  const probe = document.createElement('div')
  probe.className = 'app-root'
  probe.setAttribute('data-theme', 'light')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:fixed;left:-10000px;top:0;width:0;height:0;padding:0;visibility:hidden;'
  document.body.appendChild(probe)
  try {
    return read(probe)
  } finally {
    probe.remove()
  }
}

/** The sequence painter's colours, light theme, on white. */
export function printSequenceColors(): SequenceColors {
  return { ...withLightTheme(readSequenceColors), bg: PAPER }
}

/** The plasmid map's colours for a style, light theme, on white. */
export function printPlasmidColors(style: PlasmidStyle): PlasmidColors {
  return { ...withLightTheme(el => resolvePlasmidColors(style, el)), bg: PAPER }
}

/** Design tokens as the light theme sets them, for figures drawn outside the app (exported reports). */
export function printTokens<K extends string>(names: readonly K[]): Record<K, string> {
  return withLightTheme(el => {
    const cs = getComputedStyle(el)
    return Object.fromEntries(names.map(n => [n, cs.getPropertyValue(`--${n}`).trim()])) as Record<K, string>
  })
}
