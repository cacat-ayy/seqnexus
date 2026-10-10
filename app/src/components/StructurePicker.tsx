/**
 * Choosing a structure for the open protein: the PDB entries and the
 * AlphaFold model its UniProt record names, any PDB id, any UniProt
 * accession's AlphaFold model, or a PDB or mmCIF file. Used as the empty
 * state of the 3D view and inside the dialog that changes the structure.
 */

import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { useEditorStore } from '../store'
import { fetchPdbEntry, fetchAlphaFoldModel, structureFromFile, type FetchedStructure } from '../structure/sources'
import { attachToOpenProtein } from '../structure/attach'
import { isPdbId } from '../structure/model'
import { notify } from '../toast'

/** PDB entries offered as one click; the rest by typing. */
const MAX_PDB_CHIPS = 12

export default function StructurePicker({ onDone, missingFile }: {
  onDone?: () => void
  /** Set when the attached file's coordinates are gone: ask for that file. */
  missingFile?: string
}) {
  const uniprot = useEditorStore(s => s.doc.metadata?.uniprot)
  const [pdbId, setPdbId] = useState('')
  const [accession, setAccession] = useState(uniprot?.accession ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = async (label: string, get: () => Promise<FetchedStructure>) => {
    setBusy(label)
    setError(null)
    try {
      const fetched = await get()
      const r = attachToOpenProtein(fetched)
      notify.success(`Showing ${fetched.ref.source === 'file' ? fetched.ref.id : fetched.ref.id} chain ${r.chain}`, {
        detail: `${r.aligned} residues aligned, ${Math.round(r.identity * 100)}% identical`,
      })
      onDone?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const onFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => void run(file.name, () => structureFromFile(file.name, String(reader.result)))
    reader.onerror = () => setError(`Could not read "${file.name}"`)
    reader.readAsText(file)
  }

  const pdbIds = uniprot?.pdbIds ?? []
  const validPdb = isPdbId(pdbId)

  return (
    <div className="sp-picker">
      {missingFile && (
        <div className="sp-note sp-note-warn">
          The coordinates of <strong>{missingFile}</strong> are not in this browser (they stay on the computer the file
          was opened on). Open the file again to show it.
        </div>
      )}

      {(pdbIds.length > 0 || uniprot?.alphaFold) && (
        <div className="sp-section">
          <div className="sp-label">From the UniProt entry {uniprot?.accession}</div>
          <div className="sp-chips">
            {uniprot?.alphaFold && (
              <button className="sp-chip sp-chip-af" disabled={!!busy}
                onClick={() => run('AlphaFold', () => fetchAlphaFoldModel(uniprot.accession))}
                title="The AlphaFold database's predicted model, coloured by its per-residue confidence">
                AlphaFold model
              </button>
            )}
            {pdbIds.slice(0, MAX_PDB_CHIPS).map(id => (
              <button key={id} className="sp-chip" disabled={!!busy} onClick={() => run(id, () => fetchPdbEntry(id))}
                title={`Experimental structure ${id} from RCSB PDB`}>
                {id}
              </button>
            ))}
            {pdbIds.length > MAX_PDB_CHIPS && <span className="sp-more">+{pdbIds.length - MAX_PDB_CHIPS} more: type an id below</span>}
          </div>
        </div>
      )}

      <div className="sp-section">
        <label className="sp-label" htmlFor="sp-pdb">PDB entry</label>
        <form className="sp-row" onSubmit={e => { e.preventDefault(); if (validPdb) void run(pdbId, () => fetchPdbEntry(pdbId)) }}>
          <input id="sp-pdb" className="input sp-input" placeholder="e.g. 1A3N" value={pdbId} maxLength={4}
            onChange={e => { setPdbId(e.target.value.trim()); setError(null) }} disabled={!!busy} />
          <button type="submit" className="btn btn-sm" disabled={!validPdb || !!busy}>Fetch</button>
        </form>
      </div>

      <div className="sp-section">
        <label className="sp-label" htmlFor="sp-af">AlphaFold model by UniProt accession</label>
        <form className="sp-row" onSubmit={e => { e.preventDefault(); if (accession.trim()) void run(accession, () => fetchAlphaFoldModel(accession)) }}>
          <input id="sp-af" className="input sp-input" placeholder="e.g. P69905" value={accession}
            onChange={e => { setAccession(e.target.value.trim()); setError(null) }} disabled={!!busy} />
          <button type="submit" className="btn btn-sm" disabled={!accession.trim() || !!busy}>Fetch</button>
        </form>
      </div>

      <div className="sp-section">
        <button className="btn btn-sm sp-file" onClick={() => fileRef.current?.click()} disabled={!!busy}>
          <FileUp size={13} /> Open a PDB or mmCIF file…
        </button>
        <input ref={fileRef} type="file" accept=".pdb,.ent,.cif,.mmcif" hidden
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f) }} />
      </div>

      {busy && <div className="sp-note">Loading {busy}…</div>}
      {error && <div className="sp-note sp-note-error">{error}</div>}

      <p className="sp-privacy">
        Only the id is sent to RCSB or the AlphaFold database; the sequence stays here. Fetched structures are kept in
        this browser, so they open again offline.
      </p>
    </div>
  )
}
