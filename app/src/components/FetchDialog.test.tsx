/**
 * Fetching from NCBI: a chromosome-sized record is confirmed before it is
 * downloaded (M15), and only NCBI is offered (M14).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const ncbi = vi.hoisted(() => ({
  summary: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('../fetch/ncbi', async importOriginal => ({
  ...(await importOriginal<typeof import('../fetch/ncbi')>()),
  ncbiRecordSummary: ncbi.summary,
  fetchNCBI: ncbi.fetch,
}))

import FetchDialog from './FetchDialog'
import { formatBp } from '../utils/format'
import { ncbiRecordSummary } from '../fetch/ncbi'

const GB = 'LOCUS       pX   12 bp    DNA     linear\nORIGIN\n        1 atgaaatttg gg\n//\n'

beforeEach(() => {
  ncbi.summary.mockReset()
  ncbi.fetch.mockReset().mockResolvedValue(GB)
})

function open() {
  const onFetched = vi.fn()
  render(<FetchDialog open onClose={() => {}} onFetched={onFetched} />)
  fireEvent.change(screen.getByPlaceholderText(/L09137/), { target: { value: 'NC_000001.11' } })
  return onFetched
}

describe('FetchDialog', () => {
  it('offers NCBI only, and says how to bring in Addgene or SnapGene files', () => {
    open()
    expect(screen.queryByRole('button', { name: 'Addgene' })).toBeNull()
    expect(screen.getByText(/download the GenBank or \.dna file from their site/)).toBeTruthy()
  })

  it('asks before downloading a very large record', async () => {
    ncbi.summary.mockResolvedValue({ length: 248_956_422, title: 'Homo sapiens chromosome 1' })
    const onFetched = open()
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    const confirm = await screen.findByRole('button', { name: /Download 248\.96 Mb anyway/ })
    expect(ncbi.fetch).not.toHaveBeenCalled()

    fireEvent.click(confirm)
    await waitFor(() => expect(onFetched).toHaveBeenCalled())
    expect(ncbi.fetch).toHaveBeenCalledTimes(1)
  })

  it('fetches a normal record straight away', async () => {
    ncbi.summary.mockResolvedValue({ length: 2686, title: 'pUC19' })
    const onFetched = open()
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    await waitFor(() => expect(onFetched).toHaveBeenCalled())
    expect(onFetched.mock.calls[0][0][0].sequence.length).toBe(12)
  })

  it('confirms a large download with Enter, where Enter used to ask again', async () => {
    ncbi.summary.mockResolvedValue({ length: 248_956_422, title: 'chr1' })
    const onFetched = open()
    const input = screen.getByPlaceholderText(/L09137/)
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByRole('button', { name: /anyway/ })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onFetched).toHaveBeenCalled())
    // The size check ran once for the fetch; Enter confirmed rather than asking again.
    expect(ncbi.fetch).toHaveBeenCalledTimes(1)
  })

  it('previews the typed accession before anything is downloaded', async () => {
    ncbi.summary.mockResolvedValue({ length: 2686, title: 'Cloning vector pUC19' })
    render(<FetchDialog open onClose={() => {}} onFetched={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/L09137/), { target: { value: 'L09137.2' } })
    expect(await screen.findByText('Cloning vector pUC19')).toBeTruthy()
    expect(document.querySelector('.fetch-preview-len')?.textContent).toBe(formatBp(2686))
    expect(ncbi.fetch).not.toHaveBeenCalled()
  })

  it('says when the typed accession does not exist', async () => {
    ncbi.summary.mockRejectedValue(new Error('not found'))
    render(<FetchDialog open onClose={() => {}} onFetched={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/L09137/), { target: { value: 'XX999999' } })
    expect(await screen.findByText('No record XX999999 in NCBI Nucleotide')).toBeTruthy()
  })

  it('offers the accessions fetched lately while the box is empty', async () => {
    localStorage.removeItem('seqnexus.fetch.recent')
    ncbi.summary.mockResolvedValue(null)
    const { unmount } = render(<FetchDialog open onClose={() => {}} onFetched={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/L09137/), { target: { value: 'L09137.2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    await waitFor(() => expect(ncbi.fetch).toHaveBeenCalled())
    unmount()
    render(<FetchDialog open onClose={() => {}} onFetched={vi.fn()} />)
    const chip = await screen.findByRole('button', { name: 'L09137.2' })
    fireEvent.click(chip)
    expect((screen.getByPlaceholderText(/L09137/) as HTMLInputElement).value).toBe('L09137.2')
  })

  it('opens nothing when closed while the fetch is running', async () => {
    ncbi.summary.mockResolvedValue(null)
    let release!: (text: string) => void
    ncbi.fetch.mockReturnValue(new Promise<string>(r => { release = r }))
    const onFetched = vi.fn()
    const { rerender } = render(<FetchDialog open onClose={() => {}} onFetched={onFetched} />)
    fireEvent.change(screen.getByPlaceholderText(/L09137/), { target: { value: 'L09137.2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    await waitFor(() => expect(ncbi.fetch).toHaveBeenCalled())
    rerender(<FetchDialog open={false} onClose={() => {}} onFetched={onFetched} />)
    release(GB)
    await new Promise(r => setTimeout(r, 50))
    expect(onFetched).not.toHaveBeenCalled()
  })

  it('fetches several accessions and keeps the ones that failed to try again', async () => {
    ncbi.summary.mockResolvedValue(null)
    ncbi.fetch.mockImplementation(async (acc: string) => {
      if (acc === 'BAD1') throw new Error('Accession "BAD1" not found in NCBI Nucleotide.')
      return GB
    })
    const onFetched = vi.fn()
    const onClose = vi.fn()
    render(<FetchDialog open onClose={onClose} onFetched={onFetched} />)
    fireEvent.change(screen.getByPlaceholderText(/L09137/), { target: { value: 'L09137.2, BAD1 J01636' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch 3' }))
    await waitFor(() => expect(onFetched).toHaveBeenCalled())
    expect(onFetched.mock.calls[0][0]).toHaveLength(2)
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByPlaceholderText(/L09137/) as HTMLInputElement).value).toBe('BAD1')
    expect(screen.getByRole('alert').textContent).toMatch(/BAD1: Accession "BAD1" not found/)
  })
})

describe('ncbiRecordSummary', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('reads length and title from the summary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      result: { uids: ['1'], 1: { slen: 2686, title: 'pUC19' } },
    }))))
    const real = (await vi.importActual<typeof import('../fetch/ncbi')>('../fetch/ncbi')).ncbiRecordSummary
    expect(await real('L09137.2')).toEqual({ length: 2686, title: 'pUC19' })
    expect(ncbiRecordSummary).not.toBe(real)
  })

  it('says when NCBI does not know the accession', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Invalid uid', result: { uids: [] } }))))
    const real = (await vi.importActual<typeof import('../fetch/ncbi')>('../fetch/ncbi')).ncbiRecordSummary
    await expect(real('NOTREAL')).rejects.toThrow(/not found/)
  })

  it('gives up quietly when the summary is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const real = (await vi.importActual<typeof import('../fetch/ncbi')>('../fetch/ncbi')).ncbiRecordSummary
    expect(await real('L09137.2')).toBeNull()
  })
})
