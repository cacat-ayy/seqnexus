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

import FetchModal from './FetchModal'
import { ncbiRecordSummary } from '../fetch/ncbi'

const GB = 'LOCUS       pX   12 bp    DNA     linear\nORIGIN\n        1 atgaaatttg gg\n//\n'

beforeEach(() => {
  ncbi.summary.mockReset()
  ncbi.fetch.mockReset().mockResolvedValue(GB)
})

function open() {
  const onFetched = vi.fn()
  render(<FetchModal open onClose={() => {}} onFetched={onFetched} />)
  fireEvent.change(screen.getByPlaceholderText(/L09137/), { target: { value: 'NC_000001.11' } })
  return onFetched
}

describe('FetchModal', () => {
  it('offers NCBI only, and says how to bring in Addgene or SnapGene files', () => {
    open()
    expect(screen.queryByRole('button', { name: 'Addgene' })).toBeNull()
    expect(screen.getByText(/download the GenBank or \.dna file from their site/)).toBeTruthy()
  })

  it('asks before downloading a very large record', async () => {
    ncbi.summary.mockResolvedValue({ length: 248_956_422, title: 'Homo sapiens chromosome 1' })
    const onFetched = open()
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    const confirm = await screen.findByRole('button', { name: /Download 249\.0 Mb anyway/ })
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
    expect(onFetched.mock.calls[0][0].sequence.length).toBe(12)
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
