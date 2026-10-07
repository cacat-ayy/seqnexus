# SeqNexus

A browser-based molecular biology sequence editor. Renders DNA sequences using
Canvas 2D with annotation display, selection, inline editing, and zoom. Designed
for genome-scale sequences; tested up to around 5 Mb, which is a limit of what
has been exercised rather than of the data structures. Builds to a single
self-contained HTML file.

## Repo Layout

```
.                        the published site (GitHub Pages → seqnexus.app)
├── index.html               landing page (hand-written, not built)
├── app.html                 the built editor — generated, commit it
├── *.worker-<hash>.js       the editor's Web Workers — generated, commit them
├── impressum.html / datenschutz.html
├── assets/                  favicons, screenshots
├── wasm/                    MAFFT, MUSCLE and Kalign (biowasm), run by the alignment tool
└── app/                     Vite + React source for the editor
    ├── app.html                 Vite entry — builds to ../app.html
    └── src/
```

## Quick Start

```bash
cd app
npm install
npm run dev           # dev server on :8000
npm test              # 2,000+ tests
npx tsc -b --noEmit   # type check
npm run build         # tsc -b && vite build
```

The dev server mirrors the deployed site: `/` serves the landing page and
`/app.html` serves the editor built live from `src/`.

## Publishing

`npm run build` writes straight into the repo root (`app.html` plus one
hashed `*.worker-*.js` chunk per worker), so publishing is just committing the
result. Both are build output and both must be committed: `app.html` loads the
workers by relative URL, so a missing chunk silently breaks ORF finding, enzyme
scanning, primer design, alignment, annotation matching, GenBank parsing,
cloning libraries or Sanger assembly. `wasm/` is not built but is loaded the
same way, so it must be published too.

Stale worker chunks from a previous build are pruned automatically at the start
of each build.

> `build.outDir` is the repo root, so `emptyOutDir` is pinned to `false` in
> `app/vite.config.ts`. Do not turn it on — it would delete the repository.

## Tech Stack

- Vite 5 + React 18 + TypeScript 5.6
- Zustand for state management (multi-document with tabs)
- Canvas 2D rendering with virtualized rows
- Web Workers for ORF finding, enzyme scanning, primer design, annotation
  matching, alignment, cloning and Sanger assembly
- MAFFT, MUSCLE and Kalign as WebAssembly (biowasm) for multiple alignment
- lucide-react for icons
- vite-plugin-singlefile for single HTML builds
- vitest for testing

## Features

- **Multi-document tabs** with session persistence (localStorage + IndexedDB)
- **Three zoom modes** (21 levels): line → dots → letters
- **Linear and circular views** with split mode (resizable divider)
- **GenBank import/export** with streaming parser for large files (>1MB)
- **FASTA, SnapGene (.dna), Geneious (.geneious), GFF3 import/export**
- **Sanger chromatogram viewer** (AB1, SCF) with quality scores and base editing
- **Annotation editing** - inline feature table, context menu, drag-and-drop
- **Several ranges at once** - Ctrl+drag or Ctrl+click on features, in the
  sequence view and on the map; touching ranges merge; copied, deleted,
  translated and annotated joined, as exons are
- **Find/replace** on both strands, with IUPAC codes, up to 3 mismatches,
  protein search in all six frames, regex, and a list of hits with their
  strand, feature and context
- **ORF finder** - 6-frame, configurable, Web Worker
- **Restriction enzyme analysis** - 546 enzymes from REBASE, gel simulation
- **Primers** - primers and probes as oligos with 5'/3' overhangs and
  mismatches, binding sites found automatically; a docked design workbench
  with a candidate track, per-primer inspector and live pair checks
- **Codon optimization** - 19 genetic codes, host usage tables (built-in, or
  imported from EMBOSS cusp / GCG CodonFrequency), motif/homopolymer/GC/repeat
  constraints
- **Sequence alignment** - pairwise (global/local) and multiple sequence alignment
- **In-silico cloning** - digest/ligation, Gibson assembly, Golden Gate assembly
- **NGS read sets** - FASTQ(.gz) import with R1/R2 pairing, QC charts and
  verdicts, fastp trimming and minimap2 mapping (WebAssembly), FASTQ.gz export;
  mappings viewed from a whole genome down to single bases (coverage, reads
  coloured by strand or pair, downsampling, sorting, fragment-length brushing),
  variants with live thresholds and technology presets, VCF, consensus;
  several samples per mapping with a samples x variants matrix and clone
  verification per sample; primer clipping for amplicons; soft-clip junctions;
  a guided pipeline from reads to variants; figures as SVG, PNG or PDF;
  mappings exported as BAM (with its index) or SAM, and imported from either
- **Sanger sequencing** - chromatograms, trimming, mapping to a reference or de
  novo assembly kept as assemblies with their contigs, variants, clone
  verification
- **NCBI BLAST** - search NCBI databases directly from the editor
- **PDF export** of the sequence as the text view draws it, vector, on A4
- **10 themes** (5 light, 5 dark)
- **File explorer** with folders, search, drag-to-group
- **Keyboard shortcuts** and right-click context menus

---

## Architecture

### Data Structures

| Module | Purpose |
|--------|---------|
| `PieceTable` | AVL-tree-backed piece table. O(log n) insert/delete/charAt. |
| `IntervalTree` | Augmented AVL interval tree. O(log n + k) range queries for annotations. |
| `Sequence` | Wraps PieceTable. Topology (linear/circular). |
| `Annotation` | Feature model with coordinates, strand, qualifiers. |
| `Document` | Combines Sequence + Annotations. Edit operations + undo snapshots. |

#### PieceTable

The sequence buffer uses a piece table rather than a flat string. The original
file content is stored in a read-only buffer; all edits append to a separate
"add" buffer. Edit operations create or split small piece descriptors instead
of copying the entire sequence. The pieces are organized in an AVL tree keyed
by cumulative length, giving O(log n) positional access, insert, and delete
where n is the number of pieces (not the sequence length). This makes editing
a 5 Mb genome as fast as editing a 5 kb plasmid.

#### IntervalTree

Annotations are stored in an augmented AVL interval tree keyed by start
position. Each node carries a `maxEnd` value for its subtree, allowing range
queries to prune entire subtrees that can't overlap the query range. This
gives O(log n + k) overlap queries where k is the number of results - used
on every frame to find which annotations are visible in the current viewport.

### Rendering

All sequence rendering uses Canvas 2D with uniform row heights. Row Y position
is computed as `index × rowHeight` - pure arithmetic from scroll offset. A
`ResizeObserver` triggers redraws when the container resizes.

Three render modes based on zoom level:
- **Line** (zoom 0-6): thin backbone, annotation bars, ruler
- **Dots** (zoom 7-12): colored dots per base on backbone
- **Letters** (zoom 13-20): full base letters + complement strand

Only visible rows are drawn. The canvas is translated by the scroll offset
and rows outside the viewport are skipped entirely. This keeps frame times
constant regardless of sequence length.

### Web Workers

Compute-intensive operations run off the main thread:
- `orf-finder.worker` - 6-frame ORF scanning
- `enzyme-finder.worker` - restriction site scanning (546 enzymes, IUPAC expansion)
- `primer-design.worker` - primer candidate enumeration, scoring and pairing (long-lived)
- `genbank-parser.worker` - streaming GenBank parser for large files
- `annotate-list.worker` - annotation matching with k-mer pre-filter
- `alignment.worker` - built-in pairwise and multiple sequence alignment
- `aligner.worker` - one MAFFT, MUSCLE or Kalign job (WebAssembly from `wasm/`)
- `cloning.worker` - combinatorial cloning libraries
- `assembly.worker` - Sanger read assembly

---

## Storage & Persistence

### Why IndexedDB + localStorage

localStorage has a ~5 MB quota in most browsers. A single GenBank file for a
bacterial genome can exceed that. IndexedDB has a much larger quota (typically
hundreds of MB to GB) and handles binary/string data efficiently.

SeqNexus uses a hybrid approach:
- **IndexedDB** stores the large data: base strings, chromatogram trace data,
  and alignment result matrices.
- **localStorage** stores the small metadata: tab layout, annotation
  coordinates, folder structure, theme, ORF/enzyme search parameters.

This split keeps the metadata fast to read (synchronous `localStorage.getItem`)
while allowing arbitrarily large sequences to persist across sessions.

### Persistence format

Base strings are omitted from the localStorage JSON and stored in IndexedDB
keyed by tab ID. On load, metadata is read from localStorage first, then
base strings are fetched from IndexedDB and reassembled into full document
snapshots.

### Orphan cleanup

On every save, the app compares the set of tab IDs in the current session
against the set of keys in IndexedDB. Any IndexedDB entries without a
matching tab are deleted. This prevents storage leaks when tabs are closed.

### Auto-save

Session state is saved automatically with a 1-second debounce after any
state change. If the save fails due to quota, a persistent error toast
warns the user to export their work.

---

## Selections

A selection is a range of bases. On a circular sequence it may run across the
origin. Dragging leftwards records that direction, and the selection's
translation reads the bottom strand from the last base.

### Several ranges

Ctrl+drag (Cmd on a Mac) selects another range next to the ones already
selected, and Ctrl+click on a feature, a primer or an enzyme label adds that
item's bases. On an auto-annotation suggestion or an ORF, Ctrl+click still
picks the item for conversion to a feature. A Ctrl+click inside a selected
range, without dragging, removes that range. Without Ctrl, a click or a drag
replaces the whole selection. Every range has its own drag handles.

The circular map works the same way: Ctrl+drag along the backbone selects a
range, following the direction the pointer turns, so a drag that carries on
past the top of the map selects across the origin rather than going back the
short way. A whole turn stops one base short of the whole circle. A plain
drag on the map still pans it when zoomed in.

- **Merging.** Ranges that overlap or touch become one range. On a circular
  sequence, a range ending at the last base touches one starting at the first.
  A drag is merged against the ranges as they were when it began. A handle
  dragged into another range joins the two, and dragging it back out
  separates them again until the button is released.
- **The active range** is the one last made or dragged. The caret, the arrow
  keys and every tool that needs one stretch of sequence (primer design, the
  Clone This Selection submenu, PDF export) act on it alone. While several
  ranges are selected, the context menu leaves out New Primer, Clone This
  Selection and Paste Reverse Complement.
- **Reading order** is left to right along the sequence, each range read 5'
  to 3'. A range across the origin of a circular sequence is read first, the
  order in which a GenBank `join()` across the origin is written.

### Joined translation

With several ranges selected, the selection's translation reads them as one
sequence, the way a spliced CDS reads its exons. A codon can take bases from
two ranges, and its chip is then drawn in two parts, one over each range.
The direction is that of the active range: if it was dragged leftwards, the
whole joined sequence is read as its reverse complement, starting from the
last base of the last range. The ranges are not translated separately,
because a split coding sequence is the common reason to select several
ranges at once.

### Copying, deleting, typing

- **Copy** (Ctrl+C) puts the joined bases on the clipboard in reading order.
  The context menu also offers the reverse complement, the protein, FASTA as
  one joined record, and FASTA with one record per range.
- **Delete, Backspace and Cut** remove every range in one undo step. The
  spans are deleted from the end of the sequence backwards, so each deletion
  leaves the earlier spans where they were.
- **Typing and pasting** are refused while several ranges are selected. It
  would not be clear which range the new bases replace, or whether all of
  them do.
- **Add Joined Annotation** makes one feature with a part per range, in
  reading order, which a GenBank file writes as `join()`. The form shows the
  parts in place of the start and end, and its One Span button annotates the
  whole stretch from the first part to the last instead.

### Joined features

A feature with parts (the exons of a spliced CDS, or one made from several
ranges) is drawn part by part, with a thin line across each intron in the
sequence view and a thin arc on the map. Edges at an intron are square, and
the arrow is only on the part the feature ends in. Its translation reads the
exons only, joined as the selection's ranges are, from `/codon_start` on, so
a codon split by an intron is drawn in two pieces with one residue. Copying
the feature's protein reads the exons too; copying its bases gives the whole
span, introns included. Clicking anywhere on the feature's span, introns
included, selects the whole span.

The extra ranges are tied to the tab and to the sequence's edit count. Any
change to the bases, including undo and redo, drops them. Base edits rewrite
the sequence in place, so ranges kept across an edit could point at the
wrong bases.

---

## Find

Ctrl+F in the sequence view opens a floating Find panel. A selection of up
to 1 kb becomes the query. The engine is `search/find.ts`; the store runs it
on every change of query, options or bases, so hits never point at bases
that an edit has moved. Coordinates are 0-based and end-exclusive on the
forward strand. On a circular sequence a hit may run across the origin and
then keeps `end > length` (unwrapped), so hits still sort by start.

### Nucleotide search

- **Exact and IUPAC.** The query becomes a regular expression, each IUPAC
  code a character class (N is `[ACGTU]`, R is `[AG]`, and so on; T and U are
  one base). A sequence N is not a base call, so it matches only a query N
  when ambiguity codes are off (then the query is literal). Hits may overlap:
  "AA" in "AAAA" is three sites, because each is a place a primer could sit.
- **Both strands.** The reverse complement of the query is searched as a
  second pattern. A window found by both (a palindrome such as GAATTC, or an
  ambiguous query whose two orientations fit the same bases, such as AN and
  NT on "AT") is one hit on both strands, not two.
- **Mismatches (0 to 3).** Every offset is compared directly, base against
  query code as bitmasks (A 1, C 2, G 4, T 8; a code is the OR of its bases),
  and a window is abandoned at its (k+1)th difference. That is O(n·m) at worst
  but a few comparisons per position on real sequence, which is fast enough
  for primer-length queries on a bacterial genome. An index (k-mer seeds, as
  primer binding uses) was not needed at these sizes and would not cover a
  query shorter than its seed.
- **Regex.** Searched as written, forward strand only: a regex has no
  general reverse complement. Hits do not overlap, as usual for a regex.
- **Across the origin.** The sequence is searched with its first m - 1 bases
  appended (1 kb for a regex), keeping hits that start before the end. One
  pass covers both strands' wrapped hits.

Pasted spaces and position numbers (as in a GenBank listing) are dropped
from the query. Any other character that is not a code is reported by name
rather than matched, so a typo cannot quietly match something else.

### Protein search

All six frames are translated with the genetic code chosen for the
translation display, and searched as text; hits map back to the codons they
cover, with their strand and frame (offset 0, 1 or 2 from the 5' end of
their strand). X matches any residue except a stop, B is D or N, Z is E or
Q, J is I or L. The six translations are cached until the bases or the code
change, since translating a genome is most of the cost of each keystroke.
Mismatches are not offered in protein mode.

