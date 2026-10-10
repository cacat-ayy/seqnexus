/**
 * Saving and editing enzyme sets in the Restriction Analysis panel.
 *
 * A set is made from what the panel lists: narrow the enzymes down with the
 * subset, the search and the cut filters, then save the list under a name.
 * A saved set is then one more choice of candidate enzymes, and it can be
 * renamed, have its enzymes edited as a list of names, or be deleted (with
 * Undo, as a deleted feature has).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '../store'
import { resolveEnzymeNames, setForKey, setKey } from '../enzymes/sets'
import { notify } from '../toast'

interface Props {
  /** The subset key the panel runs. */
  subset: string
  onSubset: (key: string) => void
  /** The enzymes the panel lists now, which "Save as set" keeps. */
  listed: readonly string[]
}

export default function EnzymeSetControls({ subset, onSubset, listed }: Props) {
  const sets = useEditorStore(s => s.enzymeSets)
  const current = setForKey(subset, sets)
  const [mode, setMode] = useState<'idle' | 'save' | 'edit'>('idle')
  const [name, setName] = useState('')
  const [names, setNames] = useState('')

  // Choosing another subset closes whatever form was open for the last one.
  useEffect(() => { setMode('idle') }, [subset])

  const startSave = useCallback(() => {
    setName(current ? `${current.name} copy` : 'Enzyme set')
    setMode('save')
  }, [current])

  const startEdit = useCallback(() => {
    if (!current) return
    setName(current.name)
    setNames(current.enzymes.join(', '))
    setMode('edit')
  }, [current])

  const save = useCallback(() => {
    const id = useEditorStore.getState().addEnzymeSet(name, [...listed])
    setMode('idle')
    onSubset(setKey(id))
  }, [name, listed, onSubset])

  const resolved = useMemo(() => resolveEnzymeNames(names.split(/[\s,;]+/)), [names])

  const saveEdit = useCallback(() => {
    if (!current) return
    const s = useEditorStore.getState()
    if (name.trim() && name.trim() !== current.name) s.renameEnzymeSet(current.id, name)
    s.setEnzymeSetEnzymes(current.id, resolved.known)
    setMode('idle')
  }, [current, name, resolved.known])

  const remove = useCallback(() => {
    if (!current) return
    const before = useEditorStore.getState().enzymeSets
    useEditorStore.getState().removeEnzymeSet(current.id)
    notify.success(`Deleted the enzyme set "${current.name}"`, {
      action: {
        label: 'Undo',
        onClick: () => {
          useEditorStore.getState().restoreEnzymeSets(before)
          onSubset(setKey(current.id))
        },
      },
    })
  }, [current, onSubset])

  const onKey = (e: React.KeyboardEvent, submit: () => void) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); submit() }
    // The panel closes on Escape; inside a form it only closes the form.
    if (e.key === 'Escape') { e.stopPropagation(); setMode('idle') }
  }

  return (
    <div className="re-sets">
      <div className="re-set-actions">
        <button
          className="btn btn-sm"
          onClick={startSave}
          disabled={listed.length === 0}
          title="Save the enzymes listed below as a set of your own"
        >
          Save list as set…
        </button>
        {current && <button className="btn btn-sm" onClick={startEdit}>Edit set…</button>}
        {current && <button className="btn btn-sm" onClick={remove}>Delete set</button>}
      </div>

      {mode === 'save' && (
        <div className="re-set-form" onKeyDown={e => onKey(e, save)}>
          <label className="re-field-label" htmlFor="re-set-name">
            Name for the {listed.length} {listed.length === 1 ? 'enzyme' : 'enzymes'} listed
          </label>
          <input id="re-set-name" className="input re-search-input" value={name} onChange={e => setName(e.target.value)} autoFocus />
          <div className="re-set-buttons">
            <button className="btn btn-primary btn-sm" onClick={save}>Save set</button>
            <button className="btn btn-sm" onClick={() => setMode('idle')}>Cancel</button>
          </div>
        </div>
      )}

      {mode === 'edit' && current && (
        <div className="re-set-form" onKeyDown={e => onKey(e, saveEdit)}>
          <label className="re-field-label" htmlFor="re-set-rename">Name</label>
          <input id="re-set-rename" className="input re-search-input" value={name} onChange={e => setName(e.target.value)} autoFocus />
          <label className="re-field-label" htmlFor="re-set-enzymes">
            Enzymes ({resolved.known.length}), separated by commas or spaces
          </label>
          <textarea
            id="re-set-enzymes"
            className="input re-set-names"
            rows={4}
            value={names}
            onChange={e => setNames(e.target.value)}
            spellCheck={false}
          />
          {resolved.missing.length > 0 && (
            <div className="re-set-warning">
              Not in the enzyme database, so left out: {resolved.missing.join(', ')}
            </div>
          )}
          <div className="re-set-buttons">
            <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={resolved.known.length === 0}>Save</button>
            <button className="btn btn-sm" onClick={() => setMode('idle')}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
