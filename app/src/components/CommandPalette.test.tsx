import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import CommandPalette from './CommandPalette'
import type { Command } from '../commands'

function setup(overrides: Partial<Record<string, unknown>> = {}) {
  const ran: string[] = []
  const onClose = vi.fn()
  const commands: Command[] = [
    { id: 'orfs', label: 'Find ORFs', group: 'Analyse', run: () => ran.push('orfs') },
    { id: 'primers', label: 'Design Primers', group: 'Analyse', run: () => ran.push('primers') },
    { id: 'gel', label: 'Virtual Gel', group: 'Analyse', run: () => ran.push('gel') },
    { id: 'export', label: 'Export', group: 'File', disabled: true, run: () => ran.push('export') },
  ]
  render(<CommandPalette open onClose={onClose} commands={commands} {...overrides} />)
  return { ran, onClose, commands }
}

const activeLabel = () =>
  document.querySelector('[data-active="true"] .cp-row-label')?.textContent

describe('CommandPalette', () => {
  it('lists every command when the query is empty', () => {
    setup()
    expect(screen.getByText('Find ORFs')).toBeTruthy()
    expect(screen.getByText('Design Primers')).toBeTruthy()
    expect(screen.getByText('Export')).toBeTruthy()
  })

  it('groups commands under their section heading', () => {
    setup()
    const groups = [...document.querySelectorAll('.cp-group')].map(n => n.textContent)
    expect(groups).toContain('Analyse')
    expect(groups).toContain('File')
  })

  it('filters as the user types', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByRole('combobox'), 'gel')
    expect(screen.getByText(/Virtual/)).toBeTruthy()
    expect(screen.queryByText('Design Primers')).toBeNull()
  })

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByRole('combobox'), 'zzzz')
    expect(screen.getByText('No matching command')).toBeTruthy()
  })

  it('runs the selected command on Enter and closes', async () => {
    const user = userEvent.setup()
    const { ran, onClose } = setup()
    await user.type(screen.getByRole('combobox'), 'gel')
    await user.keyboard('{Enter}')
    expect(ran).toEqual(['gel'])
    expect(onClose).toHaveBeenCalled()
  })

  it('moves the selection with the arrow keys', async () => {
    const user = userEvent.setup()
    setup()
    expect(activeLabel()).toBe('Find ORFs')
    await user.keyboard('{ArrowDown}')
    expect(activeLabel()).toBe('Design Primers')
    await user.keyboard('{ArrowUp}')
    expect(activeLabel()).toBe('Find ORFs')
  })

  it('skips disabled commands when navigating and wraps around', async () => {
    const user = userEvent.setup()
    setup()
    // Enabled rows are ORFs, Primers, Gel; Export is disabled and comes last.
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(activeLabel()).toBe('Virtual Gel')
    // Wrapping past the end must land back on the first enabled row, not Export.
    await user.keyboard('{ArrowDown}')
    expect(activeLabel()).toBe('Find ORFs')
  })

  it('does not run a disabled command', async () => {
    const user = userEvent.setup()
    const { ran, onClose } = setup()
    await user.type(screen.getByRole('combobox'), 'export')
    await user.keyboard('{Enter}')
    expect(ran).toEqual([])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape without running anything', async () => {
    const user = userEvent.setup()
    const { ran, onClose } = setup()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    expect(ran).toEqual([])
  })

  it('exposes the active row to assistive tech', async () => {
    const user = userEvent.setup()
    setup()
    const input = screen.getByRole('combobox')
    expect(input.getAttribute('aria-activedescendant')).toBe('cp-opt-orfs')
    await user.keyboard('{ArrowDown}')
    expect(input.getAttribute('aria-activedescendant')).toBe('cp-opt-primers')
  })

  it('renders nothing when closed', () => {
    const onClose = vi.fn()
    act(() => {
      render(<CommandPalette open={false} onClose={onClose} commands={[]} />)
    })
    expect(document.querySelector('.cp-dialog')).toBeNull()
  })
})
