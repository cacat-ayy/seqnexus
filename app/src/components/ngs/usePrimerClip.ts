/** State of the "clip primers" option (PrimerClipField.tsx): on or off, and where the library's oligos bind. */

import { useMemo, useState } from 'react'
import { useEditorStore } from '../../store'
import { oligoSites } from '../../ngs/primerClip'

export interface PrimerClip {
  on: boolean
  setOn: (on: boolean) => void
  /** Where the oligos bind, per reference; null when off. */
  info: ReturnType<typeof oligoSites> | null
  oligoCount: number
}

export function usePrimerClip(refs: readonly { bases: string; circular: boolean }[]): PrimerClip {
  const oligos = useEditorStore(s => s.oligos)
  const [on, setOn] = useState(false)
  const info = useMemo(() => (on && refs.length ? oligoSites(oligos, refs) : null), [on, oligos, refs])
  return { on, setOn, info, oligoCount: oligos.length }
}
