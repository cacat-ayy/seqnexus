import { describe, it, expect } from 'vitest'
import { csvCell, csvRow, unguardCsvCell } from './csv-cell'

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a, b')).toBe('"a, b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"')
  })

  it('keeps text a spreadsheet would run as a formula from running', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('+1_F')).toBe("'+1_F")
    expect(csvCell('-35 box')).toBe("'-35 box")
    expect(csvCell('@cmd')).toBe("'@cmd")
  })

  it('leaves numbers and a lone sign alone', () => {
    expect(csvRow(['-35', '+3', '1e-5', -2, '-', '+', 'lacZ'])).toBe('-35,+3,1e-5,-2,-,+,lacZ')
  })

  it('reads a guarded cell back as written', () => {
    for (const s of ['=SUM(A1)', '+1_F', "it's", 'plain']) expect(unguardCsvCell(csvCell(s))).toBe(s)
  })
})
