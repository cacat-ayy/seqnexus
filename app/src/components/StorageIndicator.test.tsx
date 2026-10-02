import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import StorageIndicator from './StorageIndicator'
import { DEFAULT_RECORD, useBackupStore } from '../backup/backup'

const DAY = 24 * 60 * 60 * 1000

describe('StorageIndicator backup details', () => {
  beforeEach(() => {
    // jsdom has no storage manager, so the meter falls back to measuring
    // localStorage, and needs something in it to show at all.
    localStorage.setItem('seqnexus:test-filler', 'x'.repeat(100))
    useBackupStore.setState({ record: DEFAULT_RECORD, persisted: false, canPersist: false })
  })
  afterEach(() => {
    cleanup()
    localStorage.removeItem('seqnexus:test-filler')
    localStorage.removeItem('seqnexus:backup')
  })

  it('marks an overdue backup and opens the details on click', async () => {
    useBackupStore.setState({ record: { ...DEFAULT_RECORD, firstUnbackedChangeAt: Date.now() - 9 * DAY } })
    const onBackup = vi.fn()
    const { container } = render(<StorageIndicator onBackup={onBackup} />)
    const trigger = await screen.findByRole('button', { name: /storage and backup/i })
    expect(container.querySelector('.storage-indicator-due')).not.toBeNull()

    fireEvent.click(trigger)
    expect(screen.getByText('Never', { selector: 'span' })).toBeTruthy()
    expect(screen.getByText('Changes from the last 9 days are only in this browser.')).toBeTruthy()
    expect(screen.getByText('May be cleared')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back up now…' }))
    expect(onBackup).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('changes how often to remind', async () => {
    render(<StorageIndicator />)
    fireEvent.click(await screen.findByRole('button', { name: /storage and backup/i }))
    act(() => { fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } }) })
    expect(useBackupStore.getState().record.reminderDays).toBe(0)
    expect(JSON.parse(localStorage.getItem('seqnexus:backup')!).reminderDays).toBe(0)
  })
})
