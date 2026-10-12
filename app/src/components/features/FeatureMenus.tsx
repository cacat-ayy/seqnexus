/**
 * The feature panel's right-click menus: one for a feature, one for a type
 * group. Built on the shared ContextMenuPopup, so they take focus, run on
 * the arrow keys and close on Escape like the sequence view's menu; and
 * since the popup is a role="menu", the sequence editor leaves its keys
 * alone while it is open.
 */

import {
  Atom, CopyPlus, Copy, Eye, EyeOff, Globe, Palette, Pencil, RotateCcw, SquareDashedMousePointer,
  TextCursorInput, Trash2, ZoomIn, ListChecks,
} from 'lucide-react'
import ContextMenuPopup, { MenuItem, MenuSeparator, Submenu } from '../ContextMenuPopup'
import { useEditorStore } from '../../store'
import { defaultColorForType, type Annotation } from '../../models/Annotation'
import { reverseComplement } from '../../models/complement'
import { annotationBases, annotationProtein, canTranslateAnnotation } from '../../utils/annotation-sequence'
import { copyText } from '../../utils/clipboard'
import { blastFeature, blastFeatureProtein, duplicateFeature, selectAndCenterFeature, zoomToFeature } from './feature-actions'

const ICON = 13

/** FASTA with 70 bases a line, as GenBank and most tools write it. */
function fasta(name: string, bases: string): string {
  const lines = bases.match(/.{1,70}/g) ?? []
  return `>${name.replace(/\s+/g, '_')}\n${lines.join('\n')}`
}

