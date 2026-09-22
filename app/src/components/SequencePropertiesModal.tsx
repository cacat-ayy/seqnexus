import './SequencePropertiesModal.css'
import { useState, useCallback, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import { useEditorStore } from '../store'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface Props {
  open: boolean
  onClose: () => void
}

export default function SequencePropertiesModal({ open, onClose }: Props) {
  const doc = useEditorStore(s => s.doc)
  const updateDocumentProperties = useEditorStore(s => s.updateDocumentProperties)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [topology, setTopology] = useState<'linear' | 'circular'>('linear')
  const [strandedness, setStrandedness] = useState<'double' | 'single'>('double')
  const [dam, setDam] = useState(false)
  const [dcm, setDcm] = useState(false)
  const [ecoKI, setEcoKI] = useState(false)
  const [dispOriginStr, setDispOriginStr] = useState('1')

  const nameRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)

  // Populate form from current doc when opened
  useEffect(() => {
    if (open) {
      setName(doc.name)
      setDescription(doc.description || '')
      setTopology(doc.sequence.topology)
      setStrandedness(doc.metadata?.strandedness || 'double')
      setDam(doc.metadata?.damMethylated || false)
      setDcm(doc.metadata?.dcmMethylated || false)
      setEcoKI(doc.metadata?.ecoKIMethylated || false)
      setDispOriginStr(String((doc.metadata?.displayOrigin || 0) + 1))
      requestAnimationFrame(() => nameRef.current?.select())
    }
  }, [open, doc])

  const handleSave = useCallback(() => {
    const parsedOrigin = parseInt(dispOriginStr, 10)
    const seqLen = doc.sequence.length
    const displayOrigin = topology === 'circular' && !isNaN(parsedOrigin) && parsedOrigin >= 1 && parsedOrigin <= seqLen
      ? (parsedOrigin - 1) % seqLen
      : 0
    updateDocumentProperties({
      name: name.trim() || 'Untitled',
      description: description.trim() || undefined,
      topology,
      strandedness,
      damMethylated: dam,
      dcmMethylated: dcm,
      ecoKIMethylated: ecoKI,
      displayOrigin,
    })
    onClose()
  }, [name, description, topology, strandedness, dam, dcm, ecoKI, dispOriginStr, doc.sequence.length, updateDocumentProperties, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave()
  }, [onClose, handleSave])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal-dialog nsm-dialog" role="dialog" aria-modal="true" aria-labelledby="sequence-properties-modal-title">
        <div className="modal-header">
          <h3 className="modal-title" id="sequence-properties-modal-title">Sequence Properties</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <label className="nsm-label">
            Name
            <input
              ref={nameRef}
              className="input nsm-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Sequence name"
              spellCheck={false}
            />
          </label>

          <label className="nsm-label">
            Description <span className="nsm-optional">(optional)</span>
            <textarea
              className="input nsm-textarea spm-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description"
              spellCheck={false}
              rows={3}
            />
          </label>

          <label className="nsm-label">
            Topology
            <div className="toggle-group">
              <button
                className={`toggle-btn ${topology === 'linear' ? 'active' : ''}`}
                onClick={() => setTopology('linear')}
                type="button"
              >Linear</button>
              <button
                className={`toggle-btn ${topology === 'circular' ? 'active' : ''}`}
                onClick={() => setTopology('circular')}
                type="button"
              >Circular</button>
            </div>
          </label>

          <label className="nsm-label">
            Strandedness
            <div className="toggle-group">
              <button
                className={`toggle-btn ${strandedness === 'double' ? 'active' : ''}`}
                onClick={() => setStrandedness('double')}
                type="button"
              >Double-stranded</button>
              <button
                className={`toggle-btn ${strandedness === 'single' ? 'active' : ''}`}
                onClick={() => setStrandedness('single')}
                type="button"
              >Single-stranded</button>
            </div>
          </label>

          <div className="nsm-label">
            Methylation
            <div className="spm-checkboxes">
              <label className="spm-checkbox">
                <input type="checkbox" checked={dam} onChange={e => setDam(e.target.checked)} />
                Dam
              </label>
              <label className="spm-checkbox">
                <input type="checkbox" checked={dcm} onChange={e => setDcm(e.target.checked)} />
                Dcm
              </label>
              <label className="spm-checkbox">
                <input type="checkbox" checked={ecoKI} onChange={e => setEcoKI(e.target.checked)} />
                EcoKI
              </label>
            </div>
          </div>

          {topology === 'circular' && (
            <label className="nsm-label">
              Display Origin <span className="nsm-optional">(position shown as 1)</span>
              <input
                className="input nsm-input"
                type="number"
                min={1}
                max={doc.sequence.length}
                value={dispOriginStr}
                onChange={e => setDispOriginStr(e.target.value)}
              />
            </label>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}
