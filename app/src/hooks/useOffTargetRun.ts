/**
 * Running the off-target search from the panel.
 *
 * The search is explicit, not automatic: it reads every sequence the user
 * named, which can be a genome, so it happens when they ask and not while
 * they type. One run can cover several guides, since the targets are read
 * once either way, so checking the picked ones costs barely more than
 * checking one.
 */

import { useCallback } from 'react'
import { useEditorStore } from '../store'
import { resolveTargets, type DocumentLike } from '../crispr/targets'
import { findOffTargetsAsync } from '../workers/crispr'
import { resolveNuclease } from '../crispr/nucleases'
import { guideKey } from '../utils/guide-features'
import { notify } from '../toast'

export interface OffTargetRunner {
  /** Search for these guide keys, or for the selected one when given none. */
  run: (keys?: readonly string[]) => Promise<void>
  /** Whether a run could start at all: something to search, something to search for. */
  ready: boolean
}

export function useOffTargetRun(): OffTargetRunner {
  const scope = useEditorStore(s => s.offTargetScope)
  const settings = useEditorStore(s => s.offTargetSettings)
  const file = useEditorStore(s => s.offTargetFile)
  const running = useEditorStore(s => s.offTargetRun !== null)

  const run = useCallback(async (keys?: readonly string[]) => {
    const store = useEditorStore.getState()
    const nuclease = resolveNuclease(store.crisprNucleaseId, store.customNucleases)
    if (!nuclease || store.offTargetRun) return

    const wanted = keys && keys.length > 0
      ? store.guideResults.filter(c => keys.includes(guideKey(c.site)))
      : store.guideResults.filter(c => guideKey(c.site) === store.selectedGuideKey)
    if (wanted.length === 0) return

    const documents: DocumentLike[] = store.tabs.map(tab => ({
      id: tab.id,
      name: tab.doc.name,
      bases: tab.doc.sequence.bases,
      topology: tab.doc.sequence.topology,
      isProtein: tab.doc.sequence.alphabet === 'protein',
      features: tab.doc.annotations.map(a => ({ name: a.name, type: a.type, start: a.start, end: a.end })),
    }))
    const targets = resolveTargets(store.offTargetScope, store.activeTabId, documents, store.offTargetFile)
    if (targets.length === 0) {
      notify.warning(
        store.offTargetScope === 'file'
          ? 'Load a FASTA file to search against first.'
          : 'There is no DNA open to search.',
      )
      return
    }

    // A guide's own site is not one of its off-targets, but only in the
    // document it was found in.
    const excludes: Record<string, { targetId: string; start: number; strand: 1 | -1 }> = {}
    if (store.activeTabId) {
      for (const candidate of wanted) {
        excludes[guideKey(candidate.site)] = {
          targetId: store.activeTabId,
          start: candidate.site.start,
          strand: candidate.site.strand,
        }
      }
    }

    store.setOffTargetRun({
      guidesDone: 0,
      guidesTotal: wanted.length,
      targetsDone: 0,
      targetsTotal: targets.length,
      targetName: targets[0].name,
    })

    try {
      const { reports } = await findOffTargetsAsync(
        {
          spacers: wanted.map(c => ({ key: guideKey(c.site), spacer: c.site.spacer })),
          nuclease,
          targets,
          settings: store.offTargetSettings,
          excludes,
        },
        progress => {
          useEditorStore.getState().setOffTargetRun({
            guidesDone: progress.guidesDone,
            guidesTotal: progress.guidesTotal,
            targetsDone: progress.targetsDone,
            targetsTotal: progress.targetsTotal,
            targetName: progress.targetName,
          })
        },
      )
      useEditorStore.getState().setOffTargetReports(reports)
      const truncated = Object.values(reports).some(r => r.truncated)
      if (truncated) notify.warning('The search stopped at its hit cap, so this is not every site.')
    } catch {
      useEditorStore.getState().setOffTargetRun(null)
      notify.error('The off-target search could not finish.')
    }
  }, [])

  const ready = !running && (scope !== 'file' || (file !== null && file.records.length > 0)) && settings.maxMismatches >= 0
  return { run, ready }
}
