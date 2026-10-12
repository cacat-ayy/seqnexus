/**
 * What the editor area shows when nothing is open: the ways to start, as
 * cards, instead of a line pointing at the + in the sidebar. With an empty
 * workspace it welcomes; with items in the explorer it says nothing is open
 * and offers the same ways on.
 */

import './StartScreen.css'
import { Upload, Sparkles } from 'lucide-react'
import type { MenuAction } from './MenuGroups'

interface Props {
  /** The main ways in, drawn as cards. */
  primary: (MenuAction & { description: string })[]
  /** Other things to make, drawn as links. */
  more: MenuAction[]
  /** Something is in the explorer, just not open. */
  hasItems: boolean
  onOpenExample: () => void
}

const FORMATS: [string, string][] = [
  ['Sequences', 'GenBank (.gb, .gbk, .gbff), GenPept (.gp), EMBL (.embl), SnapGene (.dna), Geneious (.geneious), ApE (.ape), FASTA (.fasta, .fa, .faa), plain text'],
  ['Features', 'GFF3 (.gff3), with its own sequences or onto the open sequences it names'],
  ['Sanger', 'AB1 (.ab1), SCF (.scf)'],
  ['NGS', 'FASTQ (.fastq, .fq, gzipped too), BAM and SAM'],
  ['Alignments', 'Clustal (.aln), PHYLIP (.phy), NEXUS (.nex), MEGA (.meg), Stockholm (.sto), PIR (.pir), MSF (.msf), aligned FASTA'],
  ['Structures', 'PDB (.pdb), mmCIF (.cif)'],
  ['Sessions', 'SeqNexus session files (.json)'],
  ['Compressed', 'Any of these gzipped (.gz)'],
]

export default function StartScreen({ primary, more, hasItems, onOpenExample }: Props) {
  const pasteKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘V' : 'Ctrl+V'
  return (
    <div className="start">
      <div className="start-inner">
        <header className="start-head">
          <h2 className="start-title">{hasItems ? 'Nothing open' : 'Start something new'}</h2>
          <p className="start-sub">
            {hasItems
              ? 'Pick an item in the explorer, or start something new.'
              : 'Create a sequence, bring in your files or fetch a record. Everything stays in this browser.'}
          </p>
        </header>

        <div className="start-cards">
          {primary.map(action => {
            const Icon = action.icon
            return (
              <button key={action.id} className="start-card" onClick={action.run}>
                <span className="start-card-icon"><Icon size={18} /></span>
                <span className="start-card-text">
                  <span className="start-card-title">{action.label}</span>
                  <span className="start-card-desc">{action.description}</span>
                </span>
                {action.shortcut && <kbd className="menu-kbd start-card-kbd">{action.shortcut}</kbd>}
              </button>
            )
          })}
        </div>

        <div className="start-drop">
          <Upload size={15} />
          Or drop files or folders anywhere in the window, or paste with <kbd className="menu-kbd start-drop-kbd">{pasteKey}</kbd>
        </div>

        <div className="start-more">
          {more.map(action => {
            const Icon = action.icon
            return (
              <button key={action.id} className="start-link" onClick={action.run}>
                <Icon size={13} /> {action.label}
              </button>
            )
          })}
          {!hasItems && (
            <button className="start-link" onClick={onOpenExample}>
              <Sparkles size={13} /> Open the pUC19 Example
            </button>
          )}
        </div>

        <details className="start-formats">
          <summary>Supported formats</summary>
          <dl>
            {FORMATS.map(([kind, list]) => (
              <div key={kind} className="start-format-row">
                <dt>{kind}</dt>
                <dd>{list}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </div>
  )
}
