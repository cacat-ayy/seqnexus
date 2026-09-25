/**
 * Command registry.
 *
 * A single declarative list of everything the user can invoke, so the command
 * palette and the toolbar's overflow menu stay in sync by construction rather
 * than by remembering to update both. App owns the handlers and builds the
 * list; consumers only read it.
 */

import type { LucideIcon } from 'lucide-react'

export interface Command {
  /** Stable identity. Used as the React key and for the recents list. */
  id: string
  /** What the user searches for and reads. */
  label: string
  /** Section heading in the palette, e.g. "File", "Analyse", "View". */
  group: string
  icon?: LucideIcon
  /** Display-only accelerator, e.g. "⌘F". Not bound by the palette. */
  shortcut?: string
  /** Greyed out and unselectable — usually "no sequence open". */
  disabled?: boolean
  /** Extra search terms that should match this command but aren't in the label. */
  keywords?: string
  run: () => void
}

export interface ScoredCommand {
  command: Command
  score: number
  /** Indices into `command.label` that matched, for highlighting. */
  hits: number[]
}

/**
 * Subsequence match with a bias toward matches at word boundaries.
 *
 * Deliberately simple: the command list is tens of entries, not thousands, so
 * the cost of a smarter algorithm buys nothing a user would notice. Returns
 * null when the query is not a subsequence of the haystack at all.
 */
function fuzzyScore(haystack: string, query: string): { score: number; hits: number[] } | null {
  if (!query) return { score: 0, hits: [] }

  const hay = haystack.toLowerCase()
  const q = query.toLowerCase()
  const hits: number[] = []

  let score = 0
  let hayIdx = 0
  let prevMatch = -2

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    const found = hay.indexOf(ch, hayIdx)
    if (found === -1) return null

    // Consecutive characters score better than scattered ones.
    if (found === prevMatch + 1) score += 8
    // So do matches at the start of a word.
    if (found === 0 || hay[found - 1] === ' ' || hay[found - 1] === '-') score += 6
    // Earlier matches beat later ones, mildly.
    score -= found * 0.1

    hits.push(found)
    prevMatch = found
    hayIdx = found + 1
  }

  // A short label matching the whole query is a better hit than a long one.
  score += Math.max(0, 20 - haystack.length * 0.2)
  return { score, hits }
}

/**
 * Filter and rank commands against a query.
 *
 * Disabled commands are kept — hiding them makes the palette feel broken when
 * a user searches for something they know exists. They sort last and cannot be
 * activated.
 */
export function searchCommands(commands: Command[], query: string): ScoredCommand[] {
  const trimmed = query.trim()

  if (!trimmed) {
    return commands.map(command => ({ command, score: 0, hits: [] }))
  }

  const results: ScoredCommand[] = []
  for (const command of commands) {
    const onLabel = fuzzyScore(command.label, trimmed)
    // Keywords can match but never highlight, so their hits are discarded.
    const onKeywords = command.keywords ? fuzzyScore(command.keywords, trimmed) : null
    if (!onLabel && !onKeywords) continue

    const best = onLabel ?? { score: (onKeywords as { score: number }).score - 5, hits: [] }
    results.push({ command, score: best.score, hits: best.hits })
  }

  return results.sort((a, b) => {
    if (a.command.disabled !== b.command.disabled) return a.command.disabled ? 1 : -1
    return b.score - a.score
  })
}
