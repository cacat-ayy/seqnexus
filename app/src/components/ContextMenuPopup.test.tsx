import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ContextMenuPopup, { MenuItem, MenuSeparator, Submenu } from './ContextMenuPopup'

function setup() {
  const onClose = vi.fn()
  const onSelect = vi.fn()
  const onFasta = vi.fn()
  render(
    <ContextMenuPopup x={10} y={10} onClose={onClose} label="Test actions">
      <MenuItem onSelect={onSelect}>Select Annotation</MenuItem>
      <Submenu label="Copy Annotation">
        <MenuItem onSelect={() => {}}>Bases</MenuItem>
        <MenuItem onSelect={onFasta}>FASTA</MenuItem>
      </Submenu>
      <MenuSeparator />
      <MenuItem onSelect={() => {}} disabled>Unavailable</MenuItem>
      <MenuItem onSelect={() => {}} shortcut="Ctrl+C">Paste Reverse Complement</MenuItem>
    </ContextMenuPopup>,
  )
  return { onClose, onSelect, onFasta, user: userEvent.setup() }
}

describe('ContextMenuPopup', () => {
  it('takes focus on open so the keyboard works at once', () => {
    setup()
    expect(screen.getByRole('menu', { name: 'Test actions' })).toHaveFocus()
  })

  it('moves through items with the arrows, skipping disabled ones and wrapping', async () => {
    const { user } = setup()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Select Annotation' })).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: /Paste Reverse Complement/ })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Select Annotation' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: /Paste Reverse Complement/ })).toHaveFocus()
  })

  it('jumps to an item by its first letter', async () => {
    const { user } = setup()
    await user.keyboard('p')
    expect(screen.getByRole('menuitem', { name: /Paste Reverse Complement/ })).toHaveFocus()
  })

  it('runs an item on Enter', async () => {
    const { user, onSelect } = setup()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('closes on Escape', async () => {
    const { user, onClose } = setup()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('opens a submenu with ArrowRight, and ArrowLeft returns to its trigger', async () => {
    const { user, onClose } = setup()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    const trigger = screen.getByRole('menuitem', { name: 'Copy Annotation' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{ArrowRight}')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: 'Bases' })).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.queryByRole('menuitem', { name: 'Bases' })).toBeNull()
    expect(trigger).toHaveFocus()
    // Escape inside a submenu closes only the submenu.
    await user.keyboard('{ArrowRight}{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
  })

  it('opens a submenu on hover and runs its items on click', async () => {
    const { user, onFasta } = setup()
    await user.hover(screen.getByRole('menuitem', { name: 'Copy Annotation' }))
    await user.click(await screen.findByRole('menuitem', { name: 'FASTA' }))
    expect(onFasta).toHaveBeenCalledOnce()
  })

  it('shows a shortcut hint beside its item', () => {
    setup()
    expect(screen.getByRole('menuitem', { name: /Paste Reverse Complement/ })).toHaveTextContent('Ctrl+C')
  })
})
