/**
 * The right-click menu of the sequence view and the plasmid map.
 *
 * One component so the two views offer the same actions under the same
 * names; they used to carry a copy each, and drifted (the map could not act
 * on primers at all).
 *
 * The menu opens with a two-line summary of what was clicked instead of the
 * full hover card: the card's bases and translation made the menu taller
 * than a laptop screen, and the same text is one Copy away. Rarely used
 * actions sit in submenus (Copy, New Primer, Origin) for the same reason.
 */

import { useEffect, type ReactNode } from 'react'
import {
  ClipboardPaste, Copy, Crosshair, ExternalLink, MoveLeft, MoveRight, PanelRight, Pencil, Replace,
  SquareDashedMousePointer, Tag, Trash2, TriangleAlert, Undo2,
} from 'lucide-react'
import { useEditorStore, selectionRange, selectionSegments } from '../store'
import type { Annotation } from '../models/Annotation'
import { reverseComplement as reverseComplementStr } from '../models/complement'
import { translate as translateSequenceStr } from '../utils/codon'
import { copyText, readText } from '../utils/clipboard'
import {
  annotationBases, annotationLength, annotationProtein, canTranslateAnnotation, translationIssues,
} from '../utils/annotation-sequence'
import { isAutoAnnotationId } from '../utils/auto-annotations'
import { oligoStructure, summarizeOligo, type PrimerItem } from '../primers/display'
import { structureGrade } from '../primers/secondary'
import { DESIGN_ROLES, designOligoId } from '../primers/usePrimerSites'
import { newPrimerId } from '../primers/oligo'
import { notify } from '../toast'
import ContextMenuPopup, { MenuItem, MenuSeparator, Submenu } from './ContextMenuPopup'
import type { GroupedCutSite } from '../enzymes/grouping'

export interface SequenceMenuTarget {
  x: number
  y: number
  /** Sequence position under the pointer, when there is one. */
  seqPos: number | null
  /** Feature or primer stand-in under the pointer. */
  annId: string | null
  enzymeGroup: GroupedCutSite | null
}

const ICON = 13

/** FASTA with 70 bases a line, as GenBank and most tools write it. */
function fasta(name: string, bases: string): string {
  const lines = bases.match(/.{1,70}/g) ?? []
  return `>${name.replace(/\s+/g, '_')}\n${lines.join('\n')}`
}

const fmtTm = (t: number | null) => (t === null || !Number.isFinite(t) ? '–' : `${t.toFixed(1)} °C`)

// ---------------------------------------------------------------------------
// Header: what was clicked, in two lines
// ---------------------------------------------------------------------------

function AnnotationHead({ ann }: { ann: Annotation }) {
  const sequence = useEditorStore(s => s.doc.sequence)
  const len = annotationLength(ann, sequence.length)
  const issues = translationIssues(ann, sequence)
  const strand = ann.strand === 1 ? ' · forward' : ann.strand === -1 ? ' · reverse' : ''
  return (
    <div className="ctx-menu-head">
      <div className="ctx-menu-head-title">
        <span className="ann-swatch" style={{ backgroundColor: ann.color }} />
        <span className="hc-name">{ann.name}</span>
        <span className="hc-chip">{ann.type}</span>
      </div>
      <div className="ctx-menu-head-meta">{ann.start + 1}..{ann.end} · {len} bp{strand}</div>
      {issues && (issues.internalStops > 0 || issues.leftover > 0) && (
        <div className="ctx-menu-head-warn">
          <TriangleAlert size={11} />
          {issues.internalStops > 0
            ? `${issues.internalStops} internal stop codon${issues.internalStops === 1 ? '' : 's'}`
            : 'Not a whole number of codons'}
        </div>
      )}
    </div>
  )
}