### Limits

A search keeps at most 100,000 hits. A one-letter query on a genome has
millions, which say nothing more in the list or on the map and would cost
hundreds of megabytes. The kept hits are always every hit up to some
position, never an uneven sample of the two strands.

### Replace

The replacement is bases in both modes. A reverse-strand hit gets the
reverse complement of the replacement, so the strand the hit was found on
reads as typed. In protein mode only A, C, G and T are accepted, since most
amino acid letters are also IUPAC codes and a peptide typed by mistake would
otherwise go in as degenerate DNA. Replace all works right to left so the
positions still to come do not move, and skips a hit that overlaps one
already replaced (hits on the two strands, or with mismatches, can overlap)
rather than splicing one replacement into another. A hit across the origin
is replaced in two pieces, with the new bases placed at the end.

### Display

Hits are drawn on the strand they read on when both strands are shown as
letters, and over the whole line otherwise. The minimap and the plasmid map
mark every hit (map marks closer than 3 px are merged), the current one
stronger. The panel lists the hits with position, strand, frame, the
smallest feature containing the hit, and a few bases of context read in the
hit's own orientation, with mismatched bases marked.

---

## Sequence Alignment

### Algorithms

Multiple alignment normally runs MAFFT 7.520, MUSCLE 5 or Kalign 3: the
biowasm WebAssembly builds kept in `wasm/` (see `wasm/README.md`), one job per
worker so a job can be cancelled. "Automatic" picks MAFFT L-INS-i where it is
quick enough, Kalign for large sets, and the built-in pairwise aligner for two
sequences.

The built-in algorithms are pure TypeScript with no external dependencies:

#### Needleman-Wunsch (global pairwise)

Standard three-matrix DP (M, Ix, Iy) for affine gap penalties. For sequences
where m × n > 10k × 10k cells, the implementation switches to **Hirschberg's
divide-and-conquer** algorithm, which reduces memory from O(mn) to O(min(m,n))
while producing the same optimal alignment. This allows global alignment of
sequences up to ~22 kb × 22 kb (500M cells limit) without exhausting browser
memory.

#### Smith-Waterman (local pairwise)

For matrices up to 50M cells, uses the standard O(mn) DP with full traceback.
For larger inputs, uses a three-pass linear-memory approach:
1. Forward pass (O(n) memory) to find the best score and end position
2. Reverse pass to find the start position
3. Full DP only over the bounded local region

#### Seeded Smith-Waterman (large local)

When the full DP matrix would exceed 500M cells (e.g., aligning a 4 kb read
against a 4.6 Mb genome), the app uses a seed-and-extend strategy inspired
by BLAST and minimap2:
1. Build a k-mer hash index (k=11) of the reference sequence
2. Find seed matches from the query
3. Chain seeds along diagonals (greedy, gap-tolerant)
4. Extract a bounded reference region around the best chain
5. Run Smith-Waterman on the bounded region only

This reduces a 4 kb × 4.6 Mb alignment to a hash lookup plus SW on ~4 kb × ~8 kb.
Highly repetitive k-mers (>500 occurrences) are skipped to limit memory.

#### Progressive MSA (multiple sequences)

For 3+ sequences, uses progressive multiple sequence alignment:
1. Compute all-pairs distance matrix via pairwise NW scores
2. Build a UPGMA guide tree
3. Align sequences/profiles progressively following the tree

Profile-profile alignment uses position-specific scoring: the score for
aligning two columns is the average of all pairwise residue scores across
the two profiles.

### Scoring

- **DNA**: configurable match/mismatch scores (default +1/-1)
- **Protein**: BLOSUM62 substitution matrix (standard NCBI 20×20)
- **Gap penalties**: affine model with separate open and extend penalties

### Size limits

| Scenario | Strategy | Max size |
|----------|----------|----------|
| Global pairwise | Full DP or Hirschberg | ~22 kb × 22 kb |
| Local pairwise (small) | Full DP | ~7 kb × 7 kb |
| Local pairwise (large) | Linear-memory SW | ~50 kb × 50 kb |
| Local pairwise (genome) | Seeded SW | 4 kb × 5 Mb+ |
| Global pairwise (too large) | Rejected with error | - |

All alignment runs in a Web Worker to keep the UI responsive.

---

## Sanger Assembly

### Assemblies and contigs

One run of the assembler (reads mapped to a reference, or joined de novo) is
kept as one **assembly**. It holds:

- its **contigs**: one when mapping to a reference, one per group of
  overlapping reads de novo;
- the **reads that went in**, and the reference mapped to;
- the **settings** used (lowest identity, shortest overlap, seed length);
- the **reads left out**, each with the reason the assembler gave: too short
  after trimming, no match to the reference, below the identity threshold
  (with the identity reached), or no overlap with any other read.

Each contig used to be an item of its own, and the reads left out were
reported once in a toast and then lost. Keeping them together answers which
contigs came from the same reads and why a read is missing, and makes a run
repeatable: **Run again** starts from the same reads, reference and settings.
Its result replaces the assembly's contigs, with an Undo. Manual edits made in
the old contigs do not carry over, because the new contigs can have different
columns. When the reference sequence is no longer open, the run maps to the
copy the contig keeps (its gap columns and circular extension removed).

An assembly with a single contig is shown and opened as that contig. One with
several opens an overview: its contigs, the reads not placed, and how it was
made.

Contigs saved before assemblies existed each get an assembly of their own when
loaded. The reads and reference are read back from the contig; the settings
were not saved, so they are shown as not recorded.

### Overview figures

- **Mean depth**: the mean number of reads over the columns that some read
  spans. A read spans the columns from its first to its last base, so a
  deletion inside a read still counts as covered.
- **Reference covered**: the share of the reference's bases that some read
  spans. On a circular reference, columns past the end are the circular
  extension, and count as the bases at the start that they repeat.
- **Consensus**: the length of the consensus with the contig's own consensus
  settings, gaps removed.

---

## NGS Read Sets

A **read set** holds the reads of one sample: a FASTQ file, an R1/R2 pair, or
a long-read run. Only its description (name, technology, QC figures) is kept
with the session; the reads themselves are stored in IndexedDB and read a
chunk at a time by Web Workers, so a sample of millions of reads never has to
be held in memory.

### Import

- **Which files:** any gzipped read file (`.fastq.gz`, `.fq.gz`, `.fasta.gz`),
  and any uncompressed FASTQ over 256 KB or with more than 20 records. Smaller
  FASTQ files still open as sequences, as before: a handful of records is
  more likely a few Sanger or consensus reads than a sequencing run.
- **Gzip:** inflated with fflate, which reads files made of several gzip
  members back to back. Illumina's `.fastq.gz` is usually BGZF, which is
  exactly that.
- **Pairs:** two files whose names differ only in a mate marker before the
  extension (`_R1`/`_R2`, `.1`/`.2`, `_1`/`_2`, optionally followed by
  Illumina's `_001`) are taken as the two mates of a pair. During import the
  mates are read in lockstep and must have the same read ID (ignoring a
  trailing `/1` or `/2`), in the same order; otherwise the import stops and
  says at which read. A single file whose consecutive reads come in twos with
  the same ID is offered as **interleaved**.
- **Technology:** guessed from the read headers first (CASAVA 1.8 or older
  Illumina IDs; Nanopore UUIDs and `runid=`/`ch=` tags; PacBio `m64...`
  movie names), then from read lengths (600 bp or shorter: Illumina; mean of
  1 kb or more: Nanopore). A guess from lengths is marked as such, and the
  import dialog lets the user change it. The technology decides which QC
  rules apply and how reads are trimmed.
- **Parsing:** records may be split anywhere between the pieces a stream
  delivers, and sequence and quality may be wrapped; quality is collected
  until it is as long as the sequence, because a quality line can begin with
  `@`. FASTA reads (no quality) are accepted.

### Storage

Reads are stored in chunks of 16,384 (an even number, so a pair never
straddles two chunks; mates are stored next to each other). Each chunk is one
binary buffer, deflated:

- each read's length, then the read IDs as one newline-joined text;
- the bases two to a byte in BAM's 4-bit code (`=ACMGRSVTWYHKDBN`), so N and
  the IUPAC letters survive, unlike a 2-bit code;
- one byte of Phred quality per base.

Deflate shrinks the IDs (which repeat their instrument, run and flow cell)
and the qualities (which take few values) several-fold; a test chunk of
Illumina reads comes out under an eighth of its FASTQ text. Only the read ID
is kept from each header, not its comment: comments run to dozens of bytes
per read and nothing downstream reads them.

Read sets are not part of session files (they would make them huge); they
stay in the browser and are exported as FASTQ. The reads of a deleted read
set stay stored while it can be restored from Recently deleted, and are
removed the next time SeqNexus opens: at save time, a read set in the undo
buffer or one still importing would look the same as a deleted one.

### QC

Figures are gathered while the reads are imported, a read at a time:

- **Q20 and Q30:** the share of bases at those Phred scores and above.
- **Read quality:** a read's mean quality is computed from error
  probabilities, `Q = -10 log10(mean of 10^(-q/10))`, not by averaging the
  scores. Averaging overstates it: one Q5 base (a 32% chance of error) costs
  far more accuracy than one Q40 base gains, so a read of Q40 and Q5 bases
  half and half has a mean score of 22.5 but an expected error rate of 16%
  (Q8). This is how Nanopore and PacBio tools report read quality. The read
  set shows the median over reads.
- **Quality by position:** a histogram of scores at each position (up to
  1,000) per mate, reported as the median, the middle 50% and the middle 80%,
  over FastQC's zones (Q28 and up good, Q20 to 28 reasonable, below Q20
  poor). Long reads skip it: position along a 20 kb read says little.
- **Read length:** one bin per length when lengths span fewer than 60 values;
  otherwise 60 bins, evenly spaced for short reads and log-spaced for long
  reads, whose lengths span orders of magnitude. N50 is the length at which
  half the bases are in reads at least that long.
- **GC content** per read (1% bins) and the share of N calls.

The verdict uses SeqNexus's own rules of thumb, set from what current
instruments deliver, not a standard:

| | Good | Check | Fail |
|---|---|---|---|
| Illumina and other short reads: bases at Q30+ | 75% and up | 60 to 75% | below 60% |
| Nanopore: median read quality | Q12 and up | Q9 to 12 | below Q9 |
| PacBio (HiFi is Q20 by definition) | Q20 and up | Q15 to 20 | below Q15 |
| N calls (all) | 1% or less | over 1% | over 5% |

Fewer than 1,000 reads, or no qualities in the file, also earn a Check.

### Trimming and filtering

Trimming makes a new read set and keeps the original.

**Short reads** go through **fastp 0.20.1** (the biowasm WebAssembly build),
in batches of 100,000 reads, with:

- adapters trimmed: for pairs, where the two mates overlap and run past the
  insert (`--detect_adapter_for_pe` adds sequence-based detection); for single
  reads, by fastp's adapter detection;
- both ends cut while a 4-base window's mean quality is below the threshold
  (`--cut_front --cut_tail -W 4 -M 20` by default);
- reads shorter than the minimum dropped (`-l 20` by default), with their mate.

fastp's own defaults stay on: reads with more than 40% of bases below Q15, or
more than 5 N, are dropped, and poly-G tails are cut on NovaSeq and NextSeq
data, whose two-colour chemistry calls G where there is no signal. Batches
keep memory bounded; adapter detection for single reads then works per batch,
which with 100,000 reads per batch has ample reads to work from.

**Long reads** are filtered rather than trimmed, by minimum length (1 kb by
default) and minimum mean read quality (Q10 by default). fastp's short-read
model does not fit them, and current basecallers already cut the sequencing
adapters.

### Export

A read set exports as gzipped FASTQ: R1 and R2 as two files, or interleaved
in one. Each stored chunk becomes one gzip member and the members are placed
one after another, which every gzip reader inflates as one stream; memory
stays at one chunk. FASTA reads, which have no quality, export with `!` (Q0)
throughout.

### Limits

- Tested in the browser with 20,000 Illumina pairs and 2,000 Nanopore reads
  (import about a second, fastp trimming about two), and measured at
  bacterial-genome scale (1.7 million reads on 5 Mb, see Scale below).
- Phred+64 qualities (Illumina 1.3 to 1.7) are not detected, as in the FASTQ
  reader for sequences.
- Opened as a file (`file://`), Chrome starts no module workers, so import,
  export and the long-read filter run on the page instead (in chunk-sized
  steps). fastp and minimap2 cannot run there: such a page may not fetch
  `wasm/`. Double-click `serve.bat` in the SeqNexus folder (PowerShell's
  built-in web server, nothing to install) and open
  http://localhost:8080/app.html instead.

### Mapping to a reference

A read set is mapped to one or more open sequences with **minimap2 2.22**
(biowasm WebAssembly build), with the preset for its technology: `sr` for
short reads, `map-ont` for Nanopore, `map-hifi` for PacBio HiFi. Several
references (a chromosome and its plasmids) go into one run, so each read lands
on whichever fits it best rather than being forced onto the only one offered.
The result is an assembly holding the mapping.

- **Batches:** reads go to minimap2 40 Mb of bases at a time, with the
  references written out each run; indexing a few megabases takes a moment
  against the mapping itself. Mates are written to two files in the same
  order, which is how minimap2 pairs them.
