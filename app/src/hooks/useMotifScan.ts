import { useEffect } from 'react'
import { useEditorStore } from '../store'
import { scanMotifs, type MotifHit } from '../protein/motifs'
import { transmembraneSegments } from '../protein/scales'
import { chouFasman } from '../protein/secondary'

/** The hydropathy rule's hits ride the motif overlay, as one more category. */
export const TM_MOTIF_ID = 'tm-hydropathy'
/** So do the Chou-Fasman helices and strands. */
export const CF_HELIX_ID = 'cf-helix'
export const CF_STRAND_ID = 'cf-strand'

/** Predicted helices and strands as motif hits; provisional like the membrane spans. */
export function secondaryStructureHits(residues: string): MotifHit[] {
  return chouFasman(residues).map(s => ({
    motifId: s.kind === 'helix' ? CF_HELIX_ID : CF_STRAND_ID,
    name: s.kind === 'helix' ? 'Helix (Chou-Fasman)' : 'Strand (Chou-Fasman)',
    category: 'Structural',
    type: 'Region',
    // Feature colours, data as in the library: helix red-orange, strand amber.
    color: s.kind === 'helix' ? '#f06595' : '#fab005',
    start: s.start, end: s.end,
    sequence: residues.slice(s.start, s.end).toUpperCase(),
  }))
}

/** Kyte-Doolittle membrane spans as motif hits, so the overlay and the panel show them beside the patterns. */
export function transmembraneHits(residues: string): MotifHit[] {
  return transmembraneSegments(residues).map(([start, end]) => ({
    motifId: TM_MOTIF_ID,
    name: 'Membrane span (hydropathy)',
    category: 'Structural',
    type: 'transmembrane',
    color: '#74b816', // the transmembrane feature colour, data as in the library
    start, end,
    sequence: residues.slice(start, end).toUpperCase(),
  }))
}

/**
 * Keep the motif hits in step with the protein, whenever the overlay or the
 * panel wants them. A regular-expression scan of a short protein against a
 * few dozen patterns is cheap, so it runs on the residues themselves (a
 * substitution moves a site) rather than on the length as the library scan
 * does. A DNA document has no motifs: its hits are cleared.
 */
export function useMotifScan(panelOpen: boolean): void {
  const showMotifs = useEditorStore(s => s.showMotifs)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const protein = useEditorStore(s => s.doc.sequence.alphabet === 'protein')
  const bases = useEditorStore(s => (protein ? s.doc.sequence.bases : ''))
  const wanted = (showMotifs || panelOpen) && protein

  useEffect(() => {
    const store = useEditorStore.getState()
    if (!wanted) {
      if (store.motifResults.length > 0) store.setMotifResults([])
      return
    }
    const hits = [...scanMotifs(bases), ...transmembraneHits(bases), ...secondaryStructureHits(bases)]
      .sort((a, b) => a.start - b.start || a.end - b.end)
    store.setMotifResults(hits)
  }, [wanted, activeTabId, bases])
}
