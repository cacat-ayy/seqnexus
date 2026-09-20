import './CloningModal.css'
/**
 * In-Silico Cloning modal.
 *
 * Six methods: Digest + Ligation, Golden Gate, Gibson, In-Fusion, Gateway, TOPO.
 * Each method has separate vector/backbone and insert dropdowns. When multiple
 * vectors or inserts are selected, a matrix batch runs each combination independently.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { X, Plus, Trash2, AlertTriangle, ChevronDown, ChevronRight, ArrowUp, ArrowDown, Loader2 } from 'lucide-react'
import { useEditorStore } from '../store'
import { ENZYME_DB, ENZYME_GROUPS, type RestrictionEnzyme } from '../enzymes/db'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import type { DocumentState, SequenceMetadata } from '../models/Document'
import type { CloningFragment, CloningProduct, SequenceSource } from '../cloning/types'
import { digestFragments, ligateFragments, partialDigestFragments } from '../cloning/digest'
import { findCutSites } from '../enzymes/finder'
import { gibsonAssemble, type OverlapInfo } from '../cloning/gibson'
import { goldenGateAssemble } from '../cloning/golden-gate'
import { infusionAssemble } from '../cloning/infusion'
import { gatewayClone, type GatewayReaction, type GatewayResult } from '../cloning/gateway'
import { topoClone, type TopoVariant, type TopoResult } from '../cloning/topo'
import { useExitAnimation } from '../hooks/useExitAnimation'

export type CloningMethod = 'digest' | 'gibson' | 'golden-gate' | 'infusion' | 'gateway' | 'topo'

interface Props {
  open: boolean
  onClose: () => void
  initialMethod?: CloningMethod
}

// Type IIS enzyme names for Golden Gate filtering
const TYPE_IIS_NAMES = new Set(ENZYME_GROUPS['Golden Gate (Type IIS)'] ?? [])

export default function CloningModal({ open, onClose, initialMethod }: Props) {
  const tabs = useEditorStore(s => s.tabs)
  const openDocumentState = useEditorStore(s => s.openDocumentState)

  const [method, setMethod] = useState<CloningMethod>('digest')

  // Sync method when modal opens with a specific initialMethod
  useEffect(() => {
    if (open && initialMethod) setMethod(initialMethod)
  }, [open, initialMethod])

  // Check if source sequences changed while the modal was closed
  const simSourceSnapshotRef = useRef<string>('')

  function buildSourceKey(): string {
    const allSources = [
      ...digestVectors, ...digestInserts,
      ...gibsonVectors, ...gibsonInserts,
      ...ggVectors, ...ggInserts,
      ...infusionVectors, ...infusionInserts,
      ...gatewayVectors, ...gatewayInserts,
      ...topoVectors, ...topoInserts,
    ]
    return allSources.map(src => {
      if (src.type === 'tab' && src.tabId) {
        const tab = tabs.find(t => t.id === src.tabId)
        if (tab) return `${src.tabId}:${tab.doc.sequence.length}:${tab.doc.sequence.bases.slice(0, 20)}`
        return `${src.tabId}:gone`
      }
      return `pasted:${src.doc.sequence.length}`
    }).join('|')
  }

  useEffect(() => {
    if (open && products && simSourceSnapshotRef.current) {
      const current = buildSourceKey()
      if (current !== simSourceSnapshotRef.current) setStale(true)
    }
  }, [open])

  // --- Digest + Ligation state ---
  const [digestVectors, setDigestVectors] = useState<SequenceSource[]>([])
  const [digestInserts, setDigestInserts] = useState<SequenceSource[]>([])
  const [digestEnzymeNames, setDigestEnzymeNames] = useState<string[]>([])
  const [enzymeFilter, setEnzymeFilter] = useState('')
  const [dephosphorylated, setDephosphorylated] = useState<Set<number>>(new Set())
  const [partialDigest, setPartialDigest] = useState(false)

  // --- Gibson state ---
  const [gibsonVectors, setGibsonVectors] = useState<SequenceSource[]>([])
  const [gibsonInserts, setGibsonInserts] = useState<SequenceSource[]>([])
  const [gibsonMinOverlap, setGibsonMinOverlap] = useState(15)
  const [gibsonMaxOverlap, setGibsonMaxOverlap] = useState(80)
  const [gibsonAutoOrder, setGibsonAutoOrder] = useState(false)

  // --- Golden Gate state ---
  const [ggVectors, setGgVectors] = useState<SequenceSource[]>([])
  const [ggInserts, setGgInserts] = useState<SequenceSource[]>([])
  const [ggEnzymeName, setGgEnzymeName] = useState('BsaI')

  // --- In-Fusion state ---
  const [infusionVectors, setInfusionVectors] = useState<SequenceSource[]>([])
  const [infusionInserts, setInfusionInserts] = useState<SequenceSource[]>([])
  const [infusionMinOverlap, setInfusionMinOverlap] = useState(15)
  const [infusionMaxOverlap, setInfusionMaxOverlap] = useState(25)
  const [infusionAutoOrder, setInfusionAutoOrder] = useState(false)

  // --- Gateway state ---
  const [gatewayVectors, setGatewayVectors] = useState<SequenceSource[]>([])
  const [gatewayInserts, setGatewayInserts] = useState<SequenceSource[]>([])
  const [gatewayReaction, setGatewayReaction] = useState<GatewayReaction>('LR')
  const [gatewayDetectedSites, setGatewayDetectedSites] = useState<GatewayResult['detectedSites']>([])

  // --- TOPO state ---
  const [topoVectors, setTopoVectors] = useState<SequenceSource[]>([])
  const [topoInserts, setTopoInserts] = useState<SequenceSource[]>([])
  const [topoVariant, setTopoVariant] = useState<TopoVariant>('TA')
  const [topoValidation, setTopoValidation] = useState<TopoResult['insertValidation'] | null>(null)

  // --- Results ---
  const [products, setProducts] = useState<CloningProduct[] | null>(null)
  /** Per-product vector metadata, parallel to `products`. Used to inherit methylation status. */
  const [productVectorMeta, setProductVectorMeta] = useState<(SequenceMetadata | undefined)[]>([])
  const [batchResults, setBatchResults] = useState<{ insertName: string; products: CloningProduct[]; warnings: string[] }[] | null>(null)
  const [gibsonOverlaps, setGibsonOverlaps] = useState<OverlapInfo[]>([])
  const [selectedProductIdx, setSelectedProductIdx] = useState(0)
  const [warnings, setWarnings] = useState<string[]>([])
  const [simulating, setSimulating] = useState(false)
  const [annotationSelections, setAnnotationSelections] = useState<Map<string, boolean>>(new Map())
  const [warningsExpanded, setWarningsExpanded] = useState(true)
  const [stale, setStale] = useState(false)

  // --- Paste modal ---
  const [showPaste, setShowPaste] = useState<{ setter: React.Dispatch<React.SetStateAction<SequenceSource[]>> } | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [pasteName, setPasteName] = useState('Pasted sequence')

  const backdropRef = useRef<HTMLDivElement>(null)

  // Mark results stale when sources or settings change after a simulation
  useEffect(() => {
    if (products) setStale(true)
  }, [method, digestVectors, digestInserts, digestEnzymeNames, gibsonVectors, gibsonInserts, gibsonMinOverlap, gibsonMaxOverlap, gibsonAutoOrder, ggVectors, ggInserts, ggEnzymeName, dephosphorylated, partialDigest, infusionVectors, infusionInserts, infusionMinOverlap, infusionMaxOverlap, infusionAutoOrder, gatewayVectors, gatewayInserts, gatewayReaction, topoVectors, topoInserts, topoVariant])

  // Update annotation selections when selected product changes
  useEffect(() => {
    if (!products || !products[selectedProductIdx]) return
    const product = products[selectedProductIdx]
    const map = new Map<string, boolean>()
    for (const ann of product.annotations) {
      map.set(ann.id, true)
    }
    setAnnotationSelections(map)
  }, [products, selectedProductIdx])

  // Available open documents for source picker (sorted alphabetically to match file explorer)
  const openDocs = useMemo(() =>
    tabs.map(t => ({
      tabId: t.id,
      name: t.doc.name,
      size: t.doc.sequence.length,
      topology: t.doc.sequence.topology,
      doc: t.doc,
    })).sort((a, b) => a.name.localeCompare(b.name)),
    [tabs],
  )

  // --- Source management ---
  function addSourceFromTab(
    tabId: string,
    setter: React.Dispatch<React.SetStateAction<SequenceSource[]>>,
  ) {
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return
    setter(prev => [...prev, { type: 'tab', tabId, doc: tab.doc }])
  }

  function addPastedSource(setter: React.Dispatch<React.SetStateAction<SequenceSource[]>>) {
    const cleaned = pasteText.replace(/[^A-Za-z]/g, '')
    if (cleaned.length === 0) return
    const doc: DocumentState = {
      name: pasteName || 'Pasted sequence',
      sequence: new Sequence(cleaned),
      annotations: [],
    }
    setter(prev => [...prev, { type: 'pasted', doc }])
    setShowPaste(null)
    setPasteText('')
    setPasteName('Pasted sequence')
  }

  function removeSource(
    idx: number,
    setter: React.Dispatch<React.SetStateAction<SequenceSource[]>>,
  ) {
    setter(prev => prev.filter((_, i) => i !== idx))
  }

  function moveSource(
    idx: number,
    dir: -1 | 1,
    setter: React.Dispatch<React.SetStateAction<SequenceSource[]>>,
  ) {
    setter(prev => {
      const arr = [...prev]
      const newIdx = idx + dir
      if (newIdx < 0 || newIdx >= arr.length) return arr
      ;[arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]]
      return arr
    })
  }

  /** Check if a source has methylation metadata set. */
  function methylationLabel(src: SequenceSource): string | null {
    const m = src.doc.metadata
    if (!m) return null
    const parts: string[] = []
    if (m.damMethylated) parts.push('dam')
    if (m.dcmMethylated) parts.push('dcm')
    return parts.length > 0 ? parts.join('+') : null
  }

  // --- Enzyme helpers ---
  const digestEnzymes = useMemo(() =>
    digestEnzymeNames
      .map(n => ENZYME_DB.find(e => e.name === n))
      .filter((e): e is RestrictionEnzyme => !!e),
    [digestEnzymeNames],
  )

  const ggEnzyme = useMemo(() =>
    ENZYME_DB.find(e => e.name === ggEnzymeName),
    [ggEnzymeName],
  )

  const typeIISEnzymes = useMemo(() =>
    ENZYME_DB.filter(e => TYPE_IIS_NAMES.has(e.name)),
    [],
  )

  // --- Cut count map: enzyme name → number[] (one count per source sequence) ---
  const cutCountMap = useMemo(() => {
    const sources = method === 'digest' ? [...digestVectors, ...digestInserts] : method === 'golden-gate' ? [...ggVectors, ...ggInserts] : []
    if (sources.length === 0) return new Map<string, number[]>()
    const enzymes = method === 'golden-gate' ? typeIISEnzymes : ENZYME_DB
    const map = new Map<string, number[]>()
    for (const enzyme of enzymes) {
      const counts: number[] = []
      for (const src of sources) {
        const sites = findCutSites(src.doc.sequence.bases, enzyme, src.doc.sequence.topology)
        counts.push(sites.length)
      }
      map.set(enzyme.name, counts)
    }
    return map
  }, [method, digestVectors, digestInserts, ggVectors, ggInserts, typeIISEnzymes])

  /** Format cut counts for display. Single source: "2", multiple: "2 + 1". */
  function formatCutCounts(counts: number[] | undefined): string {
    if (!counts || counts.length === 0) return ''
    if (counts.length === 1) return String(counts[0])
    return counts.join(' + ')
  }

  /** Total cuts across all sources. */
  function totalCuts(counts: number[] | undefined): number {
    if (!counts) return 0
    return counts.reduce((s, c) => s + c, 0)
  }

  // --- Simulate ---
  // Refresh tab-sourced docs to pick up any edits made while the modal was closed
  function refreshSources(sources: SequenceSource[]): SequenceSource[] {
    return sources.map(src => {
      if (src.type === 'tab' && src.tabId) {
        const tab = tabs.find(t => t.id === src.tabId)
        if (tab) return { ...src, doc: tab.doc }
      }
      return src
    })
  }

  const handleSimulate = useCallback(() => {
    // Refresh sources from current tab state before simulating
    setDigestVectors(prev => refreshSources(prev))
    setDigestInserts(prev => refreshSources(prev))
    setGibsonVectors(prev => refreshSources(prev))
    setGibsonInserts(prev => refreshSources(prev))
    setGgVectors(prev => refreshSources(prev))
    setGgInserts(prev => refreshSources(prev))
    setInfusionVectors(prev => refreshSources(prev))
    setInfusionInserts(prev => refreshSources(prev))
    setGatewayVectors(prev => refreshSources(prev))
    setGatewayInserts(prev => refreshSources(prev))
    setTopoVectors(prev => refreshSources(prev))
    setTopoInserts(prev => refreshSources(prev))

    setSimulating(true)
    setStale(false)
    simSourceSnapshotRef.current = buildSourceKey()
    setProducts(null)
    setProductVectorMeta([])
    setBatchResults(null)
    setWarnings([])

    // Use setTimeout to let the UI update before running computation
    setTimeout(() => {
      try {
        if (method === 'digest') {
          const allDigestSources = [...digestVectors, ...digestInserts]
          if (allDigestSources.length === 0 || digestEnzymes.length === 0) {
            setWarnings(['Select at least one source sequence and one enzyme'])
            setSimulating(false)
            return
          }

          if (partialDigest) {
            const allResults: CloningProduct[] = []
            const allWarnings: string[] = []
            for (const src of allDigestSources) {
              const partial = partialDigestFragments(src.doc, digestEnzymes)
              allWarnings.push(...partial.warnings)
              for (const fragSet of partial.fragmentSets) {
                const ligOpts = dephosphorylated.size > 0
                  ? { dephosphorylatedFragments: dephosphorylated }
                  : {}
                const result = ligateFragments(fragSet, ligOpts)
                allResults.push(...result)
              }
            }
            const seen = new Set<string>()
            const deduped = allResults.filter(p => {
              const key = p.sequence + p.topology
              if (seen.has(key)) return false
              seen.add(key)
              return true
            })
            setProducts(deduped)
            setProductVectorMeta(deduped.map(() => digestVectors[0]?.doc.metadata))
            if (deduped.length === 0) {
              allWarnings.push('No ligation products could be formed from partial digest fragments')
            } else {
              allWarnings.push(`Partial digest: ${deduped.length} unique products from all cut combinations`)
            }
            setWarnings(allWarnings)
          } else {
            const allWarnings: string[] = []
            const allFragments: CloningFragment[] = []
            for (const src of allDigestSources) {
              const r = digestFragments(src.doc, digestEnzymes)
              allFragments.push(...r.fragments)
              allWarnings.push(...r.warnings)
            }
            const ligOpts = dephosphorylated.size > 0
              ? { dephosphorylatedFragments: dephosphorylated }
              : {}
            const result = ligateFragments(allFragments, ligOpts)
            setProducts(result)
            setProductVectorMeta(result.map(() => digestVectors[0]?.doc.metadata))
            if (result.length === 0) {
              allWarnings.push('No ligation products could be formed from the digest fragments')
            }
            if (allWarnings.length > 0) setWarnings(allWarnings)
          }
        } else if (method === 'golden-gate') {
          const allGgSources = [...ggVectors, ...ggInserts]
          if (allGgSources.length === 0 || !ggEnzyme) {
            setWarnings(['Select at least one source sequence and an enzyme'])
            setSimulating(false)
            return
          }
          if (ggVectors.length + ggInserts.length > 2 && ggVectors.length > 0 && ggInserts.length > 0) {
            const batch: { insertName: string; products: CloningProduct[]; warnings: string[] }[] = []
            const meta: (SequenceMetadata | undefined)[] = []
            for (const vec of ggVectors) {
              for (const ins of ggInserts) {
                const label = ggVectors.length > 1 && ggInserts.length > 1
                  ? `${vec.doc.name} + ${ins.doc.name}`
                  : ggInserts.length > 1 ? ins.doc.name : vec.doc.name
                const result = goldenGateAssemble({
                  sources: [vec, ins].map(s => ({ doc: s.doc })),
                  enzyme: ggEnzyme,
                })
                batch.push({ insertName: label, products: result.products, warnings: result.warnings })
                for (const _ of result.products) meta.push(vec.doc.metadata)
              }
            }
            setBatchResults(batch)
            setProducts(batch.flatMap(b => b.products))
            setProductVectorMeta(meta)
            setWarnings([])
          } else {
            const result = goldenGateAssemble({
              sources: allGgSources.map(s => ({ doc: s.doc })),
              enzyme: ggEnzyme,
            })
            setProducts(result.products)
            setProductVectorMeta(result.products.map(() => ggVectors[0]?.doc.metadata))
            setWarnings(result.warnings)
          }
        } else if (method === 'gibson') {
          const allGibsonSources = [...gibsonVectors, ...gibsonInserts]
          if (allGibsonSources.length === 0) {
            setWarnings(['Add at least one source sequence'])
            setSimulating(false)
            return
          }
          if (gibsonVectors.length + gibsonInserts.length > 2 && gibsonVectors.length > 0 && gibsonInserts.length > 0) {
            const batch: { insertName: string; products: CloningProduct[]; warnings: string[] }[] = []
            const meta: (SequenceMetadata | undefined)[] = []
            for (const vec of gibsonVectors) {
              for (const ins of gibsonInserts) {
                const label = gibsonVectors.length > 1 && gibsonInserts.length > 1
                  ? `${vec.doc.name} + ${ins.doc.name}`
                  : gibsonInserts.length > 1 ? ins.doc.name : vec.doc.name
                const result = gibsonAssemble({
                  fragments: [vec, ins].map(s => ({ doc: s.doc })),
                  minOverlap: gibsonMinOverlap,
                  maxOverlap: gibsonMaxOverlap,
                  autoOrder: gibsonAutoOrder,
                })
                batch.push({ insertName: label, products: result.products, warnings: result.warnings })
                for (const _ of result.products) meta.push(vec.doc.metadata)
              }
            }
            setBatchResults(batch)
            setProducts(batch.flatMap(b => b.products))
            setProductVectorMeta(meta)
            setWarnings([])
            setGibsonOverlaps([])
          } else {
            const result = gibsonAssemble({
              fragments: allGibsonSources.map(s => ({ doc: s.doc })),
              minOverlap: gibsonMinOverlap,
              maxOverlap: gibsonMaxOverlap,
              autoOrder: gibsonAutoOrder,
            })
            setProducts(result.products)
            setProductVectorMeta(result.products.map(() => gibsonVectors[0]?.doc.metadata))
            setWarnings(result.warnings)
            setGibsonOverlaps(result.overlaps)
          }
        } else if (method === 'infusion') {
          const allInfusionSources = [...infusionVectors, ...infusionInserts]
          if (allInfusionSources.length === 0) {
            setWarnings(['Add at least one source sequence'])
            setSimulating(false)
            return
          }
          if (infusionVectors.length + infusionInserts.length > 2 && infusionVectors.length > 0 && infusionInserts.length > 0) {
            const batch: { insertName: string; products: CloningProduct[]; warnings: string[] }[] = []
            const meta: (SequenceMetadata | undefined)[] = []
            for (const vec of infusionVectors) {
              for (const ins of infusionInserts) {
                const label = infusionVectors.length > 1 && infusionInserts.length > 1
                  ? `${vec.doc.name} + ${ins.doc.name}`
                  : infusionInserts.length > 1 ? ins.doc.name : vec.doc.name
                const result = infusionAssemble({
                  fragments: [vec, ins].map(s => ({ doc: s.doc })),
                  minOverlap: infusionMinOverlap,
                  maxOverlap: infusionMaxOverlap,
                  autoOrder: infusionAutoOrder,
                })
                batch.push({ insertName: label, products: result.products, warnings: result.warnings })
                for (const _ of result.products) meta.push(vec.doc.metadata)
              }
            }
            setBatchResults(batch)
            setProducts(batch.flatMap(b => b.products))
            setProductVectorMeta(meta)
            setWarnings([])
            setGibsonOverlaps([])
          } else {
            const result = infusionAssemble({
              fragments: allInfusionSources.map(s => ({ doc: s.doc })),
              minOverlap: infusionMinOverlap,
              maxOverlap: infusionMaxOverlap,
              autoOrder: infusionAutoOrder,
            })
            setProducts(result.products)
            setProductVectorMeta(result.products.map(() => infusionVectors[0]?.doc.metadata))
            setWarnings(result.warnings)
            setGibsonOverlaps(result.overlaps)
          }
        } else if (method === 'gateway') {
          const allGatewaySources = [...gatewayVectors, ...gatewayInserts]
          if (allGatewaySources.length === 0) {
            setWarnings(['Add at least one source sequence'])
            setSimulating(false)
            return
          }
          if (gatewayVectors.length + gatewayInserts.length > 2 && gatewayVectors.length > 0 && gatewayInserts.length > 0) {
            const batch: { insertName: string; products: CloningProduct[]; warnings: string[] }[] = []
            const meta: (SequenceMetadata | undefined)[] = []
            for (const vec of gatewayVectors) {
              for (const ins of gatewayInserts) {
                const label = gatewayVectors.length > 1 && gatewayInserts.length > 1
                  ? `${vec.doc.name} + ${ins.doc.name}`
                  : gatewayInserts.length > 1 ? ins.doc.name : vec.doc.name
                const result = gatewayClone({
                  reaction: gatewayReaction,
                  sources: [vec, ins].map(s => ({ doc: s.doc })),
                })
                batch.push({ insertName: label, products: result.products, warnings: result.warnings })
                for (const _ of result.products) meta.push(vec.doc.metadata)
              }
            }
            setBatchResults(batch)
            setProducts(batch.flatMap(b => b.products))
            setProductVectorMeta(meta)
            setWarnings([])
          } else {
            const result = gatewayClone({
              reaction: gatewayReaction,
              sources: allGatewaySources.map(s => ({ doc: s.doc })),
            })
            setProducts(result.products)
            setProductVectorMeta(result.products.map(() => gatewayVectors[0]?.doc.metadata))
            setWarnings(result.warnings)
            setGatewayDetectedSites(result.detectedSites)
          }
        } else if (method === 'topo') {
          if (topoVectors.length === 0 || topoInserts.length === 0) {
            setWarnings(['Select at least one vector and one insert'])
            setSimulating(false)
            return
          }
          if (topoVectors.length > 1 || topoInserts.length > 1) {
            // Matrix batch: each vector × each insert
            const batch: { insertName: string; products: CloningProduct[]; warnings: string[] }[] = []
            const meta: (SequenceMetadata | undefined)[] = []
            for (const vec of topoVectors) {
              for (const ins of topoInserts) {
                const label = topoVectors.length > 1 && topoInserts.length > 1
                  ? `${vec.doc.name} + ${ins.doc.name}`
                  : topoInserts.length > 1 ? ins.doc.name : vec.doc.name
                const result = topoClone({
                  variant: topoVariant,
                  insert: { doc: ins.doc },
                  vector: { doc: vec.doc },
                })
                batch.push({ insertName: label, products: result.products, warnings: result.warnings })
                for (const _ of result.products) meta.push(vec.doc.metadata)
              }
            }
            setBatchResults(batch)
            setProducts(batch.flatMap(b => b.products))
            setProductVectorMeta(meta)
            setWarnings([])
            setTopoValidation(null)
          } else {
            const result = topoClone({
              variant: topoVariant,
              insert: { doc: topoInserts[0].doc },
              vector: { doc: topoVectors[0].doc },
            })
            setProducts(result.products)
            setProductVectorMeta(result.products.map(() => topoVectors[0]?.doc.metadata))
            setWarnings(result.warnings)
            setTopoValidation(result.insertValidation)
          }
        }
      } catch (err) {
        setWarnings([`Simulation error: ${err instanceof Error ? err.message : String(err)}`])
      }
      setSimulating(false)
    }, 10)
  }, [method, digestVectors, digestInserts, digestEnzymes, gibsonVectors, gibsonInserts, gibsonMinOverlap, gibsonMaxOverlap, gibsonAutoOrder, ggVectors, ggInserts, ggEnzyme, dephosphorylated, partialDigest, infusionVectors, infusionInserts, infusionMinOverlap, infusionMaxOverlap, infusionAutoOrder, gatewayVectors, gatewayInserts, gatewayReaction, topoVectors, topoInserts, topoVariant])

  // --- Open product ---
  const handleOpenProduct = useCallback(() => {
    if (!products || !products[selectedProductIdx]) return
    const product = products[selectedProductIdx]

    // Filter annotations based on user selection
    const selectedAnns = product.annotations.filter(a => annotationSelections.get(a.id) !== false)

    // Build description with cloning provenance
    const lines: string[] = []
    const date = new Date().toISOString().slice(0, 10)
    const methodLabels: Record<CloningMethod, string> = {
      digest: 'Digest + Ligation',
      gibson: 'Gibson Assembly',
      'golden-gate': 'Golden Gate Assembly',
      infusion: 'In-Fusion Cloning',
      gateway: 'Gateway Cloning',
      topo: 'TOPO Cloning',
    }
    lines.push(`Cloning method: ${methodLabels[method]}`)
    lines.push(`Created: ${date} by SeqNexus v1.0.0`)

    const fmtSource = (s: SequenceSource) =>
      `${s.doc.name} (${s.doc.sequence.length.toLocaleString()} bp, ${s.doc.sequence.topology})`

    if (method === 'digest') {
      lines.push(`Enzymes: ${digestEnzymeNames.join(', ') || 'none'}`)
      if (dephosphorylated.size > 0) lines.push(`Dephosphorylated vectors: ${[...dephosphorylated].map(i => digestVectors[i]?.doc.name).filter(Boolean).join(', ')}`)
      lines.push(`Vectors: ${digestVectors.map(fmtSource).join('; ')}`)
      if (digestInserts.length > 0) lines.push(`Inserts: ${digestInserts.map(fmtSource).join('; ')}`)
    } else if (method === 'gibson') {
      lines.push(`Overlap: ${gibsonMinOverlap}–${gibsonMaxOverlap} bp`)
      lines.push(`Vectors: ${gibsonVectors.map(fmtSource).join('; ')}`)
      if (gibsonInserts.length > 0) lines.push(`Inserts: ${gibsonInserts.map(fmtSource).join('; ')}`)
    } else if (method === 'golden-gate') {
      lines.push(`Enzyme: ${ggEnzymeName}`)
      lines.push(`Vectors: ${ggVectors.map(fmtSource).join('; ')}`)
      if (ggInserts.length > 0) lines.push(`Inserts: ${ggInserts.map(fmtSource).join('; ')}`)
    } else if (method === 'infusion') {
      lines.push(`Overlap: ${infusionMinOverlap}–${infusionMaxOverlap} bp`)
      lines.push(`Vectors: ${infusionVectors.map(fmtSource).join('; ')}`)
      if (infusionInserts.length > 0) lines.push(`Inserts: ${infusionInserts.map(fmtSource).join('; ')}`)
    } else if (method === 'gateway') {
      lines.push(`Reaction: ${gatewayReaction}`)
      lines.push(`Vectors: ${gatewayVectors.map(fmtSource).join('; ')}`)
      if (gatewayInserts.length > 0) lines.push(`Inserts: ${gatewayInserts.map(fmtSource).join('; ')}`)
    } else if (method === 'topo') {
      lines.push(`Variant: TOPO-${topoVariant}`)
      lines.push(`Vectors: ${topoVectors.map(fmtSource).join('; ')}`)
      if (topoInserts.length > 0) lines.push(`Inserts: ${topoInserts.map(fmtSource).join('; ')}`)
    }

    lines.push(`Product: ${product.size.toLocaleString()} bp, ${product.topology}`)

    // Inherit methylation from the vector that produced this specific product.
    // dam/dcm methylation is host-dependent: the product will be propagated
    // in the same host strain as the vector, so methylation status persists.
    const vectorMeta = productVectorMeta[selectedProductIdx]
    const inheritedMeta = vectorMeta && (vectorMeta.damMethylated || vectorMeta.dcmMethylated)
      ? {
          ...(vectorMeta.damMethylated ? { damMethylated: true } : {}),
          ...(vectorMeta.dcmMethylated ? { dcmMethylated: true } : {}),
        }
      : undefined

    const doc: DocumentState = {
      name: product.name,
      description: lines.join('\n'),
      sequence: new Sequence(product.sequence, product.topology),
      annotations: selectedAnns.map(a => new Annotation(a)),
      ...(inheritedMeta ? { metadata: inheritedMeta } : {}),
    }
    openDocumentState(doc)
    onClose()
  }, [products, productVectorMeta, selectedProductIdx, annotationSelections, openDocumentState, onClose, method, digestVectors, digestInserts, digestEnzymeNames, dephosphorylated, gibsonVectors, gibsonInserts, gibsonMinOverlap, gibsonMaxOverlap, ggVectors, ggInserts, ggEnzymeName, infusionVectors, infusionInserts, infusionMinOverlap, infusionMaxOverlap, gatewayVectors, gatewayInserts, gatewayReaction, topoVectors, topoInserts, topoVariant])

  // --- Key handlers ---
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      if (products && products.length > 0) handleOpenProduct()
      else handleSimulate()
    }
  }, [onClose, products, handleOpenProduct, handleSimulate])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  const currentVectors =
    method === 'digest' ? digestVectors :
    method === 'gibson' ? gibsonVectors :
    method === 'golden-gate' ? ggVectors :
    method === 'infusion' ? infusionVectors :
    method === 'gateway' ? gatewayVectors :
    method === 'topo' ? topoVectors :
    []

  const currentInserts =
    method === 'digest' ? digestInserts :
    method === 'gibson' ? gibsonInserts :
    method === 'golden-gate' ? ggInserts :
    method === 'infusion' ? infusionInserts :
    method === 'gateway' ? gatewayInserts :
    method === 'topo' ? topoInserts :
    []

  const currentVectorSetter =
    method === 'digest' ? setDigestVectors :
    method === 'gibson' ? setGibsonVectors :
    method === 'golden-gate' ? setGgVectors :
    method === 'infusion' ? setInfusionVectors :
    method === 'gateway' ? setGatewayVectors :
    method === 'topo' ? setTopoVectors :
    setGatewayVectors

  const currentInsertSetter =
    method === 'digest' ? setDigestInserts :
    method === 'gibson' ? setGibsonInserts :
    method === 'golden-gate' ? setGgInserts :
    method === 'infusion' ? setInfusionInserts :
    method === 'gateway' ? setGatewayInserts :
    method === 'topo' ? setTopoInserts :
    setGatewayInserts

  const hasSources = currentVectors.length > 0 || currentInserts.length > 0

  const canSimulate =
    hasSources && (
      method !== 'digest' || digestEnzymes.length > 0
    ) && (
      method !== 'golden-gate' || ggEnzyme != null
    )

  /** Whether methylation pills should be shown for the current method. */
  const showMethylation = method === 'digest' || method === 'golden-gate'

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onClick={handleBackdropClick} onKeyDown={handleKeyDown}>
      <div className="modal-dialog cln-modal">
        {/* Header */}
        <div className="modal-header">
          <h3 className="modal-title">In-Silico Cloning</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Method selector */}
        <div className="cln-method-selector">
          <label className="cln-method-label">Method</label>
          <select
            className="select cln-method-select"
            value={method}
            onChange={e => setMethod(e.target.value as CloningMethod)}
          >
            <optgroup label="Restriction">
              <option value="digest">Digest + Ligation</option>
              <option value="golden-gate">Golden Gate</option>
            </optgroup>
            <optgroup label="Overlap">
              <option value="gibson">Gibson Assembly</option>
              <option value="infusion">In-Fusion</option>
            </optgroup>
            <optgroup label="Recombination">
              <option value="gateway">Gateway</option>
              <option value="topo">TOPO</option>
            </optgroup>
          </select>
        </div>

        <div className="modal-body cln-body">
          {/* Source sequences: Vector + Insert dropdowns (all methods) */}
          {(
          <div className="cln-section">
            {/* --- Vector / Backbone --- */}
            <div className="cln-section-label">Vector / Backbone</div>
            <div className="cln-source-list">
              {currentVectors.map((src, i) => (
                <div key={i} className="cln-source-chip">
                  <span className="cln-source-name">{src.doc.name}</span>
                  <span className="cln-source-info">
                    {src.doc.sequence.length.toLocaleString()} bp, {src.doc.sequence.topology}
                  </span>
                  {showMethylation && methylationLabel(src) && (
                    <span className="cln-methyl-pill" title="Methylation status from sequence properties">{methylationLabel(src)}</span>
                  )}
                  {method === 'digest' && (
                    <label className="cln-dephos-label" title="Dephosphorylated - prevents self-ligation of this fragment's ends">
                      <input
                        type="checkbox"
                        checked={dephosphorylated.has(i)}
                        onChange={e => {
                          setDephosphorylated(prev => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(i)
                            else next.delete(i)
                            return next
                          })
                        }}
                      />
                      <span className="cln-dephos-text">dephos</span>
                    </label>
                  )}
                  <button className="cln-icon-btn cln-remove" onClick={() => removeSource(i, currentVectorSetter)} title="Remove">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <div className="cln-source-actions">
              <select
                className="select cln-select"
                value=""
                onChange={e => {
                  if (e.target.value) addSourceFromTab(e.target.value, currentVectorSetter)
                }}
              >
                <option value="">Add vector from open tabs...</option>
                {openDocs.map(d => (
                  <option key={d.tabId} value={d.tabId}>
                    {d.name} ({d.size.toLocaleString()} bp, {d.topology})
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" onClick={() => setShowPaste({ setter: currentVectorSetter })}>
                <Plus size={12} /> Paste
              </button>
            </div>

            {/* --- Insert(s) --- */}
            <div className="cln-section-label" style={{ marginTop: 12 }}>Insert(s)</div>
            <div className="cln-source-list">
              {currentInserts.map((src, i) => (
                <div key={i} className="cln-source-chip">
                  <span className="cln-source-name">{src.doc.name}</span>
                  <span className="cln-source-info">
                    {src.doc.sequence.length.toLocaleString()} bp, {src.doc.sequence.topology}
                  </span>
                  {showMethylation && methylationLabel(src) && (
                    <span className="cln-methyl-pill" title="Methylation status from sequence properties">{methylationLabel(src)}</span>
                  )}
                  {method === 'topo' && topoValidation && currentInserts.length === 1 && (
                    <span className={`cln-topo-validation ${topoValidation.valid ? 'valid' : 'invalid'}`}>
                      {topoValidation.valid ? '✓' : '⚠'}
                    </span>
                  )}
                  {(method === 'gibson' || method === 'infusion') && (
                    <span className="cln-source-order">
                      <button
                        className="cln-icon-btn"
                        onClick={() => moveSource(i, -1, currentInsertSetter)}
                        disabled={i === 0}
                        title="Move up"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        className="cln-icon-btn"
                        onClick={() => moveSource(i, 1, currentInsertSetter)}
                        disabled={i === currentInserts.length - 1}
                        title="Move down"
                      >
                        <ArrowDown size={12} />
                      </button>
                    </span>
                  )}
                  <button className="cln-icon-btn cln-remove" onClick={() => removeSource(i, currentInsertSetter)} title="Remove">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <div className="cln-source-actions">
              <select
                className="select cln-select"
                value=""
                onChange={e => {
                  if (e.target.value) addSourceFromTab(e.target.value, currentInsertSetter)
                }}
              >
                <option value="">Add insert from open tabs...</option>
                {openDocs.map(d => (
                  <option key={d.tabId} value={d.tabId}>
                    {d.name} ({d.size.toLocaleString()} bp, {d.topology})
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" onClick={() => setShowPaste({ setter: currentInsertSetter })}>
                <Plus size={12} /> Paste
              </button>
            </div>

            {hasSources && (
              <div style={{ marginTop: 6 }}>
                <button className="btn btn-sm cln-clear-btn" onClick={() => { currentVectorSetter([]); currentInsertSetter([]); setDephosphorylated(new Set()) }}>
                  Clear all
                </button>
              </div>
            )}
          </div>
          )}

          {/* TOPO: variant selector */}
          {method === 'topo' && (
            <div className="cln-section">
              <div className="cln-section-label">Variant</div>
              <div className="cln-radio-group">
                {(['TA', 'Blunt', 'Directional'] as TopoVariant[]).map(v => (
                  <label key={v} className="cln-radio-label">
                    <input type="radio" name="topo-variant" value={v} checked={topoVariant === v} onChange={() => setTopoVariant(v)} />
                    <span>TOPO-{v}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Gateway: reaction type selector */}
          {method === 'gateway' && (
            <div className="cln-section">
              <div className="cln-section-label">Reaction Type</div>
              <div className="cln-radio-group">
                {([['BP', 'BP (attB × attP → Entry clone)'], ['LR', 'LR (attL × attR → Expression clone)'], ['MultiSite', 'MultiSite (2–3 entries → multi-fragment)']] as [GatewayReaction, string][]).map(([val, label]) => (
                  <label key={val} className="cln-radio-label">
                    <input type="radio" name="gw-reaction" value={val} checked={gatewayReaction === val} onChange={() => setGatewayReaction(val)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              {/* Detected att sites */}
              {gatewayDetectedSites.length > 0 && (
                <div className="cln-att-sites">
                  <div className="cln-section-label" style={{ marginTop: 10 }}>Detected att Sites</div>
                  {gatewayDetectedSites.map((src, i) => (
                    <div key={i} className="cln-att-source">
                      <span className="cln-att-source-name">{src.sourceName}</span>
                      {src.sites.length === 0 ? (
                        <span className="cln-att-none">No att sites found</span>
                      ) : (
                        <div className="cln-att-list">
                          {src.sites.map((s, j) => (
                            <span key={j} className={`cln-att-badge ${s.mismatches > 0 ? 'cln-att-mismatch' : ''}`}>
                              {s.site.name} @{s.start}{s.reverseStrand ? ' (RC)' : ''}{s.mismatches > 0 ? ` ${s.mismatches}mm` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Method-specific config */}
          {method === 'digest' && (
            <div className="cln-section">
              <div className="cln-section-label">Enzymes</div>
              <div className="cln-enzyme-chips">
                {digestEnzymeNames.map(name => {
                  const counts = cutCountMap.get(name)
                  const total = totalCuts(counts)
                  const digestSourceCount = digestVectors.length + digestInserts.length
                  const chipCutLabel = digestSourceCount > 0
                    ? digestSourceCount === 1
                      ? `×${total}`
                      : formatCutCounts(counts)
                    : ''
                  return (
                    <span key={name} className={`cln-enzyme-chip ${digestSourceCount > 0 && total === 0 ? 'cln-enzyme-chip-zero' : ''}`}>
                      {name}
                      {chipCutLabel && <span className="cln-chip-cuts">{chipCutLabel}</span>}
                      <button
                        className="cln-chip-remove"
                        onClick={() => setDigestEnzymeNames(prev => prev.filter(n => n !== name))}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  )
                })}
              </div>
              <input
                className="input re-search-input"
                type="text"
                placeholder="Filter enzymes…"
                value={enzymeFilter}
                onChange={e => setEnzymeFilter(e.target.value)}
                spellCheck={false}
                style={{ marginBottom: 4 }}
              />
              <select
                className="select cln-select"
                value=""
                onChange={e => {
                  if (e.target.value && !digestEnzymeNames.includes(e.target.value)) {
                    setDigestEnzymeNames(prev => [...prev, e.target.value])
                  }
                }}
              >
                <option value="">Add enzyme...</option>
                {ENZYME_DB.filter(e => {
                  if (!enzymeFilter.trim()) return true
                  const q = enzymeFilter.trim().toUpperCase()
                  return e.name.toUpperCase().includes(q) || e.recognition.toUpperCase().includes(q)
                }).map(e => {
                  const counts = cutCountMap.get(e.name)
                  const total = totalCuts(counts)
                  const hasDigestSources = digestVectors.length + digestInserts.length > 0
                  const cutLabel = hasDigestSources ? ` – ${formatCutCounts(counts)} cut${total !== 1 ? 's' : ''}` : ''
                  return (
                    <option key={e.name} value={e.name} className={hasDigestSources && total === 0 ? 'cln-enzyme-muted' : ''}>
                      {e.name} ({e.recognition}){cutLabel}
                    </option>
                  )
                })}
              </select>
              <label className="cln-option-label" style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={partialDigest}
                  onChange={e => setPartialDigest(e.target.checked)}
                />
                <span>Partial digest (enumerate incomplete cut combinations)</span>
              </label>
            </div>
          )}

          {method === 'gibson' && (
            <div className="cln-section">
              <div className="cln-section-label">Overlap Settings</div>
              <div className="cln-overlap-row">
                <label>
                  Min overlap:
                  <input
                    type="number"
                    className="input cln-num-input"
                    value={gibsonMinOverlap}
                    onChange={e => setGibsonMinOverlap(Math.max(1, parseInt(e.target.value) || 15))}
                    min={1}
                    max={200}
                  />
                  bp
                </label>
                <label>
                  Max overlap:
                  <input
                    type="number"
                    className="input cln-num-input"
                    value={gibsonMaxOverlap}
                    onChange={e => setGibsonMaxOverlap(Math.max(1, parseInt(e.target.value) || 80))}
                    min={1}
                    max={500}
                  />
                  bp
                </label>
              </div>
              <label className="cln-option-label" style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={gibsonAutoOrder}
                  onChange={e => setGibsonAutoOrder(e.target.checked)}
                />
                <span>Auto-order fragments (try all permutations, ≤ 6 fragments)</span>
              </label>
              {method === 'gibson' && (gibsonVectors.length + gibsonInserts.length) > 0 && !gibsonAutoOrder && (
                <div className="cln-hint">
                  Fragments are assembled in the order shown above. Use arrows to reorder.
                </div>
              )}
              {/* Overlap Tm details (shown after simulation) */}
              {gibsonOverlaps.length > 0 && (
                <div className="cln-overlap-details">
                  <div className="cln-section-label" style={{ marginTop: 10 }}>Overlap Details</div>
                  <table className="cln-overlap-table">
                    <thead>
                      <tr>
                        <th>Junction</th>
                        <th>Length</th>
                        <th>Tm</th>
                        <th>Sequence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gibsonOverlaps.map((ov, i) => (
                        <tr key={i} className={ov.tm < 48 ? 'cln-overlap-low-tm' : ''}>
                          <td>{ov.leftIdx + 1} → {ov.rightIdx + 1}</td>
                          <td>{ov.length} bp</td>
                          <td>{ov.tm > 0 ? `${ov.tm.toFixed(1)}°C` : '–'}</td>
                          <td className="cln-overlap-seq">{ov.sequence.length > 30 ? ov.sequence.slice(0, 27) + '…' : ov.sequence}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {method === 'infusion' && (
            <div className="cln-section">
              <div className="cln-section-label">Overlap Settings</div>
              <div className="cln-overlap-row">
                <label>
                  Min overlap:
                  <input
                    type="number"
                    className="input cln-num-input"
                    value={infusionMinOverlap}
                    onChange={e => setInfusionMinOverlap(Math.max(1, parseInt(e.target.value) || 15))}
                    min={1}
                    max={50}
                  />
                  bp
                </label>
                <label>
                  Max overlap:
                  <input
                    type="number"
                    className="input cln-num-input"
                    value={infusionMaxOverlap}
                    onChange={e => setInfusionMaxOverlap(Math.max(1, parseInt(e.target.value) || 25))}
                    min={1}
                    max={100}
                  />
                  bp
                </label>
              </div>
              <label className="cln-option-label" style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={infusionAutoOrder}
                  onChange={e => setInfusionAutoOrder(e.target.checked)}
                />
                <span>Auto-order fragments (try all permutations, ≤ 6 fragments)</span>
              </label>
              {(infusionVectors.length + infusionInserts.length) > 0 && !infusionAutoOrder && (
                <div className="cln-hint">
                  Fragments are assembled in the order shown above. Use arrows to reorder.
                </div>
              )}
              {/* Overlap details (shown after simulation, no Tm column for In-Fusion) */}
              {method === 'infusion' && gibsonOverlaps.length > 0 && (
                <div className="cln-overlap-details">
                  <div className="cln-section-label" style={{ marginTop: 10 }}>Overlap Details</div>
                  <table className="cln-overlap-table">
                    <thead>
                      <tr>
                        <th>Junction</th>
                        <th>Length</th>
                        <th>Sequence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gibsonOverlaps.map((ov, i) => (
                        <tr key={i}>
                          <td>{ov.leftIdx + 1} → {ov.rightIdx + 1}</td>
                          <td>{ov.length} bp</td>
                          <td className="cln-overlap-seq">{ov.sequence.length > 30 ? ov.sequence.slice(0, 27) + '…' : ov.sequence}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {method === 'golden-gate' && (
            <div className="cln-section">
              <div className="cln-section-label">Type IIS Enzyme</div>
              <select
                className="select cln-select"
                value={ggEnzymeName}
                onChange={e => setGgEnzymeName(e.target.value)}
              >
                {typeIISEnzymes.map(e => {
                  const counts = cutCountMap.get(e.name)
                  const total = totalCuts(counts)
                  const hasGgSources = ggVectors.length + ggInserts.length > 0
                  const cutLabel = hasGgSources ? ` – ${formatCutCounts(counts)} cut${total !== 1 ? 's' : ''}` : ''
                  return (
                    <option key={e.name} value={e.name}>
                      {e.name} ({e.recognition}, cuts +{e.fwd_cut}/+{e.rev_cut}){cutLabel}
                    </option>
                  )
                })}
              </select>
            </div>
          )}

          {/* spacer before results */}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="cln-warnings">
              <button
                className="cln-warnings-header"
                onClick={() => setWarningsExpanded(!warningsExpanded)}
              >
                <AlertTriangle size={14} />
                <span>{warnings.length} warning{warnings.length > 1 ? 's' : ''}</span>
                {warningsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              {warningsExpanded && (
                <ul className="cln-warning-list">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Product preview */}
          {products && products.length > 0 && (
            <div className="cln-section">
              {stale && (
                <div className="cln-stale-banner">
                  Sources changed since last simulation – results may be outdated
                </div>
              )}
              <div className="cln-section-label">
                Products ({products.length} found, {products.filter(p => p.isExpected).length} expected)
              </div>
              {batchResults ? (
                <div className="cln-product-list">
                  {(() => {
                    let globalIdx = 0
                    return batchResults.map((group, gi) => (
                      <div key={gi} className="cln-batch-group">
                        <div className="cln-batch-group-header">{group.insertName}</div>
                        {group.warnings.length > 0 && (
                          <ul className="cln-batch-group-warnings">
                            {group.warnings.map((w, wi) => <li key={wi}>{w}</li>)}
                          </ul>
                        )}
                        {group.products.length === 0 && (
                          <div className="cln-batch-group-empty">No products</div>
                        )}
                        {group.products.map((p) => {
                          const idx = globalIdx++
                          return (
                            <label key={idx} className={`cln-product-item ${idx === selectedProductIdx ? 'selected' : ''}`}>
                              <input
                                type="radio"
                                name="cln-product"
                                checked={idx === selectedProductIdx}
                                onChange={() => setSelectedProductIdx(idx)}
                              />
                              <div className="cln-product-info">
                                <div className="cln-product-header">
                                  <span className="cln-product-size">{p.size.toLocaleString()} bp</span>
                                  <span className="cln-product-topo">{p.topology}</span>
                                  {p.isExpected && <span className="cln-product-expected">★ expected</span>}
                                  {!p.isExpected && <span className="cln-product-offtarget">off-target</span>}
                                </div>
                                <div className="cln-product-desc">{p.description}</div>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    ))
                  })()}
                </div>
              ) : (
                <div className="cln-product-list">
                  {products.map((p, i) => (
                    <label key={i} className={`cln-product-item ${i === selectedProductIdx ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="cln-product"
                        checked={i === selectedProductIdx}
                        onChange={() => setSelectedProductIdx(i)}
                      />
                      <div className="cln-product-info">
                        <div className="cln-product-header">
                          <span className="cln-product-size">
                            {p.size.toLocaleString()} bp
                          </span>
                          <span className="cln-product-topo">{p.topology}</span>
                          {p.isExpected && <span className="cln-product-expected">★ expected</span>}
                          {!p.isExpected && <span className="cln-product-offtarget">off-target</span>}
                        </div>
                        <div className="cln-product-desc">{p.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {/* Annotation transfer */}
              {products[selectedProductIdx]?.annotations.length > 0 && (
                <div className="cln-annotations-section">
                  <div className="cln-section-label">
                    <span>Annotations to transfer ({products[selectedProductIdx].annotations.filter(a => annotationSelections.get(a.id) !== false).length}/{products[selectedProductIdx].annotations.length})</span>
                    <span className="cln-ann-actions">
                      <button
                        className="cln-ann-toggle-btn"
                        onClick={() => {
                          const next = new Map(annotationSelections)
                          for (const ann of products[selectedProductIdx].annotations) next.set(ann.id, true)
                          setAnnotationSelections(next)
                        }}
                      >All</button>
                      <button
                        className="cln-ann-toggle-btn"
                        onClick={() => {
                          const next = new Map(annotationSelections)
                          for (const ann of products[selectedProductIdx].annotations) next.set(ann.id, false)
                          setAnnotationSelections(next)
                        }}
                      >None</button>
                    </span>
                  </div>
                  <div className="cln-annotation-list">
                    {products[selectedProductIdx].annotations.map(ann => (
                      <label key={ann.id} className="cln-annotation-item">
                        <input
                          type="checkbox"
                          checked={annotationSelections.get(ann.id) !== false}
                          onChange={e => {
                            setAnnotationSelections(prev => {
                              const next = new Map(prev)
                              next.set(ann.id, e.target.checked)
                              return next
                            })
                          }}
                        />
                        <span className="cln-ann-name">{ann.name}</span>
                        <span className="cln-ann-type">{ann.type}</span>
                        <span className="cln-ann-span">{(ann.end - ann.start).toLocaleString()} bp</span>
                        {ann.truncated && <span className="cln-ann-truncated" title="Truncated at cloning junction">truncated</span>}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {products && products.length === 0 && !simulating && !batchResults && (
            <div className="cln-no-products">
              No products could be assembled. Check the warnings above.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <div style={{ flex: 1 }} />
          <button
            className={`btn btn-primary ${stale ? 'cln-stale-btn' : ''}`}
            onClick={handleSimulate}
            disabled={!canSimulate || simulating}
          >
            {simulating ? (
              <>
                <Loader2 size={14} className="cln-spin" /> Simulating…
              </>
            ) : stale ? (
              'Re-simulate'
            ) : (
              'Simulate'
            )}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleOpenProduct}
            disabled={!products || products.length === 0}
          >
            Open Product
          </button>
        </div>
      </div>

      {/* Paste sequence sub-modal */}
      {showPaste && (
        <div className="cln-paste-overlay" onClick={e => { if (e.target === e.currentTarget) setShowPaste(null) }}>
          <div className="cln-paste-dialog">
            <div className="modal-header">
              <h3 className="modal-title">Paste Sequence</h3>
              <button className="modal-close" onClick={() => setShowPaste(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <label className="cln-paste-label">
                Name
                <input
                  className="input cln-paste-input"
                  value={pasteName}
                  onChange={e => setPasteName(e.target.value)}
                  placeholder="Sequence name"
                />
              </label>
              <label className="cln-paste-label">
                Sequence (raw DNA)
                <textarea
                  className="input cln-paste-textarea"
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder="Paste DNA sequence (A, T, G, C)..."
                  rows={6}
                />
              </label>
              <div className="cln-paste-info">
                {pasteText.replace(/[^A-Za-z]/g, '').length.toLocaleString()} bp
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowPaste(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={() => addPastedSource(showPaste.setter)}
                disabled={pasteText.replace(/[^A-Za-z]/g, '').length === 0}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
