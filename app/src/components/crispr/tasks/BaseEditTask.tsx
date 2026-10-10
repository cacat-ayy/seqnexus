/**
 * Base editing: which guides put the base you want in the editor's window,
 * and what else they change while they are there.
 *
 * The bystanders are the point of this view. A guide that makes the edit you
 * asked for and three more is not the same guide as one that makes only
 * yours, and no single score says so, which is why each edit is listed with
 * what it does to the protein.
 */

import { useMemo, useState } from 'react'
import { useEditorStore } from '../../../store'
import { planBaseEdits, EDITORS, editorById } from '../../../crispr/strategy/baseedit'
import { guideKey } from '../../../utils/guide-features'
import { displayPosition } from '../../../models/Document'
import { selectionRange } from '../../../models/selection'
import GuideRow from '../GuideRow'
import TargetSelect from './TargetSelect'
import { SELECTION_VALUE, useChosenTarget } from './target'
import type { GuideCandidate, Nuclease } from '../../../crispr/types'

interface Props {
  candidates: readonly GuideCandidate[]
  nuclease: Nuclease
  onSelect: (candidate: GuideCandidate, e: React.MouseEvent) => void
}

export default function BaseEditTask({ candidates, nuclease, onSelect }: Props) {
  const [editorId, setEditorId] = useState(EDITORS[0].id)
  const [useSelection, setUseSelection] = useState(true)
  const [geneValue, setGeneValue] = useState(SELECTION_VALUE)
  const gene = useChosenTarget(geneValue)
  const doc = useEditorStore(s => s.doc)
  const selection = useEditorStore(s => s.selection)
  const picks = useEditorStore(s => s.guidePicks)
  const selectedKey = useEditorStore(s => s.selectedGuideKey)
  const reports = useEditorStore(s => s.offTargetReports)
  const origin = doc.metadata?.displayOrigin ?? 0
  const at = (i: number) => displayPosition(i, origin, doc.sequence.length)

  const editor = editorById(editorId) ?? EDITORS[0]
  const range = selectionRange(selection)
  // One selected base is the base to change; a wider selection is just a region.
  const targetBase = useSelection && range && range[1] - range[0] === 1 ? range[0] : undefined

  // Asking for guides that reach one base, without having said which base,
  // is not a question with an answer: the list waits rather than showing
  // every guide as though they all qualified.
  const waiting = useSelection && targetBase === undefined
  const picksList = useMemo(
    () => (waiting ? [] : planBaseEdits(candidates, editor, doc.sequence.bases, nuclease, {
      target: targetBase,
      coding: gene.coding,
    })),
    [waiting, candidates, editor, doc.sequence.bases, nuclease, targetBase, gene.coding],
  )

  return (
    <>
      <div className="gp-settings gp-settings-tight">
        <div className="gp-field gp-field-wide">
          <label htmlFor="gp-editor">Editor</label>
          <select id="gp-editor" value={editorId} onChange={e => setEditorId(e.target.value)}>
            {EDITORS.map(ed => (
              <option key={ed.id} value={ed.id}>
                {ed.name}, positions {ed.window[0]} to {ed.window[1]}
              </option>
            ))}
          </select>
        </div>
        <TargetSelect value={geneValue} onChange={setGeneValue} codingOnly label="Gene (for consequences)" />
        <div className="gp-checks">
          <label className="gp-check" title="Select exactly one base to say which one you want changed.">
            <input type="checkbox" checked={useSelection} onChange={e => setUseSelection(e.target.checked)} />
            Only guides reaching the selected base
          </label>
        </div>
        <p className="gp-note">
          Positions count from the end of the protospacer away from the PAM. Every {editor.from} in the window is
          changed, not only the one you want, so the others are listed as bystanders.
        </p>
      </div>

      <div className="gp-status">
        <span className="gp-status-count">
          {picksList.length} guide{picksList.length === 1 ? '' : 's'}
          {targetBase !== undefined && <span className="gp-faint">reaching {at(targetBase)}</span>}
          {useSelection && targetBase === undefined && <span className="gp-warn">select one base</span>}
        </span>
      </div>

      <ul className="gp-list">
        {picksList.slice(0, 200).map(pick => {
          const key = guideKey(pick.candidate.site)
          return (
            <GuideRow
              key={key}
              candidate={pick.candidate}
              nuclease={nuclease}
              at={at}
              selected={key === selectedKey}
              picked={picks.has(key)}
              specificity={reports[key]?.specificity}
              onClick={onSelect}
              extra={
                <div className="gp-why">
                  {pick.edits.map(edit => (
                    <span
                      key={edit.position}
                      className={edit.bystander ? 'gp-why-plain' : 'gp-why-good'}
                      title={edit.consequence
                        ? `codon ${edit.consequence.codon}: ${edit.consequence.fromAa} to ${edit.consequence.toAa}`
                        : 'outside any coding feature'}
                    >
                      {edit.from} to {edit.to} at {edit.position}
                      {edit.consequence && edit.consequence.kind !== 'silent'
                        ? ` (${edit.consequence.fromAa}${edit.consequence.codon}${edit.consequence.toAa})`
                        : edit.consequence ? ' (silent)' : ''}
                    </span>
                  ))}
                  {pick.warnings.map(w => <span key={w} className="gp-why-warn">{w}</span>)}
                </div>
              }
            />
          )
        })}
        {picksList.length === 0 && (
          <li className="gp-empty">
            {useSelection && targetBase === undefined
              ? 'Select a single base to edit.'
              : `No guide puts an ${editor.from} in this editor's window here.`}
          </li>
        )}
      </ul>
    </>
  )
}
