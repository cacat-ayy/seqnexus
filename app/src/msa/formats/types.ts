import type { AlnDoc, AlnKind } from '../model'

export type AlnFormatId = 'fasta' | 'clustal' | 'phylip' | 'nexus' | 'mega' | 'pir' | 'stockholm' | 'msf'

/** What a parser hands back: raw row text, cleaned later by makeDoc. */
export interface ParsedAlignment {
  rows: { name: string; seq: string }[]
  /** The kind the file declares, when it declares one. */
  kind?: AlnKind
  warnings: string[]
}

export interface WriteOptions {
  /** PHYLIP: 10-character names (strict) or names up to the first space (relaxed). */
  phylipNames?: 'relaxed' | 'strict'
  /** PHYLIP: all of a sequence on one line (sequential) or blocks (interleaved). */
  phylipLayout?: 'sequential' | 'interleaved'
  /** Title written by formats that carry one (MEGA, Stockholm, MSF). */
  title?: string
}

export interface AlnFormat {
  id: AlnFormatId
  label: string
  /** File extensions, the default first. */
  extensions: string[]
  description: string
  parse(text: string): ParsedAlignment
  write(doc: AlnDoc, opts?: WriteOptions): string
}

export class AlignmentParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AlignmentParseError'
  }
}
