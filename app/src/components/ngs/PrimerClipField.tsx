/**
 * The "clip primers" option of the mapping dialogs: amplicon reads start
 * with primer bases, which are clipped where the primer library's oligos
 * bind the references (ngs/primerClip.ts).
 */

import type { PrimerClip } from './usePrimerClip'

const nf = new Intl.NumberFormat('en-US')

export default function PrimerClipField({ clip, disabled }: { clip: PrimerClip; disabled?: boolean }) {
  const none = clip.oligoCount === 0
  return (
    <div className="aw-field">
      <label className="ngs-check" title="For amplicon sequencing: the bases a read copies from its primer are soft-clipped, so they do not count for coverage, variants or the consensus (as ivar trim does)">
        <input type="checkbox" checked={clip.on} disabled={disabled || none} onChange={e => clip.setOn(e.target.checked)} />
        Clip primers (amplicon sequencing)
      </label>
      {none && <p className="aw-note">Add the primers to the primer library first: they are looked for on the references.</p>}
      {clip.on && clip.info && (
        <p className={`aw-note${clip.info.count === 0 ? ' ngs-warn-note' : ''}`}>
          {clip.info.count === 0
            ? `None of the ${nf.format(clip.oligoCount)} oligos in the library binds the references chosen.`
            : `${nf.format(clip.info.bound)} of ${nf.format(clip.oligoCount)} library oligos bind, at ${nf.format(clip.info.count)} ${clip.info.count === 1 ? 'site' : 'sites'}: reads starting in one have its bases clipped.`}
        </p>
      )}
    </div>
  )
}
