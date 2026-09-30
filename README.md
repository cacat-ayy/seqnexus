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
├── wasm/                    vendored tbfast build (not currently wired up)
└── app/                     Vite + React source for the editor
    ├── app.html                 Vite entry — builds to ../app.html
    └── src/
```

## Quick Start

```bash
cd app
npm install
npm run dev           # dev server on :8000
npm test              # 900+ tests
npx tsc -b --noEmit   # type check
npm run build         # tsc -b && vite build
```

The dev server mirrors the deployed site: `/` serves the landing page and
`/app.html` serves the editor built live from `src/`.

## Publishing

`npm run build` writes straight into the repo root — `app.html` plus the six
hashed `*.worker-*.js` chunks — so publishing is just committing the result.
Both are build output and both must be committed: `app.html` loads the workers
by relative URL, so a missing chunk silently breaks ORF finding, enzyme
scanning, primer design, alignment, annotation matching, and GenBank parsing.

Stale worker chunks from a previous build are pruned automatically at the start
of each build.

> `build.outDir` is the repo root, so `emptyOutDir` is pinned to `false` in
> `app/vite.config.ts`. Do not turn it on — it would delete the repository.

## Tech Stack

- Vite 5 + React 18 + TypeScript 5.6
- Zustand for state management (multi-document with tabs)
- Canvas 2D rendering with virtualized rows
- Web Workers for ORF finding, enzyme scanning, primer design, annotation matching
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
- **Find/replace** with regex support
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
- **NCBI BLAST** - search NCBI databases directly from the editor
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
- `alignment.worker` - pairwise and multiple sequence alignment

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

## Sequence Alignment

### Algorithms

SeqNexus implements three alignment algorithms, all in pure TypeScript with
no external dependencies:

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
| Clustal (.aln) | - | Yes | Alignment export. |
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

- Elzanowski A, Ostell J. "The Genetic Codes." NCBI Taxonomy.
  https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi

- Hoover DM, Lubkowski J. (2002) "DNAWorks: an automated method for designing
  oligonucleotides for PCR-based gene synthesis."
  *Nucleic Acids Res* 30(10):e43.
