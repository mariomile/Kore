import { describe, expect, it } from 'vitest'
import { parseCsv, sniffCsvDelimiter } from './csv'

describe('parseCsv', () => {
  it('parses plain comma rows with a trailing newline', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('handles quoted fields, escaped quotes, and embedded newlines', () => {
    expect(parseCsv('"name","note"\n"Anna ""Banana""","line one\nline two"\n')).toEqual([
      ['name', 'note'],
      ['Anna "Banana"', 'line one\nline two'],
    ])
  })

  it('handles CRLF records and a final row without a newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('sniffs semicolon and tab delimiters', () => {
    expect(sniffCsvDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(sniffCsvDelimiter('a\tb\tc')).toBe('\t')
    expect(sniffCsvDelimiter('a,b\n')).toBe(',')
    expect(parseCsv('x;y\n"a;b";2\n')).toEqual([
      ['x', 'y'],
      ['a;b', '2'],
    ])
  })
})
