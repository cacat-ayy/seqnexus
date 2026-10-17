/**
 * Prime editing: the pegRNA for a guide and an edit.
 *
 * The edit is taken from the selection and a box saying what replaces it,
 * which covers a substitution, an insertion and a deletion without asking
 * which of the three it is. The tail is shown in its three pieces, because
 * the one thing worth checking by eye is that the template really carries
 * the change and really continues past it.
 */

import { useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { useEditorStore } from '../../../store'
import {
  designPegRna,
  editedSequence,
  nickingGuides,
  pe3bGuides,
  describeEdit,
  DEFAULT_PEG,
  NICK_BAND,
  PBS_BAND,
} from '../../../crispr/pegrna'
import { findGuideSites } from '../../../crispr/finder'
import { scoreSites } from '../../../crispr/score/guide'
import { MAX_PAM, MAX_SPACER } from '../../../crispr/nucleases'
import { defaultScaffold, scaffoldsFor } from '../../../crispr/scaffolds'
import { guideKey } from '../../../utils/guide-features'
import { displayPosition } from '../../../models/Document'
import { selectionRange } from '../../../models/selection'
import { notify } from '../../../toast'
import type { GuideCandidate, Nuclease } from '../../../crispr/types'

interface Props {
  candidates: readonly GuideCandidate[]
  nuclease: Nuclease
}

export default function PrimeEditTask({ candidates, nuclease }: Props) {
  const [replacement, setReplacement] = useState('')
  const [pbsLength, setPbsLength] = useState(DEFAULT_PEG.pbsLength)
  const [homology, setHomology] = useState(DEFAULT_PEG.homologyAfterEdit)

  const doc = useEditorStore(s => s.doc)
  const selection = useEditorStore(s => s.selection)
  const selectedKey = useEditorStore(s => s.selectedGuideKey)
  const setSelectedKey = useEditorStore(s => s.setSelectedGuideKey)
  const setSelection = useEditorStore(s => s.setSelection)
  const customScaffolds = useEditorStore(s => s.customScaffolds)
  const scaffoldId = useEditorStore(s => s.crisprScaffoldId)
  const setOrderParams = useEditorStore(s => s.setOrderParams)
  const origin = doc.metadata?.displayOrigin ?? 0
  const at = (i: number) => displayPosition(i, origin, doc.sequence.length)

  const offered = scaffoldsFor(nuclease, customScaffolds)
  const scaffold = offered.find(s => s.id === scaffoldId) ?? defaultScaffold(nuclease, customScaffolds)

  const candidate = useMemo(
    () => candidates.find(c => guideKey(c.site) === selectedKey) ?? null,
    [candidates, selectedKey],
  )
  const range = selectionRange(selection)
  const editStart = range?.[0] ?? null
  const editEnd = range?.[1] ?? null
  const edit = useMemo(
    () => (editStart !== null && editEnd !== null
      ? { start: editStart, end: editEnd, replacement: replacement.toUpperCase().replace(/[^ACGT]/g, '') }
      : null),
    [editStart, editEnd, replacement],
  )

  const peg = useMemo(() => {
    if (!candidate || !edit || !scaffold) return null
    return designPegRna(candidate, doc.sequence.bases, edit, {
      pbsLength, homologyAfterEdit: homology, scaffold: scaffold.sequence,
    })
  }, [candidate, edit, scaffold, doc.sequence.bases, pbsLength, homology])

  const nicks = useMemo(() => {
    if (!peg || !edit) return []
    const molecule = { length: doc.sequence.length, topology: doc.sequence.topology }
    const plain = nickingGuides(candidates, peg, undefined, molecule)
    // PE3b: the same question asked of the sequence as it will read once the
    // edit is in. Only the stretch around the edit is scanned, since a guide
    // that does not touch the edit is already in the list above.
    const edited = editedSequence(doc.sequence.bases, edit)
    const reach = NICK_BAND.high + edit.replacement.length + MAX_SPACER + MAX_PAM
    const region = {
      start: Math.max(0, edit.start - reach),
      end: Math.min(edited.length, edit.start + reach),
    }
    const scan = findGuideSites(edited, nuclease, doc.sequence.topology, { region })
    const pe3b = pe3bGuides(
      scoreSites(scan.sites, nuclease, edited, doc.sequence.topology),
      peg,
      edit,
      undefined,
      { ...molecule, length: edited.length },
    )
    // A spacer offered by both is not a PE3b guide: it matches either way.
    const seen = new Set(plain.map(n => n.candidate.site.spacer))
    return [...pe3b.filter(n => !seen.has(n.candidate.site.spacer)), ...plain].slice(0, 6)
  }, [candidates, peg, edit, nuclease, doc.sequence.bases, doc.sequence.length, doc.sequence.topology])

  return (
    <>
      <div className="gp-settings gp-settings-tight">
        <div className="gp-field gp-field-wide">
          <label htmlFor="gp-peg-repl">
            {range
              ? `Replace ${at(range[0])}..${at(range[1] - 1)} with`
              : 'Select what to change, then say what replaces it'}
          </label>
          <input
            id="gp-peg-repl"
            className="input gp-payload"
            value={replacement}
            onChange={e => setReplacement(e.target.value)}
            placeholder="Bases, or leave empty to delete the selection"
            spellCheck={false}
          />
        </div>
        <div className="gp-field">
          <label htmlFor="gp-pbs">Primer site</label>
          <select id="gp-pbs" value={pbsLength} onChange={e => setPbsLength(Number(e.target.value))}>
            {Array.from({ length: PBS_BAND.high - PBS_BAND.low + 1 }, (_, i) => PBS_BAND.low + i).map(n => (
              <option key={n} value={n}>{n} nt</option>
            ))}
          </select>
        </div>
        <div className="gp-field">
          <label htmlFor="gp-hom">Past the edit</label>
          <select id="gp-hom" value={homology} onChange={e => setHomology(Number(e.target.value))}>
            {[5, 8, 10, 12, 16, 20, 30].map(n => <option key={n} value={n}>{n} nt</option>)}
          </select>
        </div>
        <div className="gp-field gp-field-wide">
          <label htmlFor="gp-peg-scaffold">Scaffold</label>
          <select
            id="gp-peg-scaffold"
            value={scaffold?.id ?? ''}
            onChange={e => setOrderParams({ crisprScaffoldId: e.target.value })}
          >
            {offered.length === 0 && <option value="">None ships for this nuclease</option>}
            {offered.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <p className="gp-note">
          A nickase is what prime editing uses. The tail is written after the scaffold and reads as the reverse
          complement of the strand that gets made.
        </p>
      </div>

      {!candidate && (
        <p className="gp-note gp-warn gp-note-row">
          Select a guide, in the Find task or on the sequence. Its nick is where the copying starts.
        </p>
      )}
      {candidate && !edit && (
        <p className="gp-note gp-warn gp-note-row">Select the bases to change.</p>
      )}
      {candidate && edit && !peg && (
        <p className="gp-note gp-warn gp-note-row">
          This guide cannot write that edit: the template is copied from the nick onwards, and the selection is
          behind it. Pick a guide that nicks before the change.
        </p>
      )}

      {peg && (
        <div className="gi">
          <div className="gi-head">
            <span className="gi-title">pegRNA, {peg.sequence.length} nt</span>
            <div className="gi-actions">
              <button
                className="btn btn-sm"
                onClick={() => {
                  navigator.clipboard.writeText(peg.sequence)
                    .then(() => notify.success('pegRNA copied'))
                    .catch(() => notify.error('Could not copy it'))
                }}
              >
                <Copy size={12} /> Copy
              </button>
            </div>
          </div>

          <div className="gi-seq gi-donor">
            <span className="gi-peg-spacer">{peg.spacer}</span>
            <span className="gi-arm">{peg.scaffold}</span>
            <span className="gi-insert">{peg.template}</span>
            <span className="gi-peg-pbs">{peg.pbs}</span>
          </div>

          <dl className="gi-grid">
            <dt>Edit</dt>
            <dd>{describeEdit(peg.edit, doc.sequence.bases)}</dd>
            <dt>Nick</dt>
            <dd>after {at(peg.nick - 1)}, on the {peg.candidate.site.strand === 1 ? 'sense' : 'antisense'} strand</dd>
            <dt>Template</dt>
            <dd>{peg.template.length} nt, {peg.homology} past the edit</dd>
            <dt>Primer site</dt>
            <dd>{peg.pbs.length} nt</dd>
          </dl>

          {peg.warnings.map(w => (
            <p key={w} className="gi-flag"><span className="gp-chip">note</span> {w}</p>
          ))}

          <div className="gi-section">
            <div className="gi-section-title">Second nick</div>
            {nicks.length === 0 ? (
              <p className="gi-caveat">
                No guide nicks the other strand in the usual band. The edit can still be made with the pegRNA alone.
              </p>
            ) : (<></>)}
            {nicks.some(n => n.pe3b) && (
              <p className="gi-caveat">
                A PE3b guide only matches once the edit is in, so the second nick waits for it. That is the
                strategy to prefer: with PE3 both nicks can be open at once, which is what leaves indels behind.
              </p>
            )}
            {nicks.length > 0 && (
              <ul className="gp-list gp-list-inline">
                {nicks.map(n => (
                  <li
                    key={guideKey(n.candidate.site)}
                    className="gp-row"
                    onClick={() => {
                      setSelectedKey(guideKey(n.candidate.site))
                      setSelection({ anchor: n.candidate.site.start, caret: n.candidate.site.end })
                    }}
                  >
                    <div className="gp-row-main">
                      <span className="gp-pos">{at(n.candidate.site.start)}{n.candidate.site.strand === 1 ? '+' : '-'}</span>
                      <span className="gp-seq"><span className="gp-spacer-seq">{n.candidate.site.spacer}</span></span>
                    </div>
                    <div className="gp-scores">
                      <span>{n.distance} nt away</span>
                      {n.pe3b && <span className="gp-chip note">PE3b</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  )
}
