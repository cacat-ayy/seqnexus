/**
 * Knock-in: a donor for the selected guide.
 *
 * The arms are a slice of the original sequence, so the part worth showing is
 * what happened afterwards: whether the insert broke the site on its own, and
 * if not, which base was changed to stop the repaired copy being cut again
 * and whether that change left the protein alone.
 */

import { useMemo, useState } from 'react'
import { Copy, FileOutput } from 'lucide-react'
import { useEditorStore } from '../../../store'
import { designDonor, DEFAULT_KNOCKIN } from '../../../crispr/strategy/knockin'
import { donorDocument } from '../../../crispr/strategy/document'
import { cutPosition } from '../../../crispr/finder'
import { guideKey } from '../../../utils/guide-features'
import { displayPosition } from '../../../models/Document'
import { notify } from '../../../toast'
import TargetSelect from './TargetSelect'
import { SELECTION_VALUE, useChosenTarget } from './target'
import type { GuideCandidate, Nuclease } from '../../../crispr/types'

interface Props {
  candidates: readonly GuideCandidate[]
  nuclease: Nuclease
}

export default function KnockinTask({ candidates, nuclease }: Props) {
  const [payload, setPayload] = useState('')
  const [armLength, setArmLength] = useState(DEFAULT_KNOCKIN.armLength)
  const [asymmetric, setAsymmetric] = useState(false)
  const [block, setBlock] = useState(true)
  const [geneValue, setGeneValue] = useState(SELECTION_VALUE)
  const gene = useChosenTarget(geneValue)

  const doc = useEditorStore(s => s.doc)
  const selectedKey = useEditorStore(s => s.selectedGuideKey)
  const openDocumentState = useEditorStore(s => s.openDocumentState)
  const origin = doc.metadata?.displayOrigin ?? 0
  const at = (i: number) => displayPosition(i, origin, doc.sequence.length)

  const candidate = useMemo(
    () => candidates.find(c => guideKey(c.site) === selectedKey) ?? null,
    [candidates, selectedKey],
  )

  const donor = useMemo(() => {
    if (!candidate) return null
    const insertAt = cutPosition(candidate.site, doc.sequence.length, doc.sequence.topology === 'circular')
    return designDonor(candidate, doc.sequence.bases, payload, insertAt, nuclease, gene.coding, {
      armLength, asymmetric, blockRecut: block ? 'auto' : 'none',
    })
  }, [candidate, doc.sequence, payload, nuclease, gene.coding, armLength, asymmetric, block])

  return (
    <>
      <div className="gp-settings gp-settings-tight">
        <div className="gp-field gp-field-wide">
          <label htmlFor="gp-payload">What goes in</label>
          <textarea
            id="gp-payload"
            className="input gp-payload"
            value={payload}
            onChange={e => setPayload(e.target.value)}
            placeholder="Bases to insert at the cut. Leave empty for a donor that only changes the sequence."
            spellCheck={false}
            rows={3}
          />
        </div>
        <div className="gp-field">
          <label htmlFor="gp-arm">Arms</label>
          <select id="gp-arm" value={armLength} onChange={e => setArmLength(Number(e.target.value))}>
            {[30, 40, 60, 100, 200, 500].map(a => <option key={a} value={a}>{a} bp</option>)}
          </select>
        </div>
        <TargetSelect value={geneValue} onChange={setGeneValue} codingOnly label="Gene (for silent changes)" />
        <div className="gp-checks">
          <label className="gp-check" title="Make the arm on the far side from the PAM twice as long.">
            <input type="checkbox" checked={asymmetric} onChange={e => setAsymmetric(e.target.checked)} />
            Asymmetric arms
          </label>
          <label className="gp-check" title="Change one base so the repaired copy is not cut again.">
            <input type="checkbox" checked={block} onChange={e => setBlock(e.target.checked)} />
            Stop re-cutting
          </label>
        </div>
      </div>

      {!candidate && (
        <p className="gp-note gp-warn gp-note-row">
          Select a guide in the Find task, or on the sequence, and its cut becomes the insertion point.
        </p>
      )}

      {candidate && donor && (
        <div className="gi">
          <div className="gi-head">
            <span className="gi-title">Donor, {donor.donor.length} bp</span>
            <div className="gi-actions">
              <button
                className="btn btn-sm"
                onClick={() => {
                  navigator.clipboard.writeText(donor.donor)
                    .then(() => notify.success('Donor copied'))
                    .catch(() => notify.error('Could not copy the donor'))
                }}
              >
                <Copy size={12} /> Copy
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  openDocumentState(donorDocument(donor, doc.name, nuclease.name))
                  notify.success('Donor opened as a sequence')
                }}
              >
                <FileOutput size={12} /> Open
              </button>
            </div>
          </div>

          <div className="gi-seq gi-donor">
            <span className="gi-arm">{donor.leftArm}</span>
            <span className="gi-insert">{donor.payload}</span>
            <span className="gi-arm">{donor.rightArm}</span>
          </div>

          <dl className="gi-grid">
            <dt>Insert at</dt>
            <dd>{at(donor.insertAt)}, the cut of {donor.candidate.site.spacer}</dd>
            <dt>Arms</dt>
            <dd>{donor.leftArm.length} and {donor.rightArm.length} bp</dd>
            <dt>Re-cutting</dt>
            <dd>
              {!donor.wouldRecut
                ? 'the insert breaks the site, so nothing needed changing'
                : donor.block
                  ? `${donor.block.from} to ${donor.block.to} in the ${donor.block.where === 'pam' ? 'PAM' : 'seed'}`
                    + (donor.block.codon
                      ? donor.block.silent
                        ? `, silent at codon ${donor.block.codon.number}`
                        : `, codon ${donor.block.codon.number} ${donor.block.codon.aa} to ${donor.block.codon.toAa}`
                      : '')
                  : 'the site is still intact'}
            </dd>
          </dl>

          {donor.warnings.map(w => (
            <p key={w} className="gi-flag">
              <span className="gp-chip">note</span> {w}
            </p>
          ))}
        </div>
      )}
    </>
  )
}
