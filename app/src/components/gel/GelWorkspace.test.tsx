import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEditorStore } from '../../store'
import GelWorkspace from './GelWorkspace'
import { parseSizes } from '../../gel/parse'

const fill = (n: number) => 'ACGT'.repeat(Math.ceil(n / 4)).slice(0, n)
// EcoRI at 100 and BamHI at 1500: both single cutters, fragments 1400 and 2600.
const BASES = (() => {
  let s = fill(4000)
  s = s.slice(0, 100) + 'GAATTC' + s.slice(106)
  return s.slice(0, 1500) + 'GGATCC' + s.slice(1506)
})()

function setup(): string {
  localStorage.clear()
  const store = useEditorStore.getState()
  for (const t of [...store.tabs]) store.closeTab(t.id)
  useEditorStore.setState({ gels: [], activeGelId: null, gelReturnTabId: null, recentlyDeleted: [] })
  const id = useEditorStore.getState().openDocument('pTest', BASES, 'circular')
  useEditorStore.setState({ enzymeNames: ['EcoRI', 'BamHI'] })
  useEditorStore.getState().createGel()
  return id
}

/** Renders whichever gel is open, as App does. */
function Harness() {
  const gel = useEditorStore(s => s.gels.find(g => g.id === s.activeGelId))
  return gel
    ? <GelWorkspace key={gel.id} gel={gel} onClose={() => useEditorStore.getState().setActiveGel(null)} />
    : <div>no gel</div>
}

const gelState = () => {
  const s = useEditorStore.getState()
  return s.gels.find(g => g.id === s.activeGelId)!
}

describe('GelWorkspace', () => {
  let tabId = ''
  beforeEach(() => { tabId = setup() })

  it('starts with a ladder, the open sequence uncut, and a digest from its map', () => {
    render(<Harness />)
    expect(screen.getByText('3 / 20 lanes')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Gel name' })).toHaveValue('pTest gel')
    expect(screen.getByRole('tab', { name: 'Lane 2' })).toHaveAttribute('aria-selected', 'true')
    // Rows run top of the gel first: nicked lags, supercoiled runs furthest.
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.map(r => within(r).getAllByRole('cell')[1].textContent)).toEqual(['nicked', 'linear', 'supercoiled'])
    expect(gelState().state.lanes[2].sample).toMatchObject({ enzymes: ['EcoRI', 'BamHI'] })
  })

  it('adds enzymes typed into the enzyme field', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByRole('combobox', { name: 'Enzymes' }), 'EcoRI+')
    expect(screen.getByText('EcoRI', { selector: '.gw-enzyme-chip' })).toBeInTheDocument()
    expect(screen.getByText('4.0 kb', { selector: 'td' })).toBeInTheDocument()
    expect(screen.getByText('EcoRI / EcoRI')).toBeInTheDocument()
  })

  it('undoes and redoes with Ctrl+Z and Ctrl+Y', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Remove lane' }))
    expect(screen.getByText('2 / 20 lanes')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(screen.getByText('3 / 20 lanes')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(screen.getByText('2 / 20 lanes')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true })
    expect(screen.getByText('2 / 20 lanes')).toBeInTheDocument()
  })

  it('leaves Ctrl+Z to a text field that has focus', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('radio', { name: 'Empty' }))
    const label = screen.getByRole('textbox', { name: 'Lane label' })
    fireEvent.keyDown(label, { key: 'z', ctrlKey: true })
    expect(gelState().state.lanes[1].sample.kind).toBe('empty')
  })

  it('makes typing a label one undo step', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByRole('textbox', { name: 'Lane label' }), 'clone 7')
    expect(gelState().state.lanes[1].label).toBe('clone 7')
    expect(gelState().undoStack).toHaveLength(1)
    act(() => useEditorStore.getState().undoGel(gelState().id))
    expect(gelState().state.lanes[1].label).toBeUndefined()
  })

  it('switches a lane to a ladder and lists its bands', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('radio', { name: 'Ladder' }))
    expect(screen.getByText(/^Bands/)).toBeInTheDocument()
    expect(screen.getByText('ref', { selector: '.gw-pill' })).toBeInTheDocument()
  })

  it('runs typed-in sizes', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('radio', { name: 'Sizes' }))
    await user.type(screen.getByRole('textbox', { name: 'Band sizes' }), '3000, 1.2 kb')
    expect(gelState().state.lanes[1].sample).toMatchObject({ kind: 'sizes', sizes: [3000, 1200] })
  })

  it('runs a PCR with primers from the library', async () => {
    const user = userEvent.setup()
    // A random template, so each primer binds once. (The repeat filler the
    // other tests use would give every primer a thousand sites.)
    let seed = 11
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const template = Array.from({ length: 3000 }, () => 'ACGT'[Math.floor(rnd() * 4)]).join('')
    const rc = (s: string) => s.split('').reverse().map(c => ({ A: 'T', T: 'A', G: 'C', C: 'G' }[c]!)).join('')
    act(() => {
      // Forward binds at 200, reverse ends at 800: a 600 bp product.
      useEditorStore.getState().addLibraryOligos([
        { name: 'F1', sequence: template.slice(200, 222), role: 'primer' },
        { name: 'R1', sequence: rc(template.slice(778, 800)), role: 'primer' },
      ])
      const s = useEditorStore.getState()
      s.openDocument('tmpl', template, 'linear')
      s.setActiveGel(s.gels[0].id)
    })
    render(<Harness />)
    await user.click(screen.getByRole('radio', { name: 'PCR' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Template' }), 'tmpl (3.0 kb, linear)')
    expect(screen.getByText(/^Products/)).toBeInTheDocument()
    expect(screen.getByText('600 bp', { selector: 'td' })).toBeInTheDocument()
  })

  it('cuts a fragment out as a new sequence', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    // Pick lane 3, the EcoRI + BamHI digest, from the keyboard.
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowRight' })
    await user.click(screen.getByRole('button', { name: /Extract the 1\.4 kb fragment/ }))
    const s = useEditorStore.getState()
    expect(s.activeGelId).toBeNull()
    expect(s.doc.sequence.length).toBe(1400)
    expect(s.doc.metadata?.origin).toBe('gel')
    expect(s.doc.description).toMatch(/Left end: EcoRI, 5' overhang AATT/)
  })

  it('edits gel conditions in the gel tab, undoably', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('tab', { name: /Gel/ }))
    await user.click(screen.getByRole('radio', { name: 'TBE' }))
    expect(screen.getByRole('button', { name: /1\.0% · TBE/ })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(screen.getByRole('button', { name: /1\.0% · TAE/ })).toBeInTheDocument()
  })

  it('renames the gel from the header', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const name = screen.getByRole('textbox', { name: 'Gel name' })
    await user.clear(name)
    await user.type(name, 'Diagnostic{Enter}')
    expect(gelState().name).toBe('Diagnostic')
  })

  it('closes back to the sequence it was opened from', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Close the gel' }))
    expect(screen.getByText('no gel')).toBeInTheDocument()
    expect(useEditorStore.getState().activeTabId).toBe(tabId)
  })
})