export function FeatureContextMenu({ x, y, ann, hidden, readOnly, onClose, onEdit, onRename, onDelete, onDuplicated }: {
  x: number
  y: number
  ann: Annotation
  hidden: boolean
  readOnly: boolean
  onClose: () => void
  onEdit: () => void
  onRename: () => void
  onDelete: () => void
  onDuplicated: (id: string) => void
}) {
  const sequence = useEditorStore(s => s.doc.sequence)
  const protein = sequence.alphabet === 'protein'
  const unit = protein ? 'aa' : 'bp'
  const translatable = canTranslateAnnotation(ann, sequence)
  const act = (fn: () => void) => () => { fn(); onClose() }

  return (
    <ContextMenuPopup x={x} y={y} onClose={onClose} label={`Feature ${ann.name}`}>
      <MenuItem icon={<SquareDashedMousePointer size={ICON} />} onSelect={act(() => selectAndCenterFeature(ann))}>
        Select
      </MenuItem>
      <MenuItem icon={<ZoomIn size={ICON} />} onSelect={act(() => zoomToFeature(ann))}>
        Zoom To
      </MenuItem>
      {!readOnly && (
        <>
          <MenuItem icon={<Pencil size={ICON} />} shortcut="Enter" onSelect={act(onEdit)}>Edit…</MenuItem>
          <MenuItem icon={<TextCursorInput size={ICON} />} shortcut="F2" onSelect={act(onRename)}>Rename</MenuItem>
        </>
      )}
      <MenuSeparator />
      <Submenu icon={<Copy size={ICON} />} label="Copy">
        <MenuItem onSelect={act(() => copyText(ann.name, `Copied "${ann.name}"`))}>Name</MenuItem>
        <MenuItem shortcut="Ctrl+C" onSelect={act(() => {
          const b = annotationBases(ann, sequence)
          copyText(b, `Copied ${b.length} ${unit} from "${ann.name}"`)
        })}>{protein ? 'Residues' : 'Bases'}</MenuItem>
        {!protein && (
          <MenuItem onSelect={act(() => {
            const b = reverseComplement(annotationBases(ann, sequence))
            copyText(b, `Copied reverse complement of "${ann.name}"`)
          })}>Reverse Complement</MenuItem>
        )}
        {translatable && (
          <MenuItem onSelect={act(() => {
            const p = annotationProtein(ann, sequence)
            copyText(p, `Copied ${p.length} aa from "${ann.name}"`)
          })}>Amino Acid Sequence</MenuItem>
        )}
        <MenuItem onSelect={act(() => copyText(fasta(ann.name, annotationBases(ann, sequence)), `Copied "${ann.name}" as FASTA`))}>
          FASTA
        </MenuItem>
      </Submenu>
      {translatable && (
        <MenuItem icon={<Atom size={ICON} />} onSelect={act(() => useEditorStore.getState().translateToProtein({ annotation: ann }))}
          title="Open the feature's protein as a document of its own, linked back to these codons">
          Open as Protein
        </MenuItem>
      )}
      <MenuItem icon={<Globe size={ICON} />} onSelect={act(() => blastFeature(ann))}
        title="Search NCBI with this feature's sequence">
        BLAST…
      </MenuItem>
      {translatable && (
        <MenuItem icon={<Globe size={ICON} />} onSelect={act(() => blastFeatureProtein(ann))}
          title="Search NCBI's proteins with this feature's translation (blastp)">
          BLAST protein…
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon={hidden ? <Eye size={ICON} /> : <EyeOff size={ICON} />}
        onSelect={act(() => useEditorStore.getState().toggleAnnotationVisibility(ann.id))}>
        {hidden ? 'Show' : 'Hide'}
      </MenuItem>
      {!readOnly && (
        <>
          <MenuItem icon={<CopyPlus size={ICON} />} onSelect={act(() => onDuplicated(duplicateFeature(ann)))}>
            Duplicate
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 size={ICON} />} danger shortcut="Del" onSelect={act(onDelete)}>
            Delete
          </MenuItem>
        </>
      )}
    </ContextMenuPopup>
  )
}

/**
 * A type group's menu. Recolouring the whole group lives here rather than on
 * the group's swatch, where one stray click used to repaint every feature of
 * the type.
 */
export function GroupContextMenu({ x, y, type, anns, allHidden, readOnly, onClose, onRecolor, onPickAll, onDeleteAll }: {
  x: number
  y: number
  type: string
  anns: readonly Annotation[]
  allHidden: boolean
  readOnly: boolean
  onClose: () => void
  /** Opens the group's colour picker. */
  onRecolor: () => void
  onPickAll: () => void
  onDeleteAll: () => void
}) {
  const act = (fn: () => void) => () => { fn(); onClose() }
  const fallback = defaultColorForType(type)
  const allDefault = anns.every(a => a.color.toLowerCase() === fallback.toLowerCase())
  const n = anns.length

  return (
    <ContextMenuPopup x={x} y={y} onClose={onClose} label={`${type} features`}>
      {!readOnly && (
        <>
          <MenuItem icon={<Palette size={ICON} />} onSelect={act(onRecolor)}>
            Recolor All {n === 1 ? '' : `${n} `}{type}…
          </MenuItem>
          {!allDefault && (
            <MenuItem icon={<RotateCcw size={ICON} />}
              onSelect={act(() => useEditorStore.getState().updateAnnotations(anns.map(a => a.id), { color: fallback }))}
              title={`Give every ${type} the default ${type} color`}>
              Reset to Default Color
            </MenuItem>
          )}
          <MenuSeparator />
        </>
      )}
      <MenuItem icon={<ListChecks size={ICON} />} onSelect={act(onPickAll)}>Select All in Group</MenuItem>
      <MenuItem icon={allHidden ? <Eye size={ICON} /> : <EyeOff size={ICON} />}
        onSelect={act(() => useEditorStore.getState().setTypeVisibility(type, allHidden))}>
        {allHidden ? 'Show All' : 'Hide All'}
      </MenuItem>
      {!readOnly && (
        <>
          <MenuSeparator />
          <MenuItem icon={<Trash2 size={ICON} />} danger onSelect={act(onDeleteAll)}>
            Delete All {n === 1 ? '' : `${n} `}{type}…
          </MenuItem>
        </>
      )}
    </ContextMenuPopup>
  )
}