function PrimerHead({ item, siteCount }: { item: PrimerItem; siteCount: number }) {
  const sequence = useEditorStore(s => s.doc.sequence)
  const { primer, site, annotation } = item
  const s = summarizeOligo(primer, site, { bases: sequence.bases, topology: sequence.topology })
  const reference = s.tmAnneal ?? s.tmFull
  const { hairpin, dimer } = oligoStructure(primer.sequence)
  const warnings: string[] = []
  if (hairpin && structureGrade(hairpin.tm, reference, hairpin.threePrime) === 'poor') {
    warnings.push(`Hairpin ≈ ${hairpin.tm.toFixed(0)} °C`)
  }
  if (dimer && structureGrade(dimer.tm, reference, dimer.threePrime) === 'poor') {
    warnings.push(`Self-dimer ≈ ${dimer.tm.toFixed(0)} °C`)
  }
  if (siteCount > 1) warnings.push(`binds ${siteCount} sites`)
  return (
    <div className="ctx-menu-head">
      <div className="ctx-menu-head-title">
        <span className="ann-swatch" style={{ backgroundColor: annotation.color }} />
        <span className="hc-name">{primer.name}</span>
        <span className="hc-chip">{annotation.type}</span>
        {primer.role === 'probe' && <span className="hc-chip hc-chip-role">probe</span>}
      </div>
      <div className="ctx-menu-head-meta">
        {site.start + 1}..{site.end} {site.strand === 1 ? '(+)' : '(−)'} · {s.length} nt · Tm {fmtTm(reference)}
      </div>
      {warnings.length > 0 && (
        <div className="ctx-menu-head-warn"><TriangleAlert size={11} />{warnings.join(' · ')}</div>
      )}
    </div>
  )
}

const OVERHANG: Record<string, string> = { '5prime': '5′ overhang', '3prime': '3′ overhang', blunt: 'blunt' }

