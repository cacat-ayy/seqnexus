/**
 * The primer design workbench: the Design view of the Primers tab.
 *
 * One place for every way of making a primer, picked as a task:
 *
 * - PCR: a pair (and probe) around a target, from the candidate landscape.
 * - Cloning: primers starting at an insert's ends, with restriction-site or
 *   homology-arm tails.
 * - Mutagenesis: a pair that makes a substitution, insertion or deletion.
 * - Sequencing: a tiled set whose reads cover a region.
 * - Check: where an oligo you already have binds in every open sequence.
 *
 * Docked rather than modal, so each task's region is simply the selection.
 * Picks are drawn on the sequence and map as dashed previews until saved.
 */

import { useEffect, useState } from 'react'
import { useEditorStore } from '../../store'
import { loadSettings, saveSettings, type DesignSettings } from '../../primers/design/settings'
import PcrTask from './workbench/PcrTask'
import CloningTask from './workbench/CloningTask'
import MutagenesisTask from './workbench/MutagenesisTask'
import SequencingTask from './workbench/SequencingTask'
import CheckTask from './workbench/CheckTask'
import { SettingsSection } from './workbench/SettingsSection'
import './workbench.css'

type Task = 'pcr' | 'cloning' | 'mutagenesis' | 'sequencing' | 'check'

const TASKS: { id: Task; label: string }[] = [
  { id: 'pcr', label: 'PCR / qPCR' },
  { id: 'cloning', label: 'Cloning (tails)' },
  { id: 'mutagenesis', label: 'Mutagenesis' },
  { id: 'sequencing', label: 'Sequencing' },
  { id: 'check', label: 'Check a primer' },
]

const TASK_KEY = 'seqnexus:primer-task'

function loadTask(): Task {
  try {
    const t = localStorage.getItem(TASK_KEY)
    return TASKS.some(x => x.id === t) ? (t as Task) : 'pcr'
  } catch {
    return 'pcr'
  }
}

export default function PrimerWorkbench() {
  const clearDesign = useEditorStore(s => s.clearDesign)
  const setPrimerView = useEditorStore(s => s.setPrimerView)
  const hasDesign = useEditorStore(s => {
    const d = s.primerDesign
    return !!(d.result || d.picks.forward || d.picks.reverse || d.picks.probe || d.batch.length)
  })

  const [settings, setSettings] = useState<DesignSettings>(loadSettings)
  const [task, setTask] = useState<Task>(loadTask)
  useEffect(() => { saveSettings(settings) }, [settings])

  const switchTask = (next: Task) => {
    setTask(next)
    // A pick from one task means nothing in another.
    clearDesign()
    try { localStorage.setItem(TASK_KEY, next) } catch { /* private mode */ }
  }

  // An oligo opened from the library lands in the Check task.
  const checkAt = useEditorStore(s => s.checkRequest?.at)
  useEffect(() => {
    if (checkAt) switchTask('check')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkAt])

  return (
    <div className="wb">
      <section className="wb-section">
        <div className="wb-row">
          <label htmlFor="wb-task">Task</label>
          <select id="wb-task" className="input ft-select" value={task} onChange={e => switchTask(e.target.value as Task)}>
            {TASKS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
      </section>

      {task !== 'check' && (
        <SettingsSection
          settings={settings}
          onChange={setSettings}
          product={task === 'pcr'}
          probe={task === 'pcr'}
        />
      )}

      {task === 'pcr' && <PcrTask settings={settings} onSettings={setSettings} />}
      {task === 'cloning' && <CloningTask settings={settings} />}
      {task === 'mutagenesis' && <MutagenesisTask settings={settings} />}
      {task === 'sequencing' && <SequencingTask settings={settings} />}
      {task === 'check' && <CheckTask settings={settings} />}

      {hasDesign && (
        <div className="wb-footer">
          <button className="btn btn-sm" onClick={() => { clearDesign(); setPrimerView('list') }}>
            Close design
          </button>
        </div>
      )}
    </div>
  )
}
