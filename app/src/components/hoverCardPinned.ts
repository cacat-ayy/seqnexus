/**
 * Whether a hover card's content is drawn in the pinned copy. A card can
 * show a compact summary on hover and its full detail once pinned, when
 * someone has stopped to read it.
 */

import { createContext, useContext } from 'react'

export const PinnedCardContext = createContext(false)

export function useInPinnedCard(): boolean {
  return useContext(PinnedCardContext)
}
