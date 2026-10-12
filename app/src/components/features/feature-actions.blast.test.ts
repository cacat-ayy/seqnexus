import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '../../store'
import { useBlastStore } from '../../blast/session'
import { hitRangeOnDoc, placementOf } from '../../blast/query'
import { reverseComplement } from '../../models/complement'
import { blastFeatureProtein } from './feature-actions'

// MKVLAAGSTW, then a stop.
const CODING = 'ATGAAAGTTTTAGCTGCTGGTTCTACTTGGTAA'

function openWithCds(bases: string, strand: 1 | -1, qualifiers?: Record<string, string[]>) {
  const s = useEditorStore.getState()
  s.openDocument('cds test', bases)
  s.addAnnotation({ id: 'cds1', name: 'geneX', type: 'CDS', start: 5, end: 5 + CODING.length, strand, qualifiers })
  return useEditorStore.getState().doc.annotations.find(a => a.id === 'cds1')!
}

describe('blastFeatureProtein', () => {
  beforeEach(() => useBlastStore.setState({ translation: null, querySource: 'whole', open: false }))

  it('sends the translation without its stop, and maps residues back onto codons on the plus strand', () => {
    const ann = openWithCds(`CCCCC${CODING}GGGGG`, 1)
    blastFeatureProtein(ann)
    const t = useBlastStore.getState().translation!
    expect(t.protein).toBe('MKVLAAGSTW')
    expect(useBlastStore.getState().querySource).toBe('translation')
    expect(useBlastStore.getState().open).toBe(true)
    expect(hitRangeOnDoc(t.query, 1, 1)).toEqual({ start: 5, end: 8 })
    expect(hitRangeOnDoc(t.query, 10, 10)).toEqual({ start: 32, end: 35 })
    expect(placementOf(t.query, useEditorStore.getState().doc.sequence).ok).toBe(true)
  })

  it('reads a minus-strand CDS from its far end', () => {
    const ann = openWithCds(`CCCCC${reverseComplement(CODING)}GGGGG`, -1)
    blastFeatureProtein(ann)
    const t = useBlastStore.getState().translation!
    expect(t.protein).toBe('MKVLAAGSTW')
    // Residue 1 (the ATG) is the last codon on the top strand.
    expect(hitRangeOnDoc(t.query, 1, 1)).toEqual({ start: 35, end: 38 })
    expect(t.query.translation?.strand).toBe(-1)
  })

  it('skips the bases /codon_start skips', () => {
    const ann = openWithCds(`CCCCCA${CODING}GGGG`, 1, { codon_start: ['2'] })
    // The feature starts one base early; codon_start=2 puts the frame back.
    useEditorStore.getState().updateAnnotation('cds1', { end: 6 + CODING.length })
    blastFeatureProtein(useEditorStore.getState().doc.annotations.find(a => a.id === 'cds1') ?? ann)
    const t = useBlastStore.getState().translation!
    expect(t.protein).toBe('MKVLAAGSTW')
    expect(hitRangeOnDoc(t.query, 1, 1)).toEqual({ start: 6, end: 9 })
  })
})
