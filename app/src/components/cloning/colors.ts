/**
 * Colours for the parts of a design.
 *
 * One hue per part, in the order the parts are listed, so the swatch beside a
 * part in the list is the same colour as its arc in the diagram. Chosen to
 * stay apart from each other and legible against either theme's panel.
 */

const PART_HUES = [205, 150, 32, 275, 95, 345, 185, 55]

export function partColor(index: number): string {
  return `hsl(${PART_HUES[index % PART_HUES.length]} 62% 52%)`
}