- **Circular references:** the start of the sequence is appended (as long as
  the longest read needs, at least 1 kb, at most the sequence's own length),
  so a read across the origin maps in one piece; positions past the end are
  folded back. In the appended stretch the sequence is there twice, so
  minimap2 gives reads there mapping quality 0.
- **Coverage** counts the aligned bases (CIGAR M, = and X) of every primary
  and supplementary alignment, whatever its mapping quality, so the origin of
  a circular reference is not left uncovered. Deletions are not counted, as
  `samtools depth` does by default. Secondary alignments are not reported
  (`--secondary=no`).
- **Report:** reads mapped, the share of mapped reads in proper pairs, mean
  depth, the share of bases covered once and ten times, coverage along each
  reference in up to 400 windows, fragment lengths of proper pairs (60 bins up
  to the 99th percentile, longer ones in the last bin), and mapping qualities.
- **Storage:** see [Stored mappings](#stored-mappings) below.
- **Speed:** minimap2's SIMD build is used wherever the browser runs
  WebAssembly SIMD (current Chrome, Edge, Firefox and Safari), the plain build
  otherwise. On 40,000 reads of 150 bp against 8 kb the two give identical
  alignments, in under a second with SIMD and about 20 seconds without:
  minimap2's alignment extension (ksw2) is written for SIMD.
- **Run again** maps the same reads into the same assembly, starting from the
  references and read type used last; a reference whose sequence is no longer
  open is offered from the copy the mapping kept. The new mapping is stored
  apart until it is done, so a failed or stopped run leaves the old one whole,
  and Undo puts the old one back.

### Stored mappings

A mapping keeps everything a BAM file holds for its mapped reads, so it stands
on its own: the read set can be discarded, and the mapping can still be viewed
and exported. Each alignment keeps the read's name, flag, mapping quality,
CIGAR, mate (reference, position, template length), its qualities, and its
bases. The bases are written as their differences from the reference, in the
style of minimap2's `cs` tag: `:n` for n matching bases, `*xy` for reference
base x read as y, `+bases` inserted, `-bases` deleted, `~n` skipped, plus the
soft-clipped bases at each end. A read that matches the reference is then a
few characters (`:150`), and the viewer and the pileup read the differences
directly. For export the bases are written back from the reference, which is
stored with the mapping. The differences are computed from SAM's SEQ and
CIGAR rather than asked of minimap2 (`--cs`), so imported SAM and BAM files,
which rarely carry a `cs` tag, are stored the same way.

- **Pages:** alignments are kept in pages of at most 4,000 alignments or 2 Mb
  of read bases, sorted by position on one reference, with an index of each
  page's first and last start and furthest end, so a view of one region loads
  only the pages over it. A page is three deflated sections: the fields as
  text (starts as differences from the line before), the names, and the
  qualities, each kept apart because they compress best among their own kind.
- **Sorting at scale:** alignments arrive in read order. Each goes to a bucket
  by reference and position, the buckets sized to hold about 20 million read
  bases at the depth the read set would give (its bases over the references'
  length). When the buckets together hold about 64 MB they are written to
  storage as they are. At the end each bucket is read back, sorted and written
  as pages, so a bacterial genome at depth is sorted one bucket at a time,
  never whole in memory. A synthetic test of 600,000 reads of 150 bp on 3 Mb
  (Node, one thread) stores in about 8 seconds and writes a BAM in about 6.
- **Coverage:** per base, and summarized at 16, 256 and 4096 bases per bin
  (mean, highest, and mean on the forward strand), for drawing coverage at any
  zoom without reading a whole genome's per-base values.
- **Candidate sites:** while the pages are written, every aligned base is
  counted at its position by what the read shows there (A, C, G, T, a
  deletion, or an insertion after it) and by strand. A position is kept when
  something other than the reference is seen in at least two reads and in at
  least 5% of the reads there (10% for insertions and deletions, which
  sequencers, Nanopore above all, get wrong far more often than single bases).
  Bases below Q13 are not counted, as `samtools mpileup` leaves them out by
  default; the depth of a site is the bases counted plus the deletions.
  Variant calling starts from these sites, so a genome's variant table does
  not need every alignment read again. Counts are kept in blocks of 4,096
  positions, and a block is written out once no alignment still to come can
  reach it; on a circular reference the first blocks stay open to the end,
  for the alignments across the origin.
- **Secondary alignments** are not kept (minimap2 runs with
  `--secondary=no`; an imported file's are counted and left out).
- **Discarding reads:** a read set's reads can be discarded to free storage.
  Its QC page stays; trimming, mapping, FASTQ export and Run again need the
  reads, and reads that mapped nowhere are lost. Mappings made from it keep
  every read they mapped.
- Mappings made before this format kept no bases; their report is kept, and
  they say to run them again.

### Viewing a mapping

A mapping stored in full opens on its reads when it has one reference and on
its report when it has several (a reference's row in the report opens its
reads); a switch in the header goes between the two. The view is drawn in the
style of IGV's alignment track: coverage, the reference's bases, and rows of
reads, from a whole genome down to single bases.

- **Loading:** only the pages over the stretch around the view are read: the
  visible stretch and as much again on each side, so panning does not reload
  at every step. Reads are drawn when the visible stretch is at most 150 kb
  (IGV's default visibility window is 30 kb) and the pages over it hold at
  most 200,000 alignments; further out the view shows coverage alone, from the
  stored summaries. Decoded pages are cached (24 at a time). Along the
  reference the view keeps its own position and scale rather than a native
  scrollbar, because a genome at a readable zoom is far wider than a browser
  lays out an element; the rows scroll natively.
- **Semantic zoom:** at every scale the coverage track; from 10 bases per
  pixel in, mismatches as ticks in their base's colour; from 2 bases per pixel
  in, insertions as marks between bases (longer ones at any zoom), deletions
  as a line through the gap; from 10 pixels per base (an 8 px font, the
  smallest that stays legible), the reads' bases as letters, the reference's
  bases, and the length of insertions and deletions.
- **Bases on the reads:** every base of a read is known without storing it
  again: where the read matches the reference it is the reference's base, and
  the stored differences give the rest. Close in, the bases are drawn one of
  four ways. *Highlight disagreements* (the default, as Geneious highlights
  disagreements) draws every base, the agreeing ones muted and each
  disagreeing one in its base's colour on a tint of it. *Dots where they
  agree* draws an agreeing base as `.` on the forward strand and `,` on the
  reverse, as `samtools tview` does, so a column of disagreements reads at a
  glance. *All in base colours* fills every base with its colour (from 2
  pixels per base, as coloured cells before letters fit), as Geneious colours
  nucleotides. *Only differences* draws what IGV draws: the read as a bar with
  only the differing bases on it. Disagreement is judged against the
  reference or against the consensus row; against the consensus, a variant
  every read carries fades and the minority reads stand out (a mixed clone, a
  second allele). Differing bases are always faded by base quality; every
  base can be too.
- **Consensus row:** under the reference, the majority of the loaded reads at
  each base (A, C, G, T or a deletion, the reference's base winning a tie),
  tinted where it differs from the reference; zoomed out, only those
  positions, as ticks. Where most of the reads covering a base insert bases
  after it, the row marks the insertion between the bases as the reads do. Every loaded read counts, as in the coverage track, so
  it is what the reads drawn say, before the thresholds of the variant
  settings; the consensus that is exported (see Variants) applies those.
- **Features and translation:** when the reference's sequence is open, its
  features are drawn above it in their own colours, packed into up to four
  lanes (a feature across the origin of a circular reference in two parts).
  Close in (from 3 pixels per base), a CDS or ORF shows its translation in
  place of its name: each amino acid centred on its codon, in the frame of
  the feature's start (its end on the reverse strand), with the standard
  genetic code, so a variant can be read against the codon it falls in.
- **Coverage track:** one bar per base when bases are a pixel or wider, else
  one per pixel column, from the best source at hand: the loaded reads (which
  also give the strands and the alleles), per-base coverage up to 256 bases per
  pixel, then the coarsest summary whose bins are no wider than a pixel. The
  mean is drawn, with the highest depth in the column faintly behind it, on a
  scale rounded up from the highest depth in view. A base where at least 20%
  of the reads differ from the reference (IGV's allele-fraction default) is
  split by base, A, C, G, T and deletions; zoomed out, such positions are
  ticked along the top from the stored candidate sites. Optionally split into
  forward (lower) and reverse strand, and shaded where the depth is below a
  chosen value; the shading and its threshold line follow the value as it is
  typed.
- **Downsampling:** where reads pile up, at most 100 reads starting in any 50
  bases are drawn (IGV's defaults). Which are kept depends only on a hash of
  the read's name (FNV-1a), so the same reads are drawn every time and the two
  mates of a pair are kept or dropped together. A band under the reference
  marks where reads were left out and a note says how many; coverage and the
  pileup always count every read, and downsampling can be turned off.
- **Layout:** reads in order of start, each into the first row where it fits
  after the last read there plus a gap of 2 bases (or 3 pixels' worth when
  loaded zoomed out). The first row with room is found with a segment tree
  over the rows' ends, so packing is O(n log rows) however deep the reads
  are; at most 3,000 rows, and reads beyond them are counted. Rows can be
  sorted by their read at a position (the centre of the view, or where the
  menu was opened): by base (reads that differ from the reference first,
  grouped A, C, G, T, other, deletions, best quality first in a group), by
  strand, mapping quality, fragment length or start.
- **Colours:** one colour, by strand (forward and reverse as in the Sanger
  contig view), or by pair. By pair, as IGV colours insert size and pair
  orientation: mates facing each other at the expected distance are plain;
  further apart than expected (a deletion between the mates in the sample),
  closer (an insertion), facing the wrong way or on the same strand (an
  inversion or rearrangement), with the mate on another reference, or with the
  mate unmapped (outlined) each have their own colour. The expected distance
  is the 0.5th to 99.5th percentile of the proper pairs' fragment lengths, as
  IGV computes it. On a circular reference, distances and orientation are
  taken the short way round the origin, so pairs across it are not flagged.
  Mismatches are faded by base quality, faint at Q5 and below and full from
  Q20 (IGV's shading), and reads of mapping quality 0 are drawn faint.
- **Fragment lengths:** the side panel shows the proper pairs' fragment
  lengths; dragging across the bars keeps the pairs of those lengths at full
  strength and fades the rest, to find the reads behind a shoulder or a
  second peak in the distribution.
- **Reads:** hovering a read shows its position, strand, length, mapping
  quality, differences (mismatched, inserted and deleted bases), soft clips,
  whether it is part of a split read, its mate and fragment, and the base
  under the pointer with its quality and its position in the read as
  sequenced. Clicking selects it and outlines its mate and the other parts of
  a split read wherever they are drawn; the side panel then offers Go to the
  mate (on another reference too), and copying the read as FASTA or FASTQ in
  its sequenced orientation.
- **Soft clips** can be drawn as faint extensions past the read's ends, their
  bases coloured.
- **Circular references:** a read across the origin is drawn at its start
  near the end and again from position 0, so both of its parts are in view.
- The view's position, zoom and display settings are kept for each mapping
  while the page is open.

### Variants

Sanger contigs and NGS mappings call variants with one shared core
(`assembly/variants.ts`). Each gathers its evidence its own way: where the
variant is, what it changes, how many reads cover the position and how many
carry the change on each strand, and how likely that many reads would show
it by sequencing error alone. One function then describes every variant the
same way: its codon and protein change inside a coding feature of the
reference, the features it is in, Fisher's exact test for strand bias, the
short tandem repeat it falls in, and the homopolymer an insertion or deletion
touches. Calling and judging are separate: every candidate is kept, and the
thresholds are applied on top, so the table changes as they are typed and
VCF can name the thresholds a variant failed.

- **Sanger evidence:** per contig column, each read's call counts as an
  allele (a gap too; a two-base IUPAC call counts half for each base).
  Neighbouring gap columns carried by the same reads merge into one insertion
  or deletion. The P-value is the exact Poisson-binomial chance that the
  carrying reads are all errors, from their base qualities.
- **NGS evidence:** calling starts from the candidate sites stored with the
  mapping (positions where at least 5% of reads, 10% for indels, differ). The
  pages over them are read once, in order, and every read is counted again in
  full at each site: its base and the base's quality, a deletion starting
  there with its length, an insertion after it with its bases, its strand.
  Pages with no site in their stretch are skipped. As `samtools mpileup`
  counts, bases below Q13 are left out; a read whose deletion runs across a
  site counts in its depth but for no base. Reads of mapping quality 0 are
  not counted: the aligner found another place they fit as well (a repeat,
  an rRNA operon, an IS element), so which copy they came from is a guess,
  and counting them turns the other copies' differences into false
  low-frequency variants. This is what Geneious's mapper does with "Map
  multiple best matches: to none"; GATK goes further and leaves out reads
  below MAPQ 20. Such reads are still drawn and still count in the coverage,
  so in a repeat the called depth can be lower than the coverage track.
  Indels are counted where the aligner put them, without left-normalising
  them first. An indel inside a repeat could be written at any of several
  equivalent positions, and if reads disagreed its evidence would be split
  between them; Geneious realigns reads to each other around indels for
  this reason. Checked with minimap2 2.22 (`sr` and `map-ont`) on a CAG
  repeat deletion, an AT repeat insertion, a homopolymer deletion and a
  deletion next to a near-repeat, with reads on both strands at every offset:
  every read that spans the indel places it at the same position, so no
  realignment step is needed for mappings made here. Imported BAM files
  from other aligners are taken as they are. This runs in the background (on
  the page when opened from disk) and the counts are stored with the mapping,
  so the table opens at once afterwards. Each site gives at most one variant
  of each kind: the strongest other base, the strongest deletion starting
  there, the strongest insertion after it.
- **NGS P-value:** the chance of that many reads showing the allele by error,
  as a Poisson tail. For a base, the expected number of error reads is the
  sum of the error chances of the bases counted there (from their
  qualities), a third of it for one particular wrong base. For an indel,
  base qualities say little, so a per-read indel error rate is assumed: 1e-4
  for Illumina, 1e-3 for PacBio HiFi, 0.03 for Nanopore, 0.01 otherwise.
  The Poisson stands in for the exact Poisson-binomial, which costs O(n^2)
  at depths of thousands; with small error chances the two are close (Le
  Cam's theorem). The tail is summed term by term in log space, so very
  certain calls get a P-value rather than 0 until it underflows; quality is
  shown as -10 log10 P (Phred), capped at 999.
- **Homopolymers:** an insertion or deletion of one base kind is flagged with
  the length of the reference's run of that base where it happens (a
  deletion of A in AAAAA gives 5). Nanopore reads miscount the bases of such
  runs, so their indels there are mostly errors.
- **Thresholds** (presets, then editable): depth, share of reads carrying
  the variant, number of reads carrying it, quality, leaving out strand-biased
  calls (Fisher p below 1e-5), leaving out indels in homopolymers of a given
  length, coding only.

| Preset | Depth | Frequency | Reads | Quality | Strand bias | Homopolymer indels |
|--------|-------|-----------|-------|---------|-------------|--------------------|
| Sanger | 1 | 25% | - | Q40 | kept | kept |
| Illumina | 10 | 20% | 3 | Q60 | left out | kept |
| Nanopore | 10 | 30% | 5 | Q60 | kept | left out from 4 |
| PacBio HiFi | 5 | 20% | 3 | Q60 | kept | kept |

  Illumina's artefacts are often on one strand, so strand-biased calls are
  left out there; Nanopore has real strand-specific errors and HiFi reads
  both strands of one molecule, so they keep them. The mapping's minimap2
  preset chooses the starting preset (an imported file starts on Illumina).
- **In the mapping view:** variants that pass show as a track under the
  coverage (a SNP in its new base's colour, insertions and deletions marked
  apart, fainter the rarer they are) and in a table docked under the reads.
  The two are linked: a row moves the view to the variant (close enough to
  read the bases), pointing at the track lights up the row, and both show the
  evidence (the alleles seen with their strands and mean quality, and what
  any failed threshold was). The table is drawn only where it is scrolled to,
  so a genome's thousands of variants stay quick.
- **Saving:** "Add to the reference" adds a `variation` feature for each
  variant listed to the reference sequence, or, when it is not open, opens
  the copy stored with the mapping with them. Variation features are left out
  when variants are described, so a variant is never reported as being in
  itself.
- **VCF 4.2:** the variants that pass, or every candidate with the thresholds
  it failed in FILTER, for every reference of the mapping. An insertion or
  deletion is anchored on the base before it (at the first base, on the base
  after), as the specification requires. QUAL is the Phred-scaled P-value;
  INFO carries depth (DP), reads carrying it (AO), frequency (AF), strand
  counts (DP4, as samtools writes them), the strand bias P (SB), the type,
  the homopolymer length (HP), the repeat (REP), the features (FEAT) and the
  coding effect (EFF). Sanger contigs export the same VCF, against the
  reference, or along the consensus for a de novo contig.
- **Consensus:** the sample's sequence, as `ivar consensus` builds it. At a
  site the alleles (bases and deletions) are taken, commonest first, until
  together they reach the threshold (50% by default): one base is written as
  itself, several as their IUPAC code (or the commonest, if codes are
  turned off); a deletion that comes first removes its bases; an insertion
  carried by at least the threshold share is written in. Positions covered by
  fewer reads than the minimum depth (10 by default) are written as N; at a
  site the depth counts the reads deleting it too, since per-base coverage
  counts aligned bases only and would otherwise mask a deletion most reads
  carry. Away from the candidate sites at least 95% of the counted reads
  match the reference, so the reference base stands there for any threshold
  up to 95%. Mapped back from the test reads to a copy of their genome with
  two bases changed, three bases added and two removed, the consensus gives
  the original genome back base for base, apart from its poorly covered
  ends.

### Samples

A mapping holds one or more samples: read sets (or an imported SAM or BAM
file) mapped to the same references. "Add samples" maps more read sets to
the copies of the references the mapping keeps, so every sample is mapped to
exactly the same bases, each with minimap2 set for its kind of reads. The
reads and report pages show one sample at a time; the samples page shows
them side by side. Mappings saved before samples load as mappings of one
sample.

- **Samples x variants matrix:** one row per variant that passes the
  thresholds in at least one sample, one column per sample. A cell is the
  share of that sample's reads carrying the variant, strong where it passes
  there. A blank cell means fewer reads than the depth threshold cover the
  position, so the sample cannot say; that is kept apart from 0%. A sample in
  which the position was not even a candidate site (fewer than 5% of reads
  differed) shows 0% at its stored depth. "Only where samples differ" keeps
  the rows some sample carries and another, covering it, does not. A cell
  opens that sample's reads at the variant. The matrix exports as CSV, with a
  frequency and a depth per sample.
- **Clone verification per sample:** the same verdict as for a Sanger
  contig (`assembly/verify.ts`, now shared through `verifyPileup`): every
  feature of the reference (or the whole reference when it has none open) is
  checked for coverage by at least a set number of reads, optionally on both
  strands, and for differences, the variants most of the sample's reads carry
  (at least half, from at least two reads, at a covered position). Depth
  comes from the stored per-base coverage; both strands from the 16-base
  coverage summary, so a bin with reads on each strand counts for every base
  in it, an approximation that matters only at the very edge of coverage.
  `variation` features (variants saved earlier) are not checked as features,
  for Sanger contigs too.

### Primer clipping

For amplicon sequencing (tiled PCR panels, amplicon-based virus
sequencing), every read starts with a primer, whose bases come from the
oligo rather than the sample: a mutation under a primer is hidden by reads
that copy the primer, and a primer's mismatch to the sample looks like a
variant. With "Clip primers" on, the oligos of the primer library are
looked for on the references (the same binding search as primer display,
`primers/binding.ts`), and while the mapping is stored each alignment whose
5' end (its start on the forward strand, its end on the reverse strand)
lies inside a binding site, give or take 3 bases, has the aligned bases up
to the far side of the site turned into a soft clip, as `ivar trim` does.
The bases are kept (they still export and can be shown) but no longer count
for coverage, variants or the consensus. An insertion or deletion left at
the new edge goes into the clip too; an alignment left with nothing aligned
counts as not mapped. Only the 5' end is clipped: a read running through to
the opposite primer at its 3' end keeps those bases, as with ivar's
defaults. The report says how many alignments were clipped.

### Junctions

Positions where many reads stop aligning at the same base mark where the
sample's sequence leaves the reference: the edges of deletions too long to
align through, inversions, inserted DNA, a plasmid's junction with its
vector. "Find junctions" reads every stored alignment once (in the
background) and counts, at each end, alignments with 10 or more bases
soft-clipped there, by side. A junction is kept when at least 3 reads and at
least 10% of the reads covering the position are clipped there (at most 500
per reference, the best supported). Its clipped sequence is the majority
base at each distance from the junction while two or more reads reach that
far. The 20 bases next to the junction are then looked for on every
reference, both strands, and where they are found exactly once is where the
sequence continues: further on the same strand reads as a deletion of the
bases between, back on the same strand as a duplication, the other strand as
an inversion, another reference as a join to it. These are suggestions to
look at, not calls. The result is kept with the mapping; a junction in the
table opens the view there with the soft-clipped bases shown.

### Guided pipeline

"Analyse reads" (on a read set's page, and "Analyse NGS Reads" in the
command palette) goes from read sets to a mapping with its variants in one
go. For each read set chosen, in turn: trim and filter with the default
settings (fastp for short reads, length and quality for long ones) into a
new read set, unless turned off or the read set was made by trimming
already; map to the references chosen, with minimap2 set for the kind of
read and, for amplicons, primer clipping; then find the variants, and the
soft-clip junctions if asked. Every read set becomes a sample of one
mapping, which opens at the end. Each step is the same background job the
separate dialogs run, so the results are the same; a step that fails stops
only its own sample, and the table of steps says which and why.

Switched to "Assemble de novo" (also "Assemble NGS Reads de novo" in the
command palette), each read set is instead cleaned up (long reads: reads
below Q10 left out, reads kept down to 100 bp so a short amplicon keeps its
reads; short reads: fastp as for mapping), assembled with the method for its
reads, mapped back to its own contigs with their variants, and made an
assembly of its own.

### De novo assembly

"Assemble de novo" (on a read set's page, or in the guided pipeline) makes
contigs from the reads alone, with no reference. The result is an assembly
like a mapping: every read is mapped back to the contigs with minimap2, and
the candidate variant sites are recounted, so the contigs open in the same
reads view with coverage, variants, report, BAM export and figures. Reads
that disagree with a contig are its variants, which is how a minority of
the population (a point mutation in some clones) shows up. The contigs are
kept with the mapping as its references; a Contigs page lists them and opens
each as a sequence or exports them all as FASTA.

**Whole plasmids and amplicons from long reads (seed and polish).** When a
plasmid or an amplicon is sequenced whole on nanopore or PacBio, many reads
are its full length: a plasmid opened at a random place by the library
preparation, an amplicon end to end. They make a sharp peak in the read
lengths, standing out from the broad spread of broken molecules and stray
DNA. Each peak is taken as a product.

1. **Peaks.** For every read length x, the reads within 2% of it are counted,
   and the flanks (the next two window widths on either side, counted over
   all reads) give how many the window would hold by chance. A peak must hold
   at least the fewest reads per product (5 by default) more than that, and
   so many that a Poisson tail puts the chance of it below one in a million.
   The strict test matters because thousands of windows are looked at: at
   the usual 5% a broad spread of broken molecules would show peaks
   everywhere. The peak with the most reads is taken, its reads set aside,
   and the next one looked for (up to 8).
2. **Seed.** Of the peak's reads within half a percent of its median length,
   the one with the best mean quality (from error probabilities) is the
   first draft.
3. **First round, alone.** Each seed is polished with its own peak's reads
   only (the 200 best). Two raw reads differ by several percent, so a read
   cannot yet tell its own product's seed from a related one's (a plasmid
   with and without an insert, a dimer); against every seed at once the
   reads of one product were found to scatter over the others.
4. **Judging.** In that round each draft is aligned to as if circular (its
   start appended, as for a circular reference). It is **circular** when at
   least two reads, and a fifth of the median depth, run across its origin
   with 100 bases (or a tenth of its length) on both sides; otherwise
   **linear**. It is dropped when fewer reads than the fewest per product line
   up with it over 90% of its length (a peak of broken molecules that only
   share a length). Once polished, drafts are compared by canonical 15-mers:
   when each has at least 90% of the other's and the longer is at least 1.6
   times as long, the longer is a **dimer** (or longer repeat) and is
   dropped; when their lengths also agree within 1%, they are the **same
   sequence** and the second is dropped; a linear draft inside a longer one
   is a **piece** of it. The thresholds are high because polished contigs
   keep nearly all their k-mers, while a plasmid with an 800 bp deletion still
   has 85% of the full one's and must stay a product of its own (a mixed
   clone). Shortest first, so a monomer is kept over its dimer.
5. **Polishing rounds.** The best reads (all of them, or the highest-quality
   ones up to 20 Mb of bases) are aligned to every draft at once
   (`minimap2 -a -x map-ont` or `map-hifi`, no secondary alignments), so each
   read goes to the product it came from, and each draft becomes the reads'
   majority consensus: at each position the commonest base, the position
   left out where more reads delete it than show any one base, and an
   insertion written in where at least half the reads across that gap insert
   something (the commonest length, then the commonest base at each place).
   This is samtools consensus's simple mode, counted from the SAM records
   directly. Rounds repeat until one changes nothing, up to 5.
6. **Closing the circle.** A seed read rarely is exactly one circle: it may
   repeat a few bases at its ends or lack a few. Reads across the origin of
   the extended draft delete the repeated bases or insert the missing ones,
   so the consensus closes the circle in the first round. Its start stays
   where the seed read began.
7. **Linear ends.** A linear contig's ends are trimmed back to where at
   least 3 reads, and a tenth of the median depth, cover them, and extended
   where the reads that reach an end go on past it (as soft clips) and agree
   on what follows: as far as half of them go, column by column, stopping
   where fewer than 70% agree over 10 bases, at most 200 bases a round.

Each contig reports its length, shape, its full-length reads and their share
of all full-length reads (the product's share of the sample), its depth, and
how many positions each round changed. On simulated nanopore reads (1%
substitutions, 1% insertions, 1.2% deletions) the first round takes a seed
from a few hundred errors to none, and the contigs match the true plasmid and
its deletion variant exactly; the tests in `ngs/denovo` check this, and a
dimer and a broad spread of broken molecules.

**Why seed and polish.** A plasmid sequenced whole needs no overlap graph:
its full-length reads already span it, so one of them is a draft with the
right structure from the start, and polishing only fixes its bases. That
reuses the mapper and needs no assembler compiled to WebAssembly (none is in
the biowasm catalogue). It also makes mixed products easy to keep apart,
since each starts from its own peak. A genome (much longer than the reads)
needs an overlap graph instead, below.

**Limits.** The contigs are a majority consensus of raw reads. On nanopore
reads that leaves errors most reads make the same way, mainly homopolymer
runs a base short or long, which a model-based polisher such as medaka would
correct (see Polishing elsewhere below); check those against an expected
sequence when they matter. Two products whose lengths are within about 2% of
each other fall in one peak and come out as one contig, the other's
differences as variants. A circular contig starts wherever its seed read
began. minimap2 is WebAssembly, so like mapping this needs SeqNexus opened
from a web address (or serve.bat), not from disk.

**A genome from long reads (overlaps, layout, consensus).** When nanopore or
PacBio reads come from a genome, no read spans it. They are assembled by
their overlaps, as miniasm does, and the result polished by the reads.

1. **Reads.** The longest reads of at least 1 kb, leaving out the tenth with
   the lowest mean quality, up to 40x of the genome length when the dialog
   is given one, or up to 200 Mb of reads when not. Longer reads span longer
   repeats, and past about 40x more reads add overlaps to compute but no
   contiguity (Flye and Canu also start from the longest reads). The 200 Mb
   cap keeps minimap2's index of the reads inside WebAssembly's memory: a
   5 Mb genome at 30x (150 Mb of reads) was overlapped in one run of 71
   seconds and fitted.
2. **Overlaps.** minimap2 aligns every read against every other in one run
   (`-x ava-ont`, or `ava-pb` for PacBio). Overlaps with fewer than 100
   matching bases, or shorter than half the shortest overlap, are dropped.
   The shortest overlap is 2 kb, as in miniasm, or a fifth of the reads' N50
   when that is less (at least 500 bases).
3. **Trimming.** Each read keeps its longest stretch covered by at least 3
   other reads. That cuts off low-quality ends and adapters the others do
   not share, and a chimeric read (two pieces of the genome joined) keeps
   only its longer piece, since few reads span the false join.
4. **Classing overlaps.** On the trimmed reads each overlap is internal (an
   overhang over 1 kb, or the overlap under 80% of the stretch it would
   join: two reads sharing a repeat and going on into different places,
   dropped), a containment (one read inside the other: the inner read adds
   nothing to the layout and is set aside, though it still polishes), or a
   dovetail (the end of one read runs into the start of the other). A
   dovetail is an arc of the string graph, which has a vertex for each
   strand of each read: an arc v to w of length l says v's first l bases
   come before w starts, and every arc has its mirror between the reverse
   complements (Myers 2005).
5. **Cleaning**, in miniasm's order: transitive reduction (an arc v to x is
   dropped when v to w to x reaches x as far along, within 1 kb), tips (dead
   ends of up to 4 reads off a branch), short overlaps at a branch (an arc
   whose overlap is under 70%, then 80%, of the longest there: a repeat
   shared with another place), and bubbles up to 50 kb across (two paths
   between the same reads: the path through more reads stays).
6. **Unitigs.** The paths without a branch, each read giving the bases
   before the next one starts; a path that comes back to its start is a
   circle. A linear unitig whose end repeats its start (the reads ran on
   past the origin of a circle the graph did not close) is cut to one turn:
   the 15-mers seen once in its first 5 kb vote for the offset where they
   occur again in its second half, and when the best offset has at least 20
   votes and the match runs to the end, the unitig is cut there and made
   circular. The overlap can be as long as a read (35 kb on the benchmark's
   chromosome), so when it is longer than the probe its last 5 kb are checked
   too, against the bases one period earlier. Unitigs with fewer reads behind them (those inside them
   counted) than the fewest per contig (5) stay in the graph but are not
   contigs.
7. **Consensus.** The unitigs are raw read sequence, with the reads' errors.
   The same reads are aligned to them (`minimap2 -a -x map-ont`, in batches
   of 40 Mb of reads) and each becomes the reads' majority consensus, as for
   whole products, for up to the rounds set (5), stopping once a round
   changes fewer than 10 positions per megabase. After the first round,
   drafts that are copies of another are dropped: a high-copy plasmid's
   reads lie in and across each other every way round, and the graph can lay
   it out several times. Each draft is aligned to the others
   (`minimap2 -x asm20`, which tolerates what errors the first round
   leaves; exact k-mers would not, two raw copies sharing too few), and one
   covered over 90% of its length by another it gives way to goes: a circle
   wins over a linear copy of about its length (the copy's extra bases are
   the overlap left at its ends), a linear draft holds a circle only when
   more than twice as long, and otherwise the longer wins, then the one more
   reads went to. This runs again after the last round and step 8, when
   copies too rough to align at first have been polished and the linear
   copies of a plasmid lie inside its closed circle. Left in, the copies split
   the plasmid's reads between them, stayed full of errors and kept
   polishing from settling. A genome's pileup is kept
   compact: counts in 16 bits (saturating at 65,535) and single-base
   insertions counted by base in an array; only longer insertions are kept
   as strings.
8. **Small plasmids.** A plasmid shorter than the shortest overlap cannot be
   laid out: its reads lie inside each other or overlap too little. When the
   read lengths show peaks (a rapid library opens each plasmid once, so its
   reads are full length), those products are assembled by seed and polish
   and added, unless an overlap contig already holds 90% of their 15-mers.
   An overlap contig that is the same replicon but did not close (linear,
   and at most 1.6 times as long) is replaced by the closed product.
9. **Short reads (optional).** An Illumina read set of the same sample can
   polish the contigs (hybrid polishing): about 80x of its reads are mapped
   (`-x sr`, mates together), and a position changes where more than half
   of at least 5 reads disagree with it, for up to 3 rounds. Long reads
   share their homopolymer errors, so their consensus keeps them; short reads
   do not. A higher bar (60%) was tried first and failed where a missing
   base and an extra one lie a few bases apart: some short reads align the
   stretch between as two gaps and others as a run of mismatches, both
   right, each about half of the reads, so neither reached the bar; an
   absolute majority takes one of them whole. Linear ends stay as the long
   reads have them, since short reads would trim them back.

**Whole products or a genome.** By default the read lengths decide: when at
least 15% of the read bases are in length peaks (full-length copies of a
product), the run is assembled as whole products, otherwise as a genome. A
whole-plasmid run has most of its bases in its peaks; a genome library's
reads are broken at random, with at most a small plasmid's peak among them.
The dialog can set either, and the Contigs page says which was used and why.

On simulated nanopore reads (1% each of substitutions, insertions and
deletions) of a 300 kb chromosome with three copies of a 1.5 kb element and
a 30 kb plasmid at twice the depth, both come out as circles with no
difference from the true sequences, in about 27 seconds (Node, one thread);
a 1.5 kb plasmid with full-length reads comes from its peak; and noisy reads
at 14x (4 to 5% each of substitutions, insertions and deletions) leave 667
differences in a 60 kb chromosome, which short reads at 60x take to none
(`ngs/denovo/genome.test.ts`). On the simulated test files of a small
genome (183.9 kb chromosome, 8 kb plasmid at three copies, nanopore reads
at 50x with a base lost in most reads at each long homopolymer), the
plasmid comes out as a circle one homopolymer base short, and exact once
the Illumina reads of the same genome polish it; the chromosome comes out
as two contigs overlapping each other by 19 and 12 kb at their ends, which
together are the whole circle. On the benchmark's 5 Mb genome (described
under Short reads below; nanopore reads at 40x, read N50 about 20 kb, 1%
each of substitutions, insertions and deletions) assembly takes about 5
minutes on one core in Node, 4.5 of them in minimap2 (2.5 overlapping,
the rest polishing), and holds up to about 1.1 GB, WebAssembly included:
6 contigs, an N50 of 3.4 Mb, both plasmids circular (six copies of the
small one dropped), and about 40 errors in 5.2 Mb, most at the ends of
the two smaller chromosome pieces, where they overlap the larger ones
(`ngs/denovo/denovo.bench.test.ts`).

**Why overlaps for long reads.** A de Bruijn graph needs exact k-mers, which
reads with a few percent of errors seldom share over long stretches;
overlaps tolerate the errors, and a string graph keeps each read's whole
length to span repeats. minimap2 already computes the overlaps in
WebAssembly, so the layout is the only new part (plain JavaScript), and the
consensus reuses seed and polish's. Correcting the reads before the layout
(Canu) or building a repeat graph from them (Flye) gives longer contigs on
real data, but would need those assemblers compiled to WebAssembly, which
none is.

**Limits.** Simulated reads have random errors; real nanopore reads also
have systematic ones (homopolymer lengths), which a majority consensus
keeps without short reads or medaka. Repeats longer than the reads that
would span them break contigs. Two contigs that meet at a branch overlap by
as much as the reads that joined them (several kilobases), as miniasm's
unitigs do; the Graph page links them, and the reads mapped back show the
overlap at both ends. Two strains in one sample merge where they
are alike. The reads laid out are capped at 200 Mb by minimap2's memory. A
mixed plasmid population (a clone with a deletion in part of it) is better
assembled as whole products, which keeps the variants apart.

**Short reads (de Bruijn graph).** Illumina reads are far shorter than a
plasmid, so no read spans it; they are assembled from their k-mers instead,
as Velvet and SPAdes do.

1. **Genome length.** The read set's 21-mer spectrum (see k-mer spectrum
   below) gives the genome's length and coverage.
2. **Sampling.** Reads are taken at random (by a hash of their index, so a
   run is repeatable) down to about 100x of that length, at most 300 Mb of
   bases (60x of a 5 Mb genome): past that, more reads add error k-mers but
   no contiguity, and each k costs a pass over them.
3. **Counting.** At each k, every canonical k-mer of the sampled reads is
   counted, packed two bits a base in typed arrays (k up to 127 in four to
   eight 32-bit words) in an open-addressing hash table. A Bloom filter in
   front lets a k-mer in only from its second sighting, since in short reads
   most distinct k-mers are sequencing errors seen once (the approach of
   BFCounter). k-mers below the **solid threshold** are dropped: the bottom
   of the valley between the error k-mers and the genome's peak in that k's
   own spectrum, at least 2 and at most a third of the peak, so a stretch
   covered at a third of the usual depth stays in.

   The Bloom filter is blocked (Putze, Sanders and Singler): a k-mer's seven
   bits lie in one 512-bit block, one cache line, instead of seven places
   far apart, and the k-mer is hashed once for the filter and the table, then
   looked up once (found and counted, or inserted at 2). On 30 Mb of reads
   that took counting from 5.1 to 3.8 seconds, the filter's own share from
   2.0 to 0.5. Both are sized once from the spectrum: the filter for the
   genome's k-mers and the error k-mers the sampled reads bring (the 21-mers
   below the trough, times k / 21, since each error makes up to k), the
   table for the genome's k-mers and a few percent of the errors. The table
   takes any capacity, not a power of two (a key's first slot is its hash
   scaled to the capacity), and is filled to 70%, so a 5 Mb genome at k 99
   takes about 300 MB instead of twice that.
4. **Unitigs.** Solid k-mers that follow one another without a branch are
   chained into unitigs, walking with the k-mer and its reverse complement
   both rolled a base at a time, so a neighbour costs a shift and a table
   lookup. A unitig whose end leads back to its own start in the same
   orientation is a **circle** (a plasmid resolved whole) and loses the k-1
   bases it repeats.
5. **Cleaning**, until nothing changes: a short unitig (under 2k bases) with
   a dead end and under a quarter of its neighbours' coverage is an error
   **tip**; of two short unitigs between the same neighbours (a **bubble**)
   the less covered goes, whatever the ratio, so a mixed site takes the
   majority and the minority shows up as a variant when the reads are mapped
   back; any short unitig under a tenth of its neighbours' coverage goes.
6. **Choosing k.** k = 21, 33, 55, 77, 99 and 127 are tried, those up to 80%
   of the mean read length where k-mer coverage (depth x (L - k + 1) / L)
   stays at least 10. A larger k spans longer repeats but needs more
   coverage. The k giving the best N50, then the fewest contigs, then the
   larger k, is kept (SPAdes and Unicycler also weigh several k). On a
   genome of 1 Mb or more, k under 55 is skipped when two larger k qualify:
   a bacterial genome's repeats break a small-k graph into many more pieces,
   and each k is a pass over all the sampled reads. Unitigs of at least
   200 bp (a setting) are the contigs, longest first.
7. **Joining with the pairs.** A pair is two reads from the ends of one
   fragment of known size, so mates on two contigs say the contigs follow
   each other, on which strands, and how far apart. Reads are placed by a
   sparse index of the unitigs: their canonical 31-mers whose hash falls in
   one eighth of hashes (31-mers in two places left out), so a read and a
   unitig sample the same 31-mers and the first hit places the read, its
   strand and its 5' end. 31 rather than the graph's k because a mate lying
   mostly over a repeat is still placed by a short unique stretch: with k 99
   a mate would need over 100 unique bases and a 350 bp insert would span
   repeats of about 130 bp at most, against about 230 bp. Pairs with both
   mates on one unitig, facing each other, give the insert's median and
   spread (median absolute deviation times 1.4826). A pair with its mates on
   two anchors (unitigs at least as long as the insert) links the ends they
   face, estimating the gap as the insert less each mate's distance to its
   end. An end whose strongest link (at least 5 pairs, and 4 times the next)
   is returned in kind is joined to the other end when exactly one path of
   shorter unitigs between them has the gap's length within 1.5 standard
   deviations (at least 30 bases); the path is the sequence between, so a
   repeat's copy goes into each join it lies in. Chains of joins become
   contigs, a chain closing on itself a circle. The unitigs inside joins are
   no longer contigs of their own. This resolves repeats shorter than the
   insert, as SPAdes's and ABySS's paired stages do; longer ones still break
   contigs, and ends linked with no single path that fits stay apart.

**Why not minimizer partitioning.** The plan was to count k-mers in
partitions by minimizer, as KMC and BCALM do, for cache locality and memory.
Measured, most of the counting time was the Bloom filter's seven scattered
probes, which the blocked filter removed; what remains is one table probe per
k-mer. Partitioning keeps super-k-mers, about three times the read bases at
these k, which on disk is cheap but in a browser's memory is not, and the
graph walk needs every solid k-mer in one table anyway.

On simulated 2x150 reads of a plasmid prep (a 6.2 kb plasmid at 300x, a
2.1 kb plasmid at 1500x, host DNA at 3x) both plasmids come out as exact
circles in a few seconds; a 200 kb genome at 100x in about 15 seconds (Node,
one thread) as one exact contig. On a 93 kb genome with two short repeats
(160 and 180 bp) twice each and a 1.2 kb repeat twice, k 99 gives six
contigs and the repeats; the pairs (380 bp inserts) join them through the
short repeats into two exact contigs, broken only at the long repeat
(`ngs/denovo/pairs.test.ts`). On the benchmark's simulated bacterial genome
(a 5 Mb chromosome with seven 5 kb rRNA operons, ten 1.3 kb insertion
elements and twenty short repeats of 120 to 215 bp twice each, a 60 kb
plasmid at two copies and a 4 kb one at ten; 2x150 reads with 350 bp
inserts at 60x and 0.3% substitutions), assembly takes about 3 minutes on
one core in Node and holds up to about 1.5 GB: k 77 is kept (N50 87 kb),
the pairs make 40 joins through the short repeats, and the result is 22
contigs with an N50 of 348 kb, both plasmids circular and no contig 31-mer
missing from the true sequence; the rRNA operons and insertion elements,
longer than the insert, still break the chromosome
(`ngs/denovo/denovo.bench.test.ts`). Genomes estimated above 15 Mb
are refused (memory of the k-mer tables).

**Assembly graph.** A de novo assembly keeps its graph (stored with its
mapping, deflated with the sequences) and draws it on a Graph page, as
Bandage does. For short reads the segments are every unitig left after
cleaning, the contigs and the shorter pieces between them, and a link joins
the end of one to the start of another in either orientation (`+` or `-`),
overlapping by k-1 bases (a contig the pairs joined is several segments,
"Contig 2, part 1" and so on); for long reads of whole products each contig
is a segment, a circle linked to itself; for long reads of a genome every
unitig of the string graph is a segment, linked where reads overlap from one
into the next, each link with its own overlap. The graph says why contigs end where they do: a repeat is
a short segment several contigs lead into and out of, usually at a multiple
of the usual coverage (on a small genome with three copies of a 1.3 kb
insertion element, the three stretches of the chromosome are loops leaving
the element and coming back to it, the element at 3x); a circle is a
replicon resolved whole; a dead end is where coverage ran out or a linear
molecule ends.

- **Layout:** each segment is a chain of points, more the longer it is
  (about 700 in all, 2 to 90 a segment, a circle at least 8), so a stroke's
  length shows the sequence's. Springs of rest length 1 hold chains
  together and, stiffer and shorter, join the ends links join; every point
  pushes the others apart with a force falling as 1/distance (all pairs up
  to 1,200 points, a grid of near neighbours above), which opens a loop
  that leaves a repeat and returns to it instead of folding it in two; each
  inner point is pulled toward the middle of its neighbours, which keeps
  strokes smooth; a weak pull to the middle keeps a component together.
  500 steps with a shrinking step size (Fruchterman and Reingold's scheme),
  from a start where segments are placed breadth-first next to a placed
  neighbour, seeded so the same graph is drawn the same way. Components are
  laid out apart and packed in rows, largest first.
- **Colour:** coverage against the assembly's usual coverage (the
  length-weighted median over the segments), mixed from the theme's colours:
  warning at a quarter or less, accent at the usual, success at three times
  or more (a repeat in three copies, a plasmid at three copies per cell).
  Or contigs against pieces.
- **Use:** drag to move, wheel to zoom, click a segment for its length,
  coverage, joins and neighbours, to open or copy its sequence, or (a
  contig) to show its reads. Graphs of more than 4,000 segments are not
  drawn; Export GFA (GFA 1, with `LN` and `KC` or `DP` tags Bandage reads)
  works for any.

**Compare to expected.** A contig can be checked against the sequence it
was expected to be (the designed plasmid, the reference an amplicon comes
from), as a clone verification report.

1. **Strand and start.** Every 15-mer of the expected sequence that occurs
   at most four times is indexed; each 15-mer of the contig, read forwards
   and as its reverse complement, votes for the diagonal it lands on
   (around the circle for a circular expected sequence). The strand with
   the most votes wins. A circular contig is reverse complemented if need
   be and turned so that its base at the expected start comes first, taken
   from the anchor nearest after that start (a deletion elsewhere moves the
   diagonal, so the commonest diagonal alone would put the start wrong). A
   linear contig stays as it is; a circular expected sequence is turned so
   the contig lies inside it.
2. **Alignment.** The turned contig is aligned to the expected sequence with
   affine gaps (match 2, mismatch -4, gap open 6 plus 2 a base, the
   assembler's banded aligner): end to end for a circular contig, with free
   ends on the expected side for a linear one. Only a band of diagonals is
   filled, all those the anchors voted for and 60 more on each side, so an
   800 bp deletion is spanned in one alignment at the cost of a band 900
   wide rather than the whole matrix (at most 60 million cells).
3. **Differences.** Mismatched columns are substitutions and runs of gaps
   deletions or insertions, in expected coordinates. Each is described as
   the variant caller describes variants (protein change, tandem repeat
   around it), and the verdict comes from the clone verification check used
   for mapped reads: a feature is verified when every base of it is in the
   contig, with at least the chosen number of reads over it (the reads'
   depth on the contig, carried across the alignment), and has no
   difference. The contig is the reads' consensus, so these are differences
   in the clone; a minority of the reads disagreeing (a mixed clone) shows
   in the contig's variants instead.
4. **Lining it up.** "Open lined up" opens the turned contig as a sequence
   with the expected features carried over: each end of a feature goes to
   the contig base it aligns to, or the nearest one inside the feature when
   it was deleted; a feature with no base left is left out, one whose length
   changed is moved and named in the message (spliced features lose their
   exon list). The differences can be added as variation features. "Turn
   the contig to match" also maps the reads again to the turned contig,
   linked to that sequence, so the Reads page shows its features and
   translation over the reads (with an Undo).

**Lined up as it is assembled.** The same steps run on their own while an
assembly is made, between the assembler and mapping the reads back: each
contig is scored against every open sequence of 100 bp to 2 Mb (or the one
chosen in the dialog, or none) by its anchor votes alone, the best match
above the threshold is aligned, and the contig takes its strand and (when
circular) its start. When the contig is then the same length with no
insertion or deletion against it, substitutions at most, the two share
coordinates, so the contig is linked to that sequence and the Reads page
draws its features and translation over the reads from the start. A
contig that differs in length (a deletion clone) is lined up but not
linked; Compare to expected opens it with the features carried over. The
Contigs page marks lined-up contigs with the sequence's name.

On the simulated whole-plasmid run the full plasmid is verified against
the expected sequence with no difference (on the other strand, its start 865
bases on), and the minority product shows the 800 bp deletion.

**Depth against GC.** With two or more contigs the Contigs page plots each
by GC content and read depth, sized by length (as BlobTools plots
assemblies, without the taxonomy). One genome's contigs gather in one
cloud; a plasmid at more copies per cell sits higher at the same GC, DNA
from another organism usually at its own GC, a collapsed repeat at a
multiple of the depth. Depth is on a log scale when it spans more than
eight-fold.

**k-mer spectrum.** On a read set's page "Count k-mers" counts its 21-mers:
how many occur once, twice, and so on. Errors make a steep fall at the left,
the genome a peak at its k-mer coverage, and the genome's length is the
k-mers at or past the valley, each counted as often as it occurs, divided by
the peak (GenomeScope's simplest estimate; a repeat or a high-copy plasmid
counts once per copy). Large read sets are sampled by k-mer, not by read:
only k-mers whose hash falls in the lowest share are counted, so each is
counted every time or never, the spectrum keeps its shape and the length is
scaled back by the share (the idea of FracMinHash sketches). The share keeps
about 8 million distinct k-mers at most. The chart weights each count by
itself, so the genome's peak is not dwarfed by the error k-mers seen once.

**Polishing elsewhere.** medaka is the usual way to correct nanopore
contigs, but SeqNexus cannot include it: its licence (Oxford Nanopore
Technologies PLC. Public License 1.0) allows research use only and is
incompatible with the GNU licences SeqNexus is under, and it runs on Linux
and macOS only. The Contigs page gives the command to run it on the exported
contigs and reads, and "Import polished contigs" reads its consensus FASTA
(or Polypolish's or Pilon's) back: contigs are matched by name, or in order
when no name matches and the counts agree; the reads are mapped to the
polished contigs, which replace the old ones, with an Undo.

### Figures

The mapping view exports a stretch as a figure: the view as it is, or a
stretch typed in, as SVG (vector, for Illustrator or Inkscape), PNG at 2x or
4x, or PDF through the print dialog. Tracks: ruler, coverage (optionally by
strand), variants with their coding changes where there is room, the
reference's bases when they are wide enough to tell apart, and the reads in
the view's colours, order and downsampling (up to a chosen number of rows).
It is drawn on white with print colours whatever the app's theme, with
colours as hex plus fill-opacity, which vector editors read reliably,
rather than rgba(). Reads are drawn for stretches of 20 kb or less, and
where the view has them loaded; wider, the figure is coverage and variants.

### Scale

Measured on a simulated bacterial genome (5 Mb, 850,000 read pairs of 150
bases, about 50x, 0.3% sequencing errors, 2,000 SNPs), on one core of a
laptop in Node, which runs the same JavaScript and WebAssembly as the
browser (`src/ngs/scale.bench.test.ts`, run with `SEQNEXUS_BENCH=1`):

| Step | Time | Memory held |
|------|------|-------------|
| Import 1.7 million reads (stats, compressed chunks) | 29 s, read generation included | 210 MB; read set stored in 77 MB |
| minimap2 (SIMD build), extrapolated from 20,000 pairs | under a minute | |
| Store the mapping (sort, pages, coverage, candidate sites) | 28 s | 360 MB; 33 MB stored |
| Call variants (recount the 2,630 candidate sites) | 2 s | all 2,000 SNPs found |
| Find soft-clip junctions (every page) | 2 s | |
| Export BAM with index | 17 s | 42 MB file |
| Open the view; load 300 kb (100,000 reads) around a 100 kb view, its pileup and rows | under half a second | |

IndexedDB holds this comfortably (about 110 MB for reads and mapping), so
the Origin Private File System, kept in reserve for larger data, was not
needed. One step was too slow at this scale and was rewritten: the tandem
repeat search used for every indel scanned with string slices; it now
compares character codes along stretches where each base equals the one a
unit length before (one pass per unit length), 12 times faster with the
same results: a 5 Mb genome in 0.14 s, and 60,000 Nanopore-like indel sites
described in 0.5 s instead of 3.9 s on the page.

### SAM and BAM

A mapping exports as **BAM with its BAI index** (for IGV, samtools and
variant callers) or as **SAM**, sorted by position, with an `@PG` line naming
the program and its command. Both are written in JavaScript as the pages are
read, not by samtools compiled to WebAssembly: a page opened from disk cannot
load WebAssembly, and the formats are simple enough to write directly (SAMv1
specification, sections 4 and 5):

- BAM is binary records in **BGZF** blocks: gzip members of at most 64 KB that
  say their own size. Blocks are filled to 65,280 bytes so even
  incompressible data stays under the limit, and the file ends with the
  standard empty block.
- The **index** lists, for each bin of the reference (the five-level binning
  scheme), the stretches of the file holding alignments in it, merging
  stretches that follow each other, plus the linear index of the first
  alignment in each 16 kb window and the pseudo-bin with the reference's
  extent and alignment count that samtools writes.
- A CIGAR of more than 65,535 operations (an ultra-long Nanopore read) goes in
  a `CG` tag behind the placeholder `<read length>S<span>N`, as the
  specification says.
- On a circular reference a read across the origin keeps the position where it
  starts, so its alignment runs past the end of the reference, as minimap2
  writes it against the extended reference.
- Reads without qualities get `*` (in BAM, 0xFF).

Checked against samtools 1.10: `quickcheck` passes, `view -c` and `idxstats`
count every record, region queries through the index (including regions at
bin edges and at the end of the reference) return the same records as a
scan, and `samtools view` prints the BAM exactly as the SAM export.

**Import:** a SAM or BAM file (dropped or opened) becomes a mapping. Its
header names its references; each is matched to an open sequence by name,
then by a unique length, and can be changed or left out. A reference of a
different length is flagged, since the stored bases are differences from the
sequence given. The file is read as a stream (BAM's blocks inflated one at a
time), need not be sorted, and goes through the same storage as a minimap2
run, so it gets the same report, pages, coverage and sites. Alignments on a
reference left out are counted and skipped. An imported mapping has no read
set, so it cannot be run again.

---

## Melting Temperature (Tm)

Tm appears in the selection tooltip (for selections of 4-200 bp), the primer
hover card and menu, and the primer design tool.

### Selection tooltip

- **≤ 14 bp**: Wallace rule - `Tm = 2×(A+T) + 4×(G+C)`. Simple base-counting
  formula for very short oligos.
- **15-200 bp**: nearest-neighbor method (see below).
- **> 200 bp or < 4 bp**: Tm is not shown.

Default conditions: 250 nM oligo, 50 mM Na⁺. These are not user-configurable
for the selection tooltip - they use the same defaults as the primer design tool.

### Nearest-neighbor method

Uses the **SantaLucia (1998) unified nearest-neighbor model** for DNA/DNA
duplexes.

#### Parameters

Enthalpy (ΔH) and entropy (ΔS) are computed by summing contributions from
each adjacent dinucleotide step plus initiation parameters based on terminal
base pairs:

| Terminal base | ΔH_init (cal/mol) | ΔS_init (cal/mol·K) |
|---------------|------------------:|---------------------:|
| G or C        |               100 |               −2.8   |
| A or T        |              2300 |                4.1   |

The 10 unique nearest-neighbor parameters (with symmetry equivalents):

| Pair  | ΔH (cal/mol) | ΔS (cal/mol·K) |
|-------|-------------:|----------------:|
| AA/TT |        −7900 |          −22.2  |
| AT    |        −7200 |          −20.4  |
| TA    |        −7200 |          −21.3  |
| CA/TG |        −8500 |          −22.7  |
| GT/AC |        −8400 |          −22.4  |
| CT/AG |        −7800 |          −21.0  |
| GA/TC |        −8200 |          −22.2  |
| CG    |       −10600 |          −27.2  |
| GC    |        −9800 |          −24.4  |
| GG/CC |        −8000 |          −19.9  |

#### Tm calculation

```
Tm(1M) = ΔH / (ΔS + R × ln(Ct/4)) − 273.15
```

where R = 1.987 cal/(mol·K) and Ct is the total primer concentration in M.
The Ct/4 term assumes non-self-complementary oligonucleotides.

#### Salt correction

The Tm at the actual salt concentration uses the **Owczarzy et al. (2004)
monovalent cation correction**:

```
1/Tm(Na) = 1/Tm(1M) + (4.29e-5 × f_GC − 3.95e-5) × ln([Na⁺])
                     + 9.40e-6 × (ln([Na⁺]))²
```

When Mg²⁺ is provided (primer design only), the **Owczarzy (2008) divalent
correction** is used instead, with free Mg²⁺ = Mg²⁺ − dNTPs (1:1 chelation).

### Hairpin and self-dimer Tm

The primer hover card and the design workbench show the Tm of each oligo's
strongest hairpin and self-dimer (`app/src/primers/secondary.ts`). This is a
**simplified nearest-neighbor model**, not Primer3's full thermodynamic
alignment, so the numbers are shown as estimates (≈). They are calculated
for the whole oligo, tails included, under the design tool's default buffer.

What is simplified: only ungapped helices count. A hairpin stem must pair
perfectly. A dimer may contain single internal mismatches. Neither may
contain bulges or internal loops. Hairpins get no special triloop or
tetraloop bonuses.

#### Self-dimer

1. Slide the oligo antiparallel along a second copy of itself. At every
   offset, find the most stable ungapped paired stretch (ΔG37 from the NN
   tables, including single internal mismatches). Keep the stretch with the
   lowest ΔG37 overall (`bestDimer` in `structure.ts`).
2. Score that stretch as a duplex: ΔH and ΔS from the unified NN parameters,
   the internal-mismatch parameters (Allawi & SantaLucia 1997–98, Peyret
   1999) and the initiation terms, as in the duplex Tm above.
3. Both strands are the same molecule. At the Tm half of all strands are
   paired, so the equilibrium constant is 1/Ct instead of the 4/Ct used for
   two different strands:

   ```
   Tm(1M) = ΔH / (ΔS + R × ln(Ct))
   ```

4. Apply the Owczarzy (2008) salt correction to the stretch's own GC
   fraction and length.

Because the dimer is bimolecular, its Tm rises with oligo concentration.

#### Hairpin

1. Try every loop of 3 or more bases. For each one, zip the stem outward
   from the loop for as long as the bases pair perfectly (at least 3 bp).
2. Score each fold:

   ```
   ΔH = Σ ΔH(stem NN pairs) + ΔH(terminal mismatch)
   ΔS = Σ ΔS(stem NN pairs) + ΔS(terminal mismatch) − ΔG37(loop) / 310.15 K
   ```

   - **Stem pairs** use the same unified NN table as duplexes. There is no
     initiation term, because the fold is unimolecular.
   - **Terminal mismatch:** the first and last loop bases face each other
     across the closing base pair. They are scored with the terminal-mismatch
     table, for loops longer than 3 bases.
   - **Loop penalty** is treated as purely entropic, using the hairpin-loop
     ΔG37 of SantaLucia & Hicks (2004):

     | Loop (nt) | 3   | 4   | 5   | 6   | 7   | 8   | 9   | 10  | 12  | 14  | 16  | 18  | 20  | 25  | 30  |
     |-----------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
     | ΔG37 (kcal/mol) | 3.5 | 3.5 | 3.3 | 4.0 | 4.2 | 4.3 | 4.5 | 4.6 | 5.0 | 5.1 | 5.3 | 5.5 | 5.7 | 6.1 | 6.3 |

     Lengths between entries are interpolated linearly. Beyond 30 nt, the
     penalty grows as ΔG(30) + 2.44 × R × T × ln(n / 30).

3. A hairpin melts where ΔG = 0, independent of concentration:

   ```
   Tm(1M) = ΔH / ΔS
   ```

   It is then salt-corrected with the Owczarzy (2008) formula, using the
   stem as the helix. That formula was fitted on duplexes, so this step is
   an approximation.

4. The fold with the highest Tm is reported.

#### Grading

A structure is graded against the Tm at which the primer itself anneals
(the annealed-part Tm for a tailed primer):

| Grade | Structure Tm |
|-------|--------------|
| good (green) | ≤ annealing Tm − 15 °C, or no structure |
| ok (amber)   | between annealing Tm − 15 °C and − 5 °C |
| poor (red)   | > annealing Tm − 5 °C |

A structure that pairs the oligo's 3' end is graded one step worse, because
a polymerase can extend it into primer-dimer or self-primed product.

For probes, the card also checks the TaqMan rules:
- **5' base:** a G at the 5' end quenches the reporter dye.
- **Tm margin:** the probe's Tm minus the higher Tm of the nearest flanking
  primer pair (within 2 kb). ≥ 6 °C is good, 3–6 °C is ok, less is poor.

---

## Restriction Enzyme Database

The enzyme database is auto-generated from **REBASE** (Roberts et al.) using
`scripts/build-enzyme-db.ts`. The current build contains 546 enzymes with:

- Recognition sequences (IUPAC ambiguity codes)
- Cut positions on both strands
- Overhang type (blunt, 5' overhang, 3' overhang)
- Commercial supplier availability (NEB, Thermo, etc.)
- Isoschizomer grouping
- Methylation sensitivity (dam, dcm, CpG)
- Optimal temperature and heat inactivation data

The enzyme finder runs in a Web Worker. It expands IUPAC ambiguity codes into
all possible concrete sequences and scans both strands of the target sequence.
Results are grouped by isoschizomer family on the plasmid map to reduce visual
clutter.

---

## File Format Support

| Format | Read | Write | Notes |
|--------|------|-------|-------|
| GenBank (.gb, .gbk) | Yes | Yes | Streaming parser for large files (>1 MB). Handles multi-record files. |
| FASTA (.fasta, .fa) | Yes | Yes | Multi-sequence support. |
| SnapGene (.dna) | Yes | Yes | Binary TLV format. Handles sequence, features, primers, topology, methylation. |
| Geneious (.geneious) | Yes | - | ZIP-compressed XML. Extracts sequence, topology, and features. |
| AB1 (.ab1) | Yes | - | Sanger chromatogram traces with quality scores. |
| SCF (.scf) | Yes | - | Sanger chromatogram traces. |
| GFF3 (.gff, .gff3) | Yes | - | Feature annotations with embedded FASTA. |
| BAM (.bam, .bai) | Yes | Yes | Read alignments, imported as a mapping onto open sequences; written with its index. See [SAM and BAM](#sam-and-bam). |
| SAM (.sam) | Yes | Yes | The same as text. |
| Clustal (.aln) | - | Yes | Alignment export. |
| PDF (.pdf) | - | Yes | The sequence as the text view draws it, with an optional map page and feature and enzyme tables. See [PDF Export](#pdf-export). |
| CSV | - | Yes | Feature table export. |
| Plain text | Yes | Yes | Raw sequence. |

SnapGene and Geneious parsers are reverse-engineered from the binary/XML
formats. SnapGene uses a TLV (type-length-value) packet structure; Geneious
uses ZIP-compressed Java XMLSerializable format.

---

## Primers

### Primers as oligos

A primer is stored as the oligo you would order: its full 5'→3' sequence,
tails included (`app/src/primers/oligo.ts`). Where it binds is never stored.
It is recomputed from the sequence (`binding.ts`): 10-mer seeds find candidate
diagonals on both strands in one pass over the template, and the best-scoring
run of paired bases along each diagonal is the annealed part. Whatever lies
outside that run is a tail, so overhangs (restriction sites, homology arms,
promoters) need no special handling. Mismatches inside the run are allowed;
a primer only counts as bound where its 3' end pairs, a probe anywhere.

Tailed primers have two Tms, both shown: the annealed part (first cycles)
and the whole oligo (once the tail is copied into the product). SnapGene
files keep the full sequence; GenBank writes one `primer_bind` feature per
binding site with the oligo in `/primer_sequence`.

Hovering a primer or probe on the sequence or map shows its Tm, GC, length,
hairpin and self-dimer Tm with a traffic-light grade (see "Hairpin and
self-dimer Tm" above), the restriction sites in its 5' tail and, for probes,
the TaqMan checks. Tap Shift while any hover card is open to pin it, so its
text can be selected; Esc or a click elsewhere unpins it. Right-clicking
opens a compact menu (summary line, then actions, with Copy, New Primer and
Origin in submenus). It works with the arrow keys and scrolls on short
screens.

### Design workbench

The Design view of the sidebar's Primers tab, with five tasks:

- **PCR / qPCR** - a pair (and optionally a TaqMan probe) around a target
- **Cloning** - binding parts that start exactly at the insert's ends, behind
  restriction-site tails (with padding, and a warning if the enzyme also cuts
  the insert) or homology arms read off a vector (Gibson / In-Fusion)
- **Mutagenesis** - substitutions, insertions and deletions, back-to-back
  (Q5 SDM style) or overlapping (QuikChange rule, Tm ≥ 78 °C); the mutant
  can be opened as a new sequence
- **Sequencing** - primers tiled so reads overlap across a region, each
  binding the template exactly once
- **Check a primer** - where an oligo binds in every open sequence

Any forward/reverse pick can be run as an in-silico PCR (`primers/pcr.ts`):
the product opens as a new sequence with both 5' tails built in and the
template's features carried over, ready for the cloning dialog.

### Primer library

Oligos you keep across sequences, listed in the explorer's **Oligos** group
(folders, tags, notes, stars and search as for any item). A library oligo
that binds the open sequence carries a badge; opening one shows where it
binds in every open sequence. When you open a sequence that library primers
bind, a notice offers them, and the Primers tab lists them with Add buttons.
Library oligos are copied onto a sequence, not linked, so editing one leaves
the other alone.

Oligos come in by paste or file (CSV/TSV with Name and Sequence columns,
"name sequence" lines, bare sequences or FASTA; unreadable lines are
listed) and go out as CSV, FASTA or a tab-separated order sheet (Name,
Sequence, Scale, Purification, as vendor bulk-entry forms take them). The
library is saved with the session and included in session export.

In the PCR task the target follows the selection; regions can be excluded. Each run returns the best pairs and the
whole candidate landscape (best candidate per 3' end), drawn as a track so
either side can be picked on its own. Picks are oligo sequences: they can be
trimmed or extended along the template, are drawn on the sequence and map as
dashed previews, and are re-scored as a pair live. Presets set the ranges;
buffer presets set the salt and oligo concentrations for the Tm model.

### Overview of the search

1. **Enumerate candidates** - slide windows of varying length upstream (forward)
   and downstream (reverse) of the target region, skipping excluded regions
2. **Score each candidate** - evaluate against thermodynamic and structural
   criteria, producing a weighted penalty with a per-term breakdown
3. **Pair candidates** - combine the best 200 of each side, filter by product
   size, and add pair-level penalties (Tm matching, cross-dimer)
4. **Rank and return** - sort pairs by total penalty; return the top pairs and
   the thinned candidate lists

A target longer than the maximum product is reported, not worked around by
changing the settings.

### Individual Primer Scoring

Each candidate primer is evaluated on multiple criteria. Hard constraints
reject the primer entirely; soft penalties contribute to a weighted score.

#### Hard Constraints (reject if violated)

| Criterion | Default range |
|-----------|---------------|
| Tm | 57-63 °C |
| GC content | 40-60% |
| Homopolymer run | ≤ 4 bases |

#### Soft Penalties (weighted score)

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Tm deviation | 1.0 per °C | Distance from optimal Tm (default 60°C) |
| Length deviation | 0.5 per base | Distance from optimal length (default 20 bp) |
| GC deviation | 0.1 per % | Distance from 50% GC |
| No GC clamp | +1.0 | No G or C in the last 2 bases at the 3' end |
| 3' stability (too stable) | +2.0 | ΔG₃₇ of last 5 bases < −9.0 kcal/mol |
| 3' stability (too weak) | +1.0 | ΔG₃₇ of last 5 bases > −5.0 kcal/mol |
| Self-complementarity ≥ 8 bp | +3.0 | Significant self-dimer potential |
| Self-complementarity ≥ 5 bp | +1.0 | Moderate self-dimer potential |
| 3' end self-dimer ≥ 4 bp | +4.0 | 3' end can pair with itself (blocks extension) |
| 3' end self-dimer ≥ 3 bp | +1.5 | Moderate 3' dimer risk |
| Hairpin stem ≥ 4 bp | +2.0 | Can fold into a hairpin |
| Hairpin stem ≥ 3 bp | +0.5 | Weak hairpin potential |
| Homopolymer run ≥ 3 | +0.5 per extra base | Soft penalty for long runs |

### Pair Scoring

```
pair_penalty = fwd_penalty + rev_penalty
             + |Tm_fwd − Tm_rev| × 1.0        (Tm matching)
             + |product_size − optimal| × 0.01  (product size)
             + cross_dimer_penalty               (3' cross-dimer)
```

### Thermodynamics

Tm uses the unified nearest-neighbour parameters with the Owczarzy (2008)
salt correction (monovalent and Mg²⁺, with Mg²⁺ bound by dNTPs), and is
validated against Biopython's `Tm_NN` reference values. A primer's Tm at a
binding site is taken against the template bases it faces: internal
mismatches use the Allawi & SantaLucia / Peyret tables and the first tail
base the terminal-mismatch table (tables from Biopython, BSD 3-Clause; see
`primers/thermo/tables.ts`). Dimer ΔG allows single internal mismatches;
loops and bulges are not modelled. An off-target scan reports weaker sites
where a primer's last 8 bases pair perfectly.

The cross-dimer check considers the 3' end of both primers. (Before the
workbench it checked the second primer's 5' end by mistake, so a dimer on the
reverse primer's 3' end went unpenalised.)

### User-Configurable Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| Tm range | 57-63 °C | Min/max acceptable Tm |
| Optimal Tm | 60 °C | Target Tm for penalty calculation |
| Primer length | 18-25 bp | Min/max primer length |
| Product size | 150-1000 bp | Min/max amplicon size |
| GC content | 40-60% | Min/max GC of each primer |
| Na⁺ concentration | 50 mM | Monovalent cation concentration for Tm calculation |
| Mg²⁺ / dNTPs | 1.5 / 0.8 mM | Divalent correction, free Mg²⁺ = Mg²⁺ − dNTPs |
| Primer concentration | 250 nM | Oligo concentration for Tm calculation |

Presets: Standard PCR, GC-rich template, Long amplicon (1-5 kb) and qPCR with
probe (70-150 bp, probe Tm 68-72 °C).

---

## Codon Optimization

Rewrites a coding region for expression in another host: pick the codons the
host translates well, keep the restriction sites your cloning strategy needs
free, and stay inside what a synthesis vendor will accept.

The protein is the invariant. Whatever the settings, the optimizer re-translates
its own output and throws if it does not match the input protein, rather than
returning a sequence that codes for something else.

### Targets

| Target | What it optimizes |
|--------|-------------------|
| Selection | The selected bases, read in frame from the first one |
| Coding features | Every CDS-like feature, individually checkable |
| Whole sequence | Frame 1 from position 0 |

A feature on the minus strand is read and written back in its own orientation,
`/codon_start` is honoured, and an origin-spanning feature on a circular
sequence is followed round the join. Each region is reduced to a coding-strand
string plus a map from every base back to its genomic index, so those three
cases share one code path rather than three.

Two CDSs that share bases cannot both be optimized: rewriting one changes the
other's reading frame. The first wins and the overlap is reported.

### Genetic codes

19 NCBI translation tables (1-6, 9-14, 16, 21-26), stored as diffs against the
standard code. This decides which codons are synonymous, so a mitochondrial
gene is not truncated at a TGA that codes for tryptophan in its own code.
`utils/codon.ts` re-exports table 1, so the app has one copy of the standard
code rather than two that can drift.

### Codon usage tables

| Source | Notes |
|--------|-------|
| Built-in | E. coli K-12, B. subtilis, S. cerevisiae, P. pastoris, H. sapiens, CHO, Sf9, A. thaliana |
| Imported | EMBOSS cusp (.cusp) and GCG CodonFrequency (.cod). Persisted in IndexedDB. |

The built-in tables are written from published genome-wide averages and are
flagged `approximate` in the data and in the UI: the rankings and rare-codon
calls are right, the low-order digits may differ from a particular reference.
Import a table when the exact figures matter.

Both formats are whitespace-aligned tables with a header naming their columns,
and they order those columns differently:

```
cusp    #Codon AA Fraction Frequency Number
GCG      AmAcid Codon Number /1000 Fraction ..
```

So the header is read and the columns taken by name, preferring Fraction, then
the per-thousand frequency, then the raw count. Within a family all three are
proportional, so the choice is about robustness rather than correctness: some
GCG tables ship with the count column zeroed. Anything else with one codon and
one number per line is still accepted as a plain list, which covers a Kazusa
block or a quick paste.

A family with no usage stays at zero rather than being spread evenly, so
`unusableResidues` can report an amino acid the table cannot encode instead of
the optimizer silently inventing a preference.

### What gets changed

- **Every codon**, choosing either the most frequent synonym or one sampled
  from the host distribution. Sampling is seeded, so a run reproduces exactly,
  and it avoids the long identical runs that "most frequent" produces.
- **Rare codons only**, above a configurable within-family threshold.

### Constraints

| Constraint | Detail |
|------------|--------|
| Forbidden motifs | Enzyme groups, individual enzymes, custom IUPAC motifs, and presets for Type IIS sites, internal Shine-Dalgarno, polyA signals, cryptic splice sites and E. coli promoter boxes. Checked on both strands. |
| Homopolymers | Separate limits for A/T and G/C runs |
| GC content | Global bounds plus a sliding local window |
| Repeats | Direct repeats over N bp |
| Hairpins | Inverted repeats with a stem over N bp within a loop distance |
| CpG | Avoided when asked, for mammalian constructs |
| Locked codons | Start, stop, the first N codons, and anything under a protected non-coding feature |

Constraints are checked across the region boundary into the untouched flanks,
so a site that would straddle the edge is still avoided.

### Algorithm

Greedy left to right with bounded backtracking. Each codon takes the best
synonym that leaves the window it can affect free of violations; when nothing
fits, the walk steps back and tries the previous codon's next choice. Past the
step budget it keeps the best remaining option and reports the violation rather
than failing the whole run.

A full dynamic program is not an option here: the state would have to be the
last K bases, where K is the longest constraint window, so the table is 4^K
wide.

Direct repeats are the one constraint that is not local, since the other copy
can be anywhere. They are tracked in an index built as the walk proceeds and
rolled back on backtracking, which keeps the run linear where re-scanning per
codon would make it quadratic.

Optimization runs on the main thread. A few thousand codons take milliseconds,
and the dialog previews on a 200 ms debounce; past 60 kb of target it waits for
an explicit run instead.

### Metrics

CAI, GC, GC3, rare codon count and the longest A/T and G/C runs, before and
after. CAI is the geometric mean of relative adaptiveness over the region,
skipping single-codon families (Met, Trp), which carry no information about
adaptation and would only drag every score toward 1.

### Applying

Applying is an equal-length substitution through `substituteBasesInPlace`: one
undo entry, and no annotation moves, because no coordinate changes. This is why
it does not reuse `replaceBases`, which deletes then inserts, and would drop
the very CDS being optimized (an annotation fully inside a deleted range is
removed). The result can also be opened as a new sequence, leaving the original
untouched.

---

## PDF Export

File > Export PDF (Ctrl+P) writes the sequence as the text view draws it:
base colours, complement, feature bars, primers, ORFs, cut sites and
translations, laid out on A4 pages. The bases to export are the whole
sequence, the rows in view, the selection or a typed range (through the
origin on a circular sequence). Optional extras: a plasmid map page for
circular sequences, a feature table and a restriction site table (both
limited to the exported range), and a header with the title, length and
page numbers.

### One painter, two outputs

The row drawing lives in one function (`components/sequence-paint.ts`) that
the screen and the export both call. For the PDF it draws into `PdfCanvas`
(`pdf/canvas.ts`), an object with the subset of the Canvas 2D API the
painters use (paths, arcs, rectangles, text, dashes, alpha, save/restore,
transforms) that writes PDF operators instead of pixels. The plasmid map's
renderer draws into the same object. The export therefore cannot drift from
the view: a change to how features or translations are drawn reaches both.

Rejected alternatives:
- **Printing through the browser** (as the alignment figure does) gives no
  control over page breaks, so a line and its features can split across
  pages, and the user has to go through the print dialog every time.
- **Rasterising each page** would be exact but not searchable, large, and
  blurry when zoomed.
- **A PDF library** would add weight to a single-file app for what is a
  small amount of format: the writer (`pdf/document.ts`) is a page tree,
  Flate-compressed content streams (fflate, already used for Geneious
  files) and an xref table.

### Layout

Rows are laid out in the view's own pixel units and scaled to the page
width, so letters, labels and bars keep their on-screen proportions. At
letters zoom the line length is the screen's by default, or a fixed 50 to
150 bases; the row is as wide as that many cells at the current zoom's cell
width, and the dialog reports the resulting letter size in points (under
5 pt it suggests fewer bases or landscape). Below letters zoom the overview
prints as on screen, scaled so its labels land near 7 pt. A line is never
split across pages. The map page and the tables follow the same rule: a
table's heading, header and first row stay together, and the header row
repeats on each new page.

Feature lanes are not capped at the screen's four: paper cannot be hovered
to reveal "+N more", so print shows every lane up to 16.

### Fonts and text

The PDF uses three of the standard 14 fonts (Helvetica, Helvetica-Bold,
Courier), which every reader provides, so nothing is embedded. Their glyph
widths are fixed by the Adobe font metrics, which lets the export measure
labels exactly without a canvas; the painter is handed these metrics, so
label fitting and enzyme label tiers are computed for the glyphs that will
print. Monospaced text prints in Courier, the rest in Helvetica.

The sequence letters of a line are written as one text run with character
spacing set to the cell width, and tagged with `/ActualText` so copy and
search read "ACGT" rather than "A C G T" (readers that honour it, such as
Acrobat and Chrome's viewer; pdf.js extracts the spaced form).

### Colours

The export always uses the light theme's colours on white, read from the
theme tokens through a hidden probe element rather than copied. Dark themes
are made for a dark canvas (pale text, bright bases) and would print as
faint marks on white. Selection and search highlights are off by default.

### Limits

- The standard fonts use WinAnsiEncoding (Latin-1 plus typographic marks).
  Greek letters in names are spelled out ("beta-lactamase"); other
  characters outside the set print as "?".
- Exports over 1,500 pages are refused; choose a smaller range or zoom out.
- Writing runs on the main thread in batches, so a long export keeps the
  dialog responsive and can be stopped.

---

## References

- SantaLucia J Jr. (1998) "A unified view of polymer, dumbbell, and
  oligonucleotide DNA nearest-neighbor thermodynamics."
  *Proc Natl Acad Sci USA* 95:1460-1465.

- Owczarzy R et al. (2004) "Effects of sodium ions on DNA duplex oligomers:
  improved predictions of melting temperatures."
  *Biochemistry* 43:3537-3554.

- Owczarzy R et al. (2008) "Predicting stability of DNA duplexes in solutions
  containing magnesium and monovalent cations."
  *Biochemistry* 47:5336-5353.

- Needleman SB, Wunsch CD. (1970) "A general method applicable to the search
  for similarities in the amino acid sequence of two proteins."
  *J Mol Biol* 48:443-453.

- Smith TF, Waterman MS. (1981) "Identification of common molecular
  subsequences." *J Mol Biol* 147:195-197.

- Hirschberg DS. (1975) "A linear space algorithm for computing maximal
  common subsequences." *Commun ACM* 18:341-343.

- Henikoff S, Henikoff JG. (1992) "Amino acid substitution matrices from
  protein blocks." *Proc Natl Acad Sci USA* 89:10915-10919.

- Roberts RJ et al. (2015) "REBASE - a database for DNA restriction and
  modification." *Nucleic Acids Res* 43:D298-D299.

- Untergasser A et al. (2012) "Primer3 - new capabilities and interfaces."
  *Nucleic Acids Res* 40(15):e115.

- Sharp PM, Li WH. (1987) "The codon adaptation index - a measure of directional
  synonymous codon usage bias, and its potential applications."
  *Nucleic Acids Res* 15:1281-1295.

- Nakamura Y, Gojobori T, Ikemura T. (2000) "Codon usage tabulated from
  international DNA sequence databases: status for the year 2000."
  *Nucleic Acids Res* 28:292.

- Cornish-Bowden A. (1985) "Nomenclature for incompletely specified bases in
  nucleic acid sequences: recommendations 1984."
  *Nucleic Acids Res* 13:3021-3030.

- IUPAC-IUB Joint Commission on Biochemical Nomenclature. (1984)
  "Nomenclature and symbolism for amino acids and peptides."
  *Eur J Biochem* 138:9-37.

- Elzanowski A, Ostell J. "The Genetic Codes." NCBI Taxonomy.
  https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi

- Hoover DM, Lubkowski J. (2002) "DNAWorks: an automated method for designing
  oligonucleotides for PCR-based gene synthesis."
  *Nucleic Acids Res* 30(10):e43.

- Pevzner PA, Tang H, Waterman MS. (2001) "An Eulerian path approach to DNA
  fragment assembly." *Proc Natl Acad Sci USA* 98:9748-9753.

- Zerbino DR, Birney E. (2008) "Velvet: algorithms for de novo short read
  assembly using de Bruijn graphs." *Genome Res* 18:821-829.

- Bankevich A, Nurk S, Antipov D, et al. (2012) "SPAdes: a new genome
  assembly algorithm and its applications to single-cell sequencing."
  *J Comput Biol* 19:455-477.

- Wick RR, Judd LM, Gorrie CL, Holt KE. (2017) "Unicycler: resolving
  bacterial genome assemblies from short and long sequencing reads."
  *PLoS Comput Biol* 13:e1005595.

- Wick RR, Schultz MB, Zobel J, Holt KE. (2015) "Bandage: interactive
  visualization of de novo genome assemblies." *Bioinformatics*
  31:3350-3352.

- Fruchterman TMJ, Reingold EM. (1991) "Graph drawing by force-directed
  placement." *Softw Pract Exp* 21:1129-1164.

- GFA Format Specification Working Group. "Graphical Fragment Assembly (GFA)
  format specification, version 1." https://github.com/GFA-spec/GFA-spec

- Laetsch DR, Blaxter ML. (2017) "BlobTools: interrogation of genome
  assemblies." *F1000Research* 6:1287.

- Melsted P, Pritchard JK. (2011) "Efficient counting of k-mers in DNA
  sequences using a Bloom filter." *BMC Bioinformatics* 12:333.

- Putze F, Sanders P, Singler J. (2007) "Cache-, hash- and space-efficient
  Bloom filters." *Proc 6th Workshop on Experimental Algorithms (WEA)*,
  LNCS 4525:108-121. (Blocked Bloom filters.)

- Kokot M, Dlugosz M, Deorowicz S. (2017) "KMC 3: counting and manipulating
  k-mer statistics." *Bioinformatics* 33:2759-2761. (Minimizer-partitioned
  counting, considered and not used.)

- Simpson JT, Wong K, Jackman SD, et al. (2009) "ABySS: a parallel assembler
  for short read sequence data." *Genome Res* 19:1117-1123. (Joining contigs
  with read pairs.)

- Li H. (2016) "Minimap and miniasm: fast mapping and de novo assembly for
  noisy long sequences." *Bioinformatics* 32:2103-2110. (The string graph,
  its overlap classes and cleaning steps.)

- Myers EW. (2005) "The fragment assembly string graph." *Bioinformatics*
  21 Suppl 2:ii79-ii85. (Transitive reduction.)

- Kolmogorov M, Yuan J, Lin Y, Pevzner PA. (2019) "Assembly of long,
  error-prone reads using repeat graphs." *Nat Biotechnol* 37:540-546.
  (Flye; starting from the longest reads.)

- Koren S, Walenz BP, Berlin K, et al. (2017) "Canu: scalable and accurate
  long-read assembly via adaptive k-mer weighting and repeat separation."
  *Genome Res* 27:722-736.

- Walker BJ, Abeel T, Shea T, et al. (2014) "Pilon: an integrated tool for
  comprehensive microbial variant detection and genome assembly
  improvement." *PLoS One* 9:e112963.

- Wick RR, Holt KE. (2022) "Polypolish: short-read polishing of long-read
  bacterial genome assemblies." *PLoS Comput Biol* 18:e1009802. (Short-read
  polishing by majority with a least depth.)

- Vurture GW, Sedlazeck FJ, Nattestad M, et al. (2017) "GenomeScope: fast
  reference-free genome profiling from short reads." *Bioinformatics*
  33:2202-2204.

- Irber L, Brooks PT, Reiter T, et al. (2022) "Lightweight compositional
  analysis of metagenomes with FracMinHash and minimum metagenome covers."
  *bioRxiv* 2022.01.11.475838.

- Oxford Nanopore Technologies. medaka: sequence correction provided by ONT
  Research. https://github.com/nanoporetech/medaka (the model-based polisher
  the de novo contigs' homopolymer limit refers to).

- ISO 32000-1:2008. *Document management - Portable document format -
  Part 1: PDF 1.7.* Standard Type 1 fonts (9.6.2.2) and replacement text,
  `/ActualText` (14.9.4). Glyph widths from the Adobe Core 14 AFM files.

- Ewing B, Green P. (1998) "Base-calling of automated sequencer traces using
  phred. II. Error probabilities." *Genome Res* 8:186-194.

- Cock PJA, Fields CJ, Goto N, Heuer ML, Rice PM. (2010) "The Sanger FASTQ
  file format for sequences with quality scores, and the Solexa/Illumina
  FASTQ variants." *Nucleic Acids Res* 38:1767-1771.

- Chen S, Zhou Y, Chen Y, Gu J. (2018) "fastp: an ultra-fast all-in-one
  FASTQ preprocessor." *Bioinformatics* 34:i884-i890.

- Andrews S. (2010) "FastQC: a quality control tool for high throughput
  sequence data." Babraham Bioinformatics.
  https://www.bioinformatics.babraham.ac.uk/projects/fastqc/

- Li H. (2018) "Minimap2: pairwise alignment for nucleotide sequences."
  *Bioinformatics* 34:3094-3100.

- Li H, Handsaker B, Wysoker A, et al. (2009) "The Sequence Alignment/Map
  format and SAMtools." *Bioinformatics* 25:2078-2079. (The 4-bit base code,
  BAM and its binning index.)

- The SAM/BAM Format Specification Working Group. "Sequence Alignment/Map
  Format Specification" (SAMv1), sections 4 (BGZF, BAM) and 5 (BAI).
  https://samtools.github.io/hts-specs/SAMv1.pdf

- Danecek P, Bonfield JK, Liddle J, et al. (2021) "Twelve years of SAMtools
  and BCFtools." *GigaScience* 10:giab008. (`mpileup`, whose default base
  quality threshold of 13 the candidate sites follow.)

- Robinson JT, Thorvaldsdóttir H, Winckler W, et al. (2011) "Integrative
  genomics viewer." *Nature Biotechnology* 29:24-26; and Thorvaldsdóttir H,
  Robinson JT, Mesirov JP (2013) "Integrative Genomics Viewer (IGV):
  high-performance genomics data visualization and exploration." *Briefings in
  Bioinformatics* 14:178-192. (The mapping view's downsampling, insert-size and
  pair-orientation colours, base-quality shading and allele-fraction defaults.)

- Grubaugh ND, Gangavarapu K, Quick J, et al. (2019) "An amplicon-based
  sequencing framework for accurately measuring intrahost virus diversity
  using PrimalSeq and iVar." *Genome Biology* 20:8. (The consensus: alleles
  taken until they reach a threshold, IUPAC codes, a minimum depth; primer
  clipping at the 5' end of reads, as ivar trim does.)

- The Global Alliance for Genomics and Health. "The Variant Call Format
  (VCF) Version 4.2 Specification." https://samtools.github.io/hts-specs/VCFv4.2.pdf

- Le Cam L (1960) "An approximation theorem for the Poisson binomial
  distribution." *Pacific Journal of Mathematics* 10:1181-1197.

## License

Copyright (C) 2026 Christopher Acatay

SeqNexus is free software: you can redistribute it and/or modify it under the
terms of the GNU Affero General Public License, version 3, as published by the
Free Software Foundation. See [LICENSE](LICENSE) for the full text.

In short: you may use, study, modify and share SeqNexus. If you distribute a
modified version, or run one as a service that other people use over a network,
you must make its complete source code available to those users under the same
license.

Figures, sequence files and other output you create with SeqNexus are yours and
are not covered by this license; use them freely in publications, presentations,
theses and commercial work.

SeqNexus is distributed WITHOUT ANY WARRANTY; without even the implied warranty
of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
