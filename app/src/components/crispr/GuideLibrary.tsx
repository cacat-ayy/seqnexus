/**
 * Guides you have kept, and whether they are any use here.
 *
 * The list is the library; the badge on each row is the answer to the only
 * question worth asking about a saved guide in front of a new sequence,
 * which is whether it binds this one. Scores are shown as what they were
 * when the guide was kept, because that is what they are.
 *
 * Scaffolds live here too. They belong to a vector rather than to a target,
 * so this is where one is pasted in and kept, and the order task then offers
 * it like any shipped one. Opening one shows the sequence, because the
 * section asks you to check it against the plasmid on your bench and that is
 * impossible without seeing it.
 */

import { useState } from 'react'
import { ClipboardCopy, Copy, Crosshair, Plus, Trash2, X } from 'lucide-react'
import { useEditorStore } from '../../store'
import { useLibraryMatches, libraryCsv } from '../../crispr/library'
import { customScaffold, SCAFFOLDS } from '../../crispr/scaffolds'
import { builtInNuclease } from '../../crispr/nucleases'
import { displayPosition } from '../../models/Document'
import { notify } from '../../toast'
import Chevron from '../Chevron'

export default function GuideLibrary() {
  const guides = useEditorStore(s => s.guideLibrary)
  const removeGuides = useEditorStore(s => s.removeGuides)
  const updateGuide = useEditorStore(s => s.updateGuide)
  const customNucleases = useEditorStore(s => s.customNucleases)
  const customScaffolds = useEditorStore(s => s.customScaffolds)
  const addCustomScaffold = useEditorStore(s => s.addCustomScaffold)
  const removeCustomScaffold = useEditorStore(s => s.removeCustomScaffold)
  const setSelection = useEditorStore(s => s.setSelection)
  const doc = useEditorStore(s => s.doc)
  const isProtein = doc.sequence.alphabet === 'protein'
  const origin = doc.metadata?.displayOrigin ?? 0
  const at = (i: number) => displayPosition(i, origin, doc.sequence.length)

  const matches = useLibraryMatches(
    guides,
    isProtein ? '' : doc.sequence.bases,
    doc.sequence.topology,
    customNucleases,
  )
  const [openScaffold, setOpenScaffold] = useState<string | null>(null)
  const [addingScaffold, setAddingScaffold] = useState(false)
  const [scaffoldName, setScaffoldName] = useState('')
  const [scaffoldSeq, setScaffoldSeq] = useState('')
  const [scaffoldSide, setScaffoldSide] = useState<'after' | 'before'>('after')

  const shownScaffold = openScaffold
    ? [...SCAFFOLDS, ...customScaffolds].find(x => x.id === openScaffold) ?? null
    : null

  const copyScaffold = (sequence: string) => {
    navigator.clipboard.writeText(sequence)
      .then(() => notify.success('Scaffold copied'))
      .catch(() => notify.error('Could not copy it'))
  }

  const saveScaffold = () => {
    const made = customScaffold(scaffoldName, scaffoldSeq, scaffoldSide, `scaffold-${Date.now().toString(36)}`)
    if (made.sequence.length < 10) {
      notify.error('That is too short to be a scaffold.')
      return
    }
    addCustomScaffold(made)
    setAddingScaffold(false)
    setScaffoldName('')
    setScaffoldSeq('')
    notify.success('Scaffold kept')
  }

  return (
    <div className="gp">
      <div className="gp-status">
        <span className="gp-status-count">
          {guides.length} guide{guides.length === 1 ? '' : 's'}
          {!isProtein && matches.some(m => m.site) && (
            <span className="gp-spec">{matches.filter(m => m.site).length} bind this sequence</span>
          )}
        </span>
        {guides.length > 0 && (
          <button
            className="btn btn-sm"
            onClick={() => {
              navigator.clipboard.writeText(libraryCsv(guides))
                .then(() => notify.success('Library copied'))
                .catch(() => notify.error('Could not copy the library'))
            }}
          >
            <ClipboardCopy size={12} /> Table
          </button>
        )}
      </div>

      <ul className="gp-list">
        {matches.map(({ guide, site, siteCount }) => {
          const nuclease = builtInNuclease(guide.nucleaseId) ?? customNucleases.find(n => n.id === guide.nucleaseId)
          return (
            <li
              key={guide.id}
              className="gp-row gp-library-row"
              onClick={() => { if (site) setSelection({ anchor: site.start, caret: site.end }) }}
              title={site ? 'Click to select where it binds here' : 'It does not bind this sequence'}
            >
              <div className="gp-row-main">
                <input
                  className="gp-lib-name"
                  value={guide.name}
                  onChange={e => updateGuide(guide.id, { name: e.target.value })}
                  onClick={e => e.stopPropagation()}
                  spellCheck={false}
                />
                <span className="gp-seq"><span className="gp-spacer-seq">{guide.spacer}</span></span>
              </div>
              <div className="gp-scores">
                {site ? (
                  <span className="gp-spec">
                    <Crosshair size={10} /> {at(site.start)}{site.strand === 1 ? '+' : '-'}
                    {siteCount > 1 && ` of ${siteCount}`}
                  </span>
                ) : (
                  <span className="gp-faint">{isProtein ? 'protein open' : 'not here'}</span>
                )}
                <button
                  className="fs-icon-btn"
                  title="Forget this guide"
                  onClick={e => { e.stopPropagation(); removeGuides([guide.id]) }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="gp-why">
                <span className="gp-why-plain">{nuclease?.name ?? guide.nucleaseId}, PAM {guide.pam}</span>
                {guide.origin?.documentName && (
                  <span className="gp-why-plain">from {guide.origin.documentName}</span>
                )}
                {guide.scores?.onTarget !== null && guide.scores?.onTarget !== undefined && (
                  <span className="gp-why-plain" title="As it scored when it was kept">
                    scored {guide.scores.onTarget} then
                  </span>
                )}
              </div>
            </li>
          )
        })}
        {guides.length === 0 && (
          <li className="gp-empty">
            Nothing kept yet. Design a guide, then keep it from the Order task, and it will be here whatever
            sequence you open.
          </li>
        )}
      </ul>

      <div className="gp-section">
        <div className="gp-section-title">Scaffolds</div>
        <div className="gp-chips gp-note-row">
          {[...SCAFFOLDS, ...customScaffolds].map(s => (
            <span key={s.id} className={`gp-chip${openScaffold === s.id ? ' open' : ''}`}>
              <button
                className="gp-chip-btn"
                onClick={() => setOpenScaffold(openScaffold === s.id ? null : s.id)}
                aria-expanded={openScaffold === s.id}
                title="Show the sequence"
              >
                <Chevron open={openScaffold === s.id} size={9} />
                {s.name}
              </button>
              {s.custom && (
                <button
                  className="gp-chip-x"
                  onClick={() => removeCustomScaffold(s.id)}
                  title="Forget this scaffold"
                >
                  <X size={9} />
                </button>
              )}
            </span>
          ))}
        </div>

        {shownScaffold && (
          <div className="gp-scaffold">
            <div className="gp-scaffold-head">
              <span className="gp-oligo-len">
                {shownScaffold.sequence.length} nt,{' '}
                {shownScaffold.side === 'after' ? 'after the spacer' : 'before the spacer'}
              </span>
              <button className="btn btn-sm" onClick={() => copyScaffold(shownScaffold.sequence)}>
                <Copy size={12} /> Copy
              </button>
            </div>
            <div className="gi-seq gi-donor">{shownScaffold.sequence}</div>
            <p className="gi-caveat">{shownScaffold.note}</p>
          </div>
        )}

        {!addingScaffold ? (
          <div className="gp-run-row">
            <button className="btn btn-sm" onClick={() => setAddingScaffold(true)}>
              <Plus size={12} /> Add the scaffold from your vector
            </button>
          </div>
        ) : (
          <div className="gp-settings gp-settings-tight">
            <div className="gp-field gp-field-wide">
              <label htmlFor="gp-sc-name">Name</label>
              <input
                id="gp-sc-name"
                className="input"
                value={scaffoldName}
                onChange={e => setScaffoldName(e.target.value)}
                placeholder="pMyVector scaffold"
                autoFocus
              />
            </div>
            <div className="gp-field gp-field-wide">
              <label htmlFor="gp-sc-seq">Sequence</label>
              <textarea
                id="gp-sc-seq"
                className="input gp-payload"
                value={scaffoldSeq}
                onChange={e => setScaffoldSeq(e.target.value)}
                rows={3}
                spellCheck={false}
                placeholder="Paste it from the plasmid you are using"
              />
            </div>
            <div className="gp-field">
              <label htmlFor="gp-sc-side">Sits</label>
              <select
                id="gp-sc-side"
                value={scaffoldSide}
                onChange={e => setScaffoldSide(e.target.value as 'after' | 'before')}
              >
                <option value="after">After the spacer</option>
                <option value="before">Before the spacer</option>
              </select>
            </div>
            <div className="gp-run-row">
              <button className="btn btn-primary btn-sm" onClick={saveScaffold}>Keep it</button>
              <button className="btn btn-sm" onClick={() => setAddingScaffold(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
