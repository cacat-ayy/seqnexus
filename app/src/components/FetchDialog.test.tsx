/**
 * Fetching from NCBI: a chromosome-sized record is confirmed before it is
 * downloaded (M15), and only NCBI is offered (M14).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const ncbi = vi.hoisted(() => ({
  summary: vi.fn(),
  fetch: vi.fn(),
  gene: vi.fn(),
}))

vi.mock('../fetch/ncbi', async importOriginal => ({
  ...(await importOriginal<typeof import('../fetch/ncbi')>()),
  ncbiRecordSummary: ncbi.summary,
  fetchNCBI: ncbi.fetch,
  ncbiGene: ncbi.gene,
}))

import FetchDialog from './FetchDialog'
import { formatBp } from '../utils/format'
import { ncbiRecordSummary, ncbiGene } from '../fetch/ncbi'

const GB = 'LOCUS       pX   12 bp    DNA     linear\nORIGIN\n        1 atgaaatttg gg\n//\n'

beforeEach(() => {
  ncbi.summary.mockReset()
  ncbi.fetch.mockReset().mockResolvedValue(GB)
  ncbi.gene.mockReset()
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

describe('FetchDialog: Gene IDs, regions and complements', () => {
  const BRCA1 = {
    id: '672', symbol: 'BRCA1', description: 'BRCA1 DNA repair associated', organism: 'Homo sapiens',
    accession: 'NC_000017.11', start: 43044295, end: 43170327, complement: true,
  }

  function fetchAs(value: string) {
    const onFetched = vi.fn()
    const onClose = vi.fn()
    render(<FetchDialog open onClose={onClose} onFetched={onFetched} />)
    fireEvent.change(screen.getByPlaceholderText(/L09137/), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: /^Fetch/ }))
    return { onFetched, onClose }
  }

  it('fetches a Gene ID as its region of the chromosome, on its own strand, named for the gene', async () => {
    ncbi.gene.mockResolvedValue(BRCA1)
    const { onFetched } = fetchAs('672')
    await waitFor(() => expect(onFetched).toHaveBeenCalled())
    expect(ncbi.gene).toHaveBeenCalledWith('672')
    expect(ncbi.fetch).toHaveBeenCalledWith('NC_000017.11', 'nucleotide', { start: 43044295, end: 43170327, complement: true })
    const doc = onFetched.mock.calls[0][0][0]
    expect(doc.name).toBe('BRCA1')
    expect(doc.description).toBe('BRCA1 DNA repair associated, Homo sapiens; NC_000017.11:complement(43044295..43170327)')
  })

  it('downloads only the region asked for, without asking about the size of the chromosome', async () => {
    ncbi.summary.mockResolvedValue({ length: 149_588_044, title: 'Mus musculus chromosome 6' })
    const { onFetched } = fetchAs('NC_000072 REGION: 122552252..122565735')
    await waitFor(() => expect(onFetched).toHaveBeenCalled())
    expect(ncbi.fetch).toHaveBeenCalledWith('NC_000072', 'nucleotide', { start: 122552252, end: 122565735, complement: false })
    expect(onFetched.mock.calls[0][0][0].name).toBe('pX:122552252..122565735')
  })

  it('names a reverse complement for what it is', async () => {
    ncbi.summary.mockResolvedValue({ length: 2686, title: 'pUC19' })
    const { onFetched } = fetchAs('L09137.2 (COMPLEMENT)')
    await waitFor(() => expect(onFetched).toHaveBeenCalled())
    expect(ncbi.fetch).toHaveBeenCalledWith('L09137.2', 'nucleotide', { complement: true })
    expect(onFetched.mock.calls[0][0][0].name).toBe('pX (complement)')
  })

  it('fetches every record in a range', async () => {
    ncbi.summary.mockResolvedValue(null)
    const { onFetched } = fetchAs('AF027958 - AF027961')
    await waitFor(() => expect(onFetched).toHaveBeenCalled())
    expect(ncbi.fetch.mock.calls.map(c => c[0])).toEqual(['AF027958', 'AF027959', 'AF027960', 'AF027961'])
  })

  it('stops at a region past the end of the record before downloading anything', async () => {
    ncbi.summary.mockResolvedValue({ length: 2686, title: 'pUC19' })
    fetchAs('L09137.2: 5000..6000')
    expect((await screen.findByRole('alert')).textContent).toMatch(/is 2,686 bp long, so it has no position 5,000/)
    expect(ncbi.fetch).not.toHaveBeenCalled()
  })

  it('says how to write what it cannot read, and fetches nothing', async () => {
    fetchAs('NC_000072: 9..5')
    expect((await screen.findByRole('alert')).textContent).toMatch(/lower position first/)
    expect(ncbi.summary).not.toHaveBeenCalled()
    expect(ncbi.fetch).not.toHaveBeenCalled()
  })

  it('previews a gene with where it lies', async () => {
    ncbi.gene.mockResolvedValue(BRCA1)
    render(<FetchDialog open onClose={() => {}} onFetched={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/L09137/), { target: { value: '672' } })
    expect(await screen.findByText('BRCA1: BRCA1 DNA repair associated (Homo sapiens)')).toBeTruthy()
    expect(screen.getByText('From NC_000017.11:complement(43044295..43170327)')).toBeTruthy()
    expect(ncbi.fetch).not.toHaveBeenCalled()
  })

  it('fills the box from an example', () => {
    render(<FetchDialog open onClose={() => {}} onFetched={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'AL589148.1 (COMPLEMENT)' }))
    expect((screen.getByPlaceholderText(/L09137/) as HTMLInputElement).value).toBe('AL589148.1 (COMPLEMENT)')
  })
})

describe('ncbiGene and fetchNCBI', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const actual = () => vi.importActual<typeof import('../fetch/ncbi')>('../fetch/ncbi')

  it('reads the 0-based summary of a minus-strand gene as 1-based positions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { uids: ['672'], 672: {
      name: 'BRCA1', description: 'BRCA1 DNA repair associated', organism: { scientificname: 'Homo sapiens' },
      genomicinfo: [{ chraccver: 'NC_000017.11', chrstart: 43170326, chrstop: 43044294 }],
    } } }))))
    expect(await (await actual()).ncbiGene('672')).toEqual({
      id: '672', symbol: 'BRCA1', description: 'BRCA1 DNA repair associated', organism: 'Homo sapiens',
      accession: 'NC_000017.11', start: 43044295, end: 43170327, complement: true,
    })
    expect(ncbiGene).not.toBe((await actual()).ncbiGene)
  })

  it('says when there is no such gene, and follows a merged one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { uids: ['9'], 9: { error: 'cannot get document summary' } } }))))
    await expect((await actual()).ncbiGene('9')).rejects.toThrow('NCBI Gene has no gene 9.')

    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('id=1&')
      ? { result: { uids: ['1'], 1: { name: 'OLD', currentid: '2', genomicinfo: [] } } }
      : { result: { uids: ['2'], 2: { name: 'NEW', genomicinfo: [{ chraccver: 'NC_1.1', chrstart: 9, chrstop: 19 }] } } }))))
    expect(await (await actual()).ncbiGene('1')).toMatchObject({ symbol: 'NEW', start: 10, end: 20, complement: false })
  })

  it('asks NCBI for the part and the strand', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(GB))
    vi.stubGlobal('fetch', fetchMock)
    await (await actual()).fetchNCBI('CP002686', 'nucleotide', { start: 2459491, end: 2463965, complement: true })
    const params = new URL(fetchMock.mock.calls[0][0]).searchParams
    expect([params.get('seq_start'), params.get('seq_stop'), params.get('strand')]).toEqual(['2459491', '2463965', '2'])
  })

  it('says a region starts past the end, where NCBI answers 400', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('+Error%3A+S+e+q+u+e+n+c+e++s+t+a+r+t++i+s++o+u+t+s+i+d+e', { status: 400 })))
    await expect((await actual()).fetchNCBI('L09137.2', 'nucleotide', { start: 5000, end: 6000 })).rejects.toThrow(/starts past the record's end/)
  })
})