describe('gels in the store', () => {
  beforeEach(() => { setup() })

  it('close when another item is activated', () => {
    const s = useEditorStore.getState()
    const other = s.openDocument('other', fill(100), 'linear')
    s.createGel()
    useEditorStore.getState().setActiveTab(other)
    expect(useEditorStore.getState().activeGelId).toBeNull()
  })

  it('come back from the delete buffer', () => {
    const id = useEditorStore.getState().activeGelId!
    useEditorStore.getState().removeGel(id)
    expect(useEditorStore.getState().gels).toHaveLength(0)
    useEditorStore.getState().undoDelete()
    expect(useEditorStore.getState().gels.map(g => g.id)).toEqual([id])
    expect(useEditorStore.getState().activeGelId).toBe(id)
  })

  it('duplicate with a fresh history', () => {
    const s = useEditorStore.getState()
    const id = s.activeGelId!
    s.updateGel(id, st => ({ ...st, lanes: st.lanes.slice(1) }))
    const copy = useEditorStore.getState().duplicateGel(id)!
    const g = useEditorStore.getState().gels.find(x => x.id === copy)!
    expect(g.state.lanes).toHaveLength(2)
    expect(g.undoStack).toHaveLength(0)
    expect(g.name).toMatch(/copy$/)
  })

  it('coalesce keyed edits and not unkeyed ones', () => {
    const s = useEditorStore.getState()
    const id = s.activeGelId!
    s.updateGel(id, st => ({ ...st, conditions: { ...st.conditions, agarosePct: 1.1 } }), 'pct')
    s.updateGel(id, st => ({ ...st, conditions: { ...st.conditions, agarosePct: 1.2 } }), 'pct')
    s.updateGel(id, st => ({ ...st, conditions: { ...st.conditions, agarosePct: 1.3 } }))
    expect(useEditorStore.getState().gels[0].undoStack).toHaveLength(2)
  })
})

describe('parseSizes', () => {
  it('reads bp and kb, ignoring junk', () => {
    expect(parseSizes('3000, 1.2 kb; 450bp and 0')).toEqual([3000, 1200, 450])
  })
})

