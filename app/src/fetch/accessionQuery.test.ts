import { describe, it, expect } from 'vitest'
import { parseAccessionQuery, MAX_RANGE } from './accessionQuery'

const read = (q: string) => parseAccessionQuery(q)

describe('parseAccessionQuery', () => {
  it('reads one accession, with or without a version', () => {
    expect(read('DQ115396').requests).toEqual([{ text: 'DQ115396', id: 'DQ115396', gene: false, complement: false }])
    expect(read(' DQ115396.1 ').requests[0].id).toBe('DQ115396.1')
  })

  it('reads several, separated by commas, semicolons, new lines or spaces, once each', () => {
    expect(read('NM_006178, NM_008740.4').requests.map(r => r.id)).toEqual(['NM_006178', 'NM_008740.4'])
    expect(read('A1; B2\nC3 D4, A1').requests.map(r => r.id)).toEqual(['A1', 'B2', 'C3', 'D4'])
  })

  it('reads a number or a LOC symbol as a Gene ID', () => {
    expect(read('672').requests[0]).toMatchObject({ id: '672', gene: true, text: '672' })
    expect(read('LOC104244181').requests[0]).toMatchObject({ id: '104244181', gene: true, text: 'LOC104244181' })
    expect(read('loc672').requests[0]).toMatchObject({ id: '672', gene: true })
  })

  it('expands a range of accessions', () => {
    expect(read('AF027958 - AF027961').requests.map(r => r.id)).toEqual(['AF027958', 'AF027959', 'AF027960', 'AF027961'])
    expect(read('NM_000009-NM_000011').requests.map(r => r.id)).toEqual(['NM_000009', 'NM_000010', 'NM_000011'])
  })

  it('refuses a range that is backwards, mismatched or too long', () => {
    expect(read('AF027961 - AF027958').errors[0]).toMatch(/backwards/)
    expect(read('AF027958 - AB027961').errors[0]).toMatch(/same letters/)
    expect(read('AF0279 - AF027961').errors[0]).toMatch(/same number of digits/)
    expect(read('AF000001 - AF999999').errors[0]).toMatch(new RegExp(`at most ${MAX_RANGE}`))
    expect(read('AF000001 - AF999999').requests).toEqual([])
  })

  it('reads a region with a colon, with REGION, or with both', () => {
    const want = { id: 'NC_000072', gene: false, region: { start: 122552252, end: 122565735 }, complement: false, text: 'NC_000072: 122552252..122565735' }
    expect(read('NC_000072 REGION: 122552252..122565735').requests).toEqual([want])
    expect(read('NC_000072: 122552252..122565735').requests).toEqual([want])
    expect(read('nc_000072 region 122552252..122565735').requests[0].region).toEqual(want.region)
    expect(read('NC_000072:122552252-122565735').requests[0].region).toEqual(want.region)
  })

  it('reads positions written with thousands separators', () => {
    expect(read('NC_000072: 122,552,252..122,565,735, NM_1').requests.map(r => r.text))
      .toEqual(['NC_000072: 122552252..122565735', 'NM_1'])
  })

  it('reads the reverse complement of a record and of a region', () => {
    expect(read('AL589148.1 (COMPLEMENT)').requests).toEqual([{ text: 'AL589148.1 (COMPLEMENT)', id: 'AL589148.1', gene: false, complement: true }])
    expect(read('CP002686: COMPLEMENT(2459491..2463965)').requests[0]).toMatchObject({
      id: 'CP002686', region: { start: 2459491, end: 2463965 }, complement: true, text: 'CP002686: COMPLEMENT(2459491..2463965)',
    })
    expect(read('CP002686: 2459491..2463965 (complement)').requests[0]).toMatchObject({ complement: true })
  })

  it('mixes forms in one box', () => {
    const r = read('672, CP002686: COMPLEMENT(1..10), L09137.2 (COMPLEMENT), AF1 - AF2').requests
    expect(r.map(x => x.text)).toEqual(['672', 'CP002686: COMPLEMENT(1..10)', 'L09137.2 (COMPLEMENT)', 'AF1', 'AF2'])
  })

  it('says how to write a region it cannot read', () => {
    expect(read('NC_000072: 5..').errors[0]).toMatch(/NC_000072: 122552252\.\.122565735/)
    expect(read('NC_000072: 9..5').errors[0]).toMatch(/lower position first.*COMPLEMENT\(5\.\.9\)/)
    expect(read('NC_000072: 0..5').errors[0]).toMatch(/start at 1/)
    expect(read('672: 1..100').errors[0]).toMatch(/Gene ID/)
    expect(read('672 (COMPLEMENT)').errors[0]).toMatch(/Gene ID/)
    expect(read('A1 - B2 - C3').errors[0]).toMatch(/AF027958 - AF027961/)
    expect(read('A1 #2').errors).toEqual(['"#2" is not an accession.'])
  })

  it('reads its own standard text back the same', () => {
    for (const q of ['NC_000072 region 1..20', 'X1 (complement)', 'X1: complement(3..4)', 'LOC12']) {
      const first = read(q).requests[0]
      expect(read(first.text).requests[0]).toEqual(first)
    }
  })
})
