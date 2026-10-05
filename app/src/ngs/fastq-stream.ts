/**
 * FASTQ (and FASTA) read a piece at a time.
 *
 * Text arrives in arbitrary pieces as a file is decompressed, so a record
 * can be split anywhere, even inside a line. The parser keeps the unfinished
 * line and record between pieces and hands back whole records.
 *
 * Sequence and quality may be wrapped over several lines, as in io/fastq.ts:
 * quality is collected until it is as long as the sequence, because a quality
 * line may itself start with '@' or '+'. FASTA reads (no quality) are read
 * too; their quality comes back empty.
 */

export interface RawRead {
  /** The header line without its '@' or '>'. */
  header: string
  seq: string
  /** Phred+33 characters; empty for FASTA. */
  qual: string
}

/** The read's ID: its header up to the first space. The rest is a comment. */
export function readId(header: string): string {
  const s = header.search(/\s/)
  return s === -1 ? header : header.slice(0, s)
}

const START = 0
const SEQ = 1
const QUAL = 2

export class ReadStreamParser {
  private partial = ''
  private state: number = START
  private fasta = false
  private header = ''
  private seq: string[] = []
  private seqLen = 0
  private qual: string[] = []
  private qualLen = 0
  private line = 0

  /** Parse a piece of text; whole records are appended to `out`. */
  push(text: string, out: RawRead[]): void {
    const lines = (this.partial + text).split('\n')
    this.partial = lines.pop() ?? ''
    for (const l of lines) this.take(l.endsWith('\r') ? l.slice(0, -1) : l, out)
  }

  /** The text has ended: finish the last record. */
  end(out: RawRead[]): void {
    if (this.partial) {
      const l = this.partial
      this.partial = ''
      this.take(l.endsWith('\r') ? l.slice(0, -1) : l, out)
    }
    if (this.state === SEQ && this.fasta) this.emit(out)
    else if (this.state === QUAL && this.qualLen < this.seqLen) {
      throw new Error(`Read "${readId(this.header)}" ends before its quality is complete`)
    } else if (this.state === SEQ) {
      throw new Error(`Read "${readId(this.header)}" has no quality line`)
    }
  }

  private take(l: string, out: RawRead[]): void {
    this.line++
    switch (this.state) {
      case START:
        if (!l) return
        if (l[0] === '>') this.fasta = true
        else if (l[0] !== '@') throw new Error(`Line ${this.line}: not FASTQ or FASTA (expected a read name starting with @ or >)`)
        this.header = l.slice(1)
        this.state = SEQ
        return
      case SEQ:
        if (this.fasta) {
          if (l[0] === '>') { this.emit(out); this.header = l.slice(1); this.state = SEQ; return }
          this.addSeq(l)
          return
        }
        if (l[0] === '+') { this.state = QUAL; if (this.seqLen === 0) this.emit(out); return }
        this.addSeq(l)
        return
      case QUAL:
        this.qual.push(l)
        this.qualLen += l.length
        if (this.qualLen > this.seqLen) {
          throw new Error(`Line ${this.line}: read "${readId(this.header)}" has more quality values (${this.qualLen}) than bases (${this.seqLen})`)
        }
        if (this.qualLen === this.seqLen) this.emit(out)
        return
      default:
        return
    }
  }

  private addSeq(l: string): void {
    if (!l) return
    this.seq.push(l)
    this.seqLen += l.length
  }

  private emit(out: RawRead[]): void {
    out.push({ header: this.header, seq: this.seq.join(''), qual: this.qual.join('') })
    this.header = ''
    this.seq = []
    this.seqLen = 0
    this.qual = []
    this.qualLen = 0
    // The next line is a header. (A FASTA record is only emitted when the
    // next header has been seen, and the caller sets the state after that.)
    this.state = START
  }
}