function EnzymeHead({ group }: { group: GroupedCutSite }) {
  const enzyme = group.sites[0].enzyme
  return (
    <div className="ctx-menu-head ctx-menu-head-enzyme">
      <div className="ctx-menu-head-title">
        <span className="hc-name">{group.label}</span>
        <span className="hc-chip">Enzyme</span>
      </div>
      <div className="ctx-menu-head-meta">
        {enzyme.recognition} · {group.recognitionStart + 1}..{group.recognitionEnd} · {OVERHANG[enzyme.overhang] ?? enzyme.overhang}
      </div>
      {group.methEffect && (
        <div className="ctx-menu-head-warn">
          <TriangleAlert size={11} />
          {group.methEffect === 'blocked' ? 'Blocked by methylation' : 'Impaired by methylation'}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------

export default function SequenceContextMenu({
  target, annotations, primerItemById, siteCountOf, onClose, onEditFeature, onAnnotateRequest, onDeleteAnnotation,
}: {
  target: SequenceMenuTarget
  /** Everything drawn as a feature: user features, ORFs, proposals. */
  annotations: readonly Annotation[]
  primerItemById: ReadonlyMap<string, PrimerItem>
  siteCountOf: (item: PrimerItem) => number
  onClose: () => void
  onEditFeature?: (annId: string) => void
  onAnnotateRequest?: () => void
  /** Ask before deleting; the confirm dialog belongs to the view. */
  onDeleteAnnotation: (ann: Annotation) => void
}) {
  const doc = useEditorStore(s => s.doc)
  const selection = useEditorStore(s => s.selection)
  const readOnly = useEditorStore(s => s.readOnly)
  const setSelection = useEditorStore(s => s.setSelection)

  // Close on a click outside, on scrolling anything but the menu itself,
  // and when the window loses focus or changes size.
  useEffect(() => {
    let downOutside = false
    const down = () => { downOutside = true }
    const up = () => { if (downOutside) onClose(); downOutside = false }
    const scroll = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('.ctx-menu')) return
      onClose()
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('mouseup', up)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const segs = selectionSegments(selection, doc.sequence.topology, doc.sequence.length)
  const hasSelection = segs.length > 0
  const primer = target.annId ? primerItemById.get(target.annId) ?? null : null
  const ann = target.annId && !primer ? annotations.find(a => a.id === target.annId) ?? null : null
  const isUserAnn = !!ann && !ann.id.startsWith('_orf_') && !isAutoAnnotationId(ann.id)
  const group = target.enzymeGroup
  const circular = doc.sequence.topology === 'circular'

  /** Run an action, then close. */
  const act = (fn: () => void) => () => { fn(); onClose() }

  const selectedBases = () => segs.map(([s, e]) => doc.sequence.basesIn(s, e)).join('')
  const selectionName = () => `${doc.name}_${segs[0][0] + 1}-${segs[segs.length - 1][1]}`
  const selectionLen = segs.reduce((n, [s, e]) => n + e - s, 0)
  const canMakePrimer = !readOnly && selectionLen >= 10 && selectionLen <= 200

  const pasteRevComp = () => {
    readText().then(text => {
      if (text === null) return // already reported
      const filtered = text.replace(/[^ATGCUatgcuRYSWKMBVDHNryswkmbvdhn]/g, '').toUpperCase()
      if (filtered.length === 0) return
      const rc = reverseComplementStr(filtered)
      const s = useEditorStore.getState()
      const range = selectionRange(s.selection)
      if (range) {
        s.replace(range[0], range[1], rc)
        s.setCaret(range[0] + rc.length)
      } else {
        s.insert(s.selection.caret, rc)
        s.setCaret(s.selection.caret + rc.length)
      }
    })
  }

  const addAnnotation = () => {
    // With nothing selected, select the clicked base so the form pre-fills it.
    if (!selectionRange(selection) && target.seqPos !== null) {
      setSelection({ anchor: target.seqPos, caret: Math.min(target.seqPos + 1, doc.sequence.length) })
    }
    onAnnotateRequest?.()
  }

  /** A new primer from the selection, read along the chosen strand. */
  const newPrimer = (strand: 1 | -1) => {
    const bases = selectedBases().toUpperCase()
    const oligo = strand === 1 ? bases : reverseComplementStr(bases)
    const s = useEditorStore.getState()
    const n = (s.doc.primers?.length ?? 0) + 1
    const id = newPrimerId()
    s.addPrimers([{ id, name: `Primer ${n}${strand === 1 ? 'F' : 'R'}`, sequence: oligo, role: 'primer' }])
    s.setFocusedPrimer(id)
  }

  const deletePrimer = (item: PrimerItem) => {
    useEditorStore.getState().removePrimers([item.primer.id])
    notify.success(`Deleted primer "${item.primer.name}"`, {
      action: { label: 'Undo', onClick: () => useEditorStore.getState().undo() },
    })
  }

  const discardPick = (item: PrimerItem) => {
    const s = useEditorStore.getState()
    const role = DESIGN_ROLES.find(r => designOligoId(r) === item.primer.id)
    if (role) s.setDesignPicks({ [role]: null })
    const batchIndex = /^design-batch-(\d+)$/.exec(item.primer.id)?.[1]
    if (batchIndex !== undefined) {
      s.setDesignBatch(s.primerDesign.batch.filter((_, i) => i !== Number(batchIndex)))
    }
  }

  const sections: ReactNode[] = []

  if (ann) {
    const translatable = canTranslateAnnotation(ann, doc.sequence)
    sections.push(
      <div key="ann" role="group" aria-label="Annotation">
        <MenuItem icon={<SquareDashedMousePointer size={ICON} />} onSelect={act(() => setSelection({ anchor: ann.start, caret: ann.end }))}>
          Select Annotation
        </MenuItem>
        <Submenu icon={<Copy size={ICON} />} label="Copy Annotation">
          <MenuItem onSelect={act(() => {
            const b = annotationBases(ann, doc.sequence)
            copyText(b, `Copied ${b.length} bp from "${ann.name}"`)
          })}>Bases</MenuItem>
          <MenuItem onSelect={act(() => {
            const b = reverseComplementStr(annotationBases(ann, doc.sequence))
            copyText(b, `Copied reverse complement of "${ann.name}"`)
          })}>Reverse Complement</MenuItem>
          {translatable && (
            <MenuItem onSelect={act(() => {
              const p = annotationProtein(ann, doc.sequence)
              copyText(p, `Copied ${p.length} aa from "${ann.name}"`)
            })}>Amino Acid Sequence</MenuItem>
          )}
          <MenuItem onSelect={act(() => copyText(fasta(ann.name, annotationBases(ann, doc.sequence)), `Copied "${ann.name}" as FASTA`))}>
            FASTA
          </MenuItem>
        </Submenu>
        {isUserAnn && !readOnly && (
          <MenuItem icon={<Pencil size={ICON} />} shortcut="Double-click" onSelect={act(() => {
            useEditorStore.getState().setEditAnnotation(ann.id)
            onEditFeature?.(ann.id)
          })}>Edit Annotation…</MenuItem>
        )}
        {isUserAnn && !readOnly && ann.type === 'primer_bind' && (
          <MenuItem icon={<Replace size={ICON} />} onSelect={act(() => useEditorStore.getState().convertFeaturesToPrimers([ann.id]))}>
            Convert to Primer
          </MenuItem>
        )}
        {isUserAnn && !readOnly && (
          <MenuItem icon={<Trash2 size={ICON} />} danger onSelect={act(() => onDeleteAnnotation(ann))}>
            Delete Annotation
          </MenuItem>
        )}
      </div>,
    )
  }

  if (primer) {
    const tailed = primer.site.tail5.length > 0 || primer.site.tail3.length > 0
    const annealed = primer.primer.sequence.slice(primer.site.annealFrom, primer.site.annealTo)
    sections.push(
      <div key="primer" role="group" aria-label="Primer">
        <MenuItem icon={<SquareDashedMousePointer size={ICON} />} onSelect={act(() => setSelection({ anchor: primer.site.start, caret: primer.site.end }))}>
          Select Binding Site
        </MenuItem>
        <Submenu icon={<Copy size={ICON} />} label="Copy Oligo">
          <MenuItem onSelect={act(() => copyText(primer.primer.sequence, `Copied ${primer.primer.name} (${primer.primer.sequence.length} nt)`))}>
            Sequence (5′→3′)
          </MenuItem>
          {tailed && (
            <MenuItem onSelect={act(() => copyText(annealed, `Copied annealed part of ${primer.primer.name} (${annealed.length} nt)`))}>
              Annealed Part Only
            </MenuItem>
          )}
          <MenuItem onSelect={act(() => copyText(fasta(primer.primer.name, primer.primer.sequence), `Copied ${primer.primer.name} as FASTA`))}>
            FASTA
          </MenuItem>
        </Submenu>
        <MenuItem icon={<PanelRight size={ICON} />} shortcut="Double-click" onSelect={act(() => {
          if (primer.preview) useEditorStore.getState().openSidebar('primers', 'design')
          else useEditorStore.getState().setFocusedPrimer(primer.primer.id)
        })}>
          {primer.preview ? 'Show in Primer Design' : 'Show in Primers Panel'}
        </MenuItem>
        {!readOnly && !primer.preview && (
          <MenuItem icon={<Trash2 size={ICON} />} danger onSelect={act(() => deletePrimer(primer))}>
            Delete Primer
          </MenuItem>
        )}
        {primer.preview && (
          <MenuItem icon={<Undo2 size={ICON} />} onSelect={act(() => discardPick(primer))}>
            Discard Pick
          </MenuItem>
        )}
      </div>,
    )
  }

  if (group) {
    const enzyme = group.sites[0].enzyme
    sections.push(
      <div key="enzyme" role="group" aria-label="Enzyme">
        <MenuItem icon={<SquareDashedMousePointer size={ICON} />} onSelect={act(() => setSelection({ anchor: group.recognitionStart, caret: group.recognitionEnd }))}>
          Select Recognition Site
        </MenuItem>
        <MenuItem icon={<Copy size={ICON} />} onSelect={act(() => copyText(enzyme.recognition, `Copied ${enzyme.recognition}`))}>
          Copy Recognition Sequence
        </MenuItem>
        <MenuItem icon={<ExternalLink size={ICON} />} onSelect={act(() => {
          window.open(`https://www.google.com/search?q=${encodeURIComponent(enzyme.name + ' restriction enzyme')}`, '_blank')
        })}>
          Look Up Enzyme…
        </MenuItem>
      </div>,
    )
  }

  if (hasSelection) {
    sections.push(
      <div key="selection" role="group" aria-label="Selection">
        <Submenu icon={<Copy size={ICON} />} label={`Copy Selection (${selectionLen} bp)`}>
          <MenuItem shortcut="Ctrl+C" onSelect={act(() => {
            const b = selectedBases()
            copyText(b, `Copied ${b.length} bp`)
          })}>Bases</MenuItem>
          <MenuItem onSelect={act(() => {
            const t = reverseComplementStr(selectedBases())
            copyText(t, `Copied reverse complement (${t.length} bp)`)
          })}>Reverse Complement</MenuItem>
          <MenuItem onSelect={act(() => {
            const p = translateSequenceStr(selectedBases())
            copyText(p, `Copied protein (${p.length} aa)`)
          })}>Protein Translation</MenuItem>
          <MenuItem onSelect={act(() => copyText(fasta(selectionName(), selectedBases()), 'Copied selection as FASTA'))}>
            FASTA
          </MenuItem>
        </Submenu>
        {canMakePrimer && (
          <Submenu icon={<MoveRight size={ICON} />} label="New Primer from Selection">
            <MenuItem icon={<MoveRight size={ICON} />} onSelect={act(() => newPrimer(1))}>Forward</MenuItem>
            <MenuItem icon={<MoveLeft size={ICON} />} onSelect={act(() => newPrimer(-1))}>Reverse</MenuItem>
          </Submenu>
        )}
      </div>,
    )
  }

  const canAnnotate = !!onAnnotateRequest && (hasSelection || target.seqPos !== null)
  if (!readOnly) {
    sections.push(
      <div key="edit" role="group" aria-label="Edit">
        <MenuItem icon={<ClipboardPaste size={ICON} />} onSelect={act(pasteRevComp)}>
          Paste Reverse Complement
        </MenuItem>
        {canAnnotate && (
          <MenuItem icon={<Tag size={ICON} />} onSelect={act(addAnnotation)}>
            {hasSelection ? 'Add Annotation to Selection…' : 'Add Annotation Here…'}
          </MenuItem>
        )}
      </div>,
    )
  }

  if (circular && !hasSelection && target.seqPos !== null) {
    const pos = target.seqPos
    sections.push(
      <div key="origin" role="group" aria-label="Origin">
        <Submenu icon={<Crosshair size={ICON} />} label={`Origin at ${pos + 1}`}>
          <MenuItem onSelect={act(() => useEditorStore.getState().setDisplayOrigin(pos))}
            title="Draw the sequence starting here; numbering is unchanged">
            Set Display Origin Here
          </MenuItem>
          <MenuItem onSelect={act(() => useEditorStore.getState().rotateOrigin(pos))}
            title="Renumber the sequence so this base is 1">
            Set as Position 1
          </MenuItem>
        </Submenu>
      </div>,
    )
  }

  const label = primer?.primer.name ?? ann?.name ?? group?.label ?? 'Sequence'
  return (
    <ContextMenuPopup x={target.x} y={target.y} onClose={onClose} label={`${label} actions`}>
      {primer && <PrimerHead item={primer} siteCount={siteCountOf(primer)} />}
      {ann && <AnnotationHead ann={ann} />}
      {group && <EnzymeHead group={group} />}
      {sections.flatMap((section, i) => (i === 0 ? [section] : [<MenuSeparator key={`sep${i}`} />, section]))}
    </ContextMenuPopup>
  )
}