describe('digest designer', () => {
  function randomDna(n: number, seed: number): string {
    let s = seed
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
    return Array.from({ length: n }, () => 'ACGT'[Math.floor(rnd() * 4)]).join('')
  }

  it('finds a digest that separates a clone from its vector and lays it out', async () => {
    setup()
    const vector = randomDna(3000, 1)
    const clone = vector.slice(0, 1500) + randomDna(1200, 2) + vector.slice(1500)
    act(() => {
      const s = useEditorStore.getState()
      s.openDocument('vector', vector, 'circular')
      s.openDocument('clone', clone, 'circular')
      s.setActiveGel(s.gels[0].id)
    })
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /Design digest/ }))
    const group = screen.getByRole('group', { name: 'Candidate sequences' })
    // The gel's own sequence starts ticked; swap it for the two to compare.
    await user.click(within(group).getByText('pTest'))
    await user.click(within(group).getByText('clone'))
    await user.click(within(group).getByText('vector'))
    await user.click(screen.getByRole('button', { name: /Find digests/ }))
    const apply = await screen.findAllByRole('button', { name: 'Put on the gel' }, { timeout: 5000 })
    await user.click(apply[0])

    const lanes = gelState().state.lanes
    expect(lanes.map(l => l.sample.kind)).toEqual(['ladder', 'sequence', 'sequence'])
    expect(lanes.slice(1).map(l => l.label)).toEqual(['clone', 'vector'])
    const enzymes = lanes[1].sample.kind === 'sequence' ? lanes[1].sample.enzymes : []
    expect(enzymes.length).toBeGreaterThan(0)
    // One undo step puts the old gel back.
    act(() => useEditorStore.getState().undoGel(gelState().id))
    expect(gelState().state.lanes).toHaveLength(3)
    expect(gelState().state.lanes[0].sample.kind).toBe('ladder')
    expect(gelState().state.lanes[1].label).toBeUndefined()
  })
})

describe('digest designer candidate list', () => {
  function openMany(n: number) {
    setup()
    act(() => {
      const s = useEditorStore.getState()
      for (let i = 1; i <= n; i++) s.openDocument(`seq ${i}`, 'ACGT'.repeat(100 + i), 'linear')
      s.setActiveGel(s.gels[0].id)
    })
  }

  it('letters the picks only once there are two to tell apart', async () => {
    openMany(1)
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /Design digest/ }))
    const picked = () => screen.getByLabelText('Picked sequences')
    // The gel's own sequence starts picked, alone: no letter.
    expect(within(picked()).queryByText('A')).toBeNull()
    await user.click(within(screen.getByRole('group', { name: 'Candidate sequences' })).getByText('seq 1'))
    expect(within(picked()).getByText('A')).toBeInTheDocument()
    expect(within(picked()).getByText('B')).toBeInTheDocument()
    expect(screen.getByText(/Letters mark each sequence's lane/)).toBeInTheDocument()
    // Removing a chip unpicks it.
    await user.click(screen.getByRole('button', { name: 'Remove seq 1' }))
    expect(within(picked()).queryByText('B')).toBeNull()
  })

  it('lists the gel\'s sequences first and searches a long list', async () => {
    openMany(12)
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /Design digest/ }))
    const group = screen.getByRole('group', { name: 'Candidate sequences' })
    const names = () => [...group.querySelectorAll('.gw-dd-name')].map(e => e.textContent)
    // The gel's sequence, then the one being viewed (the last opened), then by name.
    expect(names().slice(0, 3)).toEqual(['pTest', 'seq 12', 'seq 1'])
    // Natural order: seq 2 before seq 10.
    expect(names().indexOf('seq 2')).toBeLessThan(names().indexOf('seq 10'))
    await user.type(screen.getByRole('searchbox', { name: 'Search sequences' }), 'seq 1')
    expect(names()).toEqual(['seq 12', 'seq 1', 'seq 10', 'seq 11'])
    await user.clear(screen.getByRole('searchbox', { name: 'Search sequences' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search sequences' }), 'nothing like it')
    expect(screen.getByText(/No sequences match/)).toBeInTheDocument()
  })

  it('stops at eight and says so', async () => {
    openMany(10)
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /Design digest/ }))
    const group = screen.getByRole('group', { name: 'Candidate sequences' })
    for (let i = 1; i <= 7; i++) await user.click(within(group).getByText(`seq ${i}`))
    expect(screen.getByText('8 of up to 8 picked')).toBeInTheDocument()
    const box = within(group).getByText('seq 9').closest('label')!.querySelector('input')!
    expect(box).toBeDisabled()
  })
})
