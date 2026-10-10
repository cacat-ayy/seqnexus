# SeqNexus

A browser-based molecular biology sequence editor. Renders DNA sequences using
Canvas 2D with annotation display, selection, inline editing, and zoom. Designed
for genome-scale sequences; tested up to around 5 Mb, which is a limit of what
has been exercised rather than of the data structures. Builds to a single
self-contained HTML file.

## Contents

- [Repo Layout](#repo-layout)
- [Quick Start](#quick-start)
- [Publishing](#publishing)
- [Tech Stack](#tech-stack)
- [Overview](#overview)
- [Architecture](#architecture)
  - [Data Structures](#data-structures)
  - [Rendering](#rendering)
  - [Web Workers](#web-workers)
- [Storage & Persistence](#storage--persistence)
  - [Why IndexedDB + localStorage](#why-indexeddb--localstorage)
  - [Persistence format](#persistence-format)
  - [Orphan cleanup](#orphan-cleanup)
  - [Auto-save](#auto-save)
- [Working in the Editor](#working-in-the-editor)
  - [The explorer](#the-explorer)
  - [Views](#views)
  - [The command palette](#the-command-palette)
  - [Undo](#undo)
  - [Themes](#themes)
  - [Keyboard shortcuts](#keyboard-shortcuts)
  - [Session files and backups](#session-files-and-backups)
- [Plasmid Map](#plasmid-map)
  - [One scene, two renderers](#one-scene-two-renderers)
  - [Styles and labels](#styles-and-labels)
  - [Rings and tracks](#rings-and-tracks)
  - [Working on the map](#working-on-the-map)
- [Selections](#selections)
  - [Several ranges](#several-ranges)
  - [Joined translation](#joined-translation)
  - [Copying, deleting, typing](#copying-deleting-typing)
- [Annotations](#annotations)
  - [Joined features](#joined-features)
  - [A gene and its CDS](#a-gene-and-its-cds)
  - [The source feature](#the-source-feature)
- [Feature Panel](#feature-panel)
  - [Filter](#filter)
  - [Following the sequence](#following-the-sequence)
  - [Keyboard](#keyboard)
  - [Editing](#editing)
  - [CDS checks](#cds-checks)
- [Feature Library and Auto-annotation](#feature-library-and-auto-annotation)
  - [The built-in library](#the-built-in-library)
  - [The scan](#the-scan)
  - [Limits](#limits)
- [Find](#find)
  - [Nucleotide search](#nucleotide-search)
  - [Protein search](#protein-search)
  - [Limits](#limits-1)
  - [Replace](#replace)
  - [Display](#display)
- [ORF Finder](#orf-finder)
  - [ORFs as features](#orfs-as-features)
- [Proteins](#proteins)
  - [Alphabet](#alphabet)
  - [What a protein does not have](#what-a-protein-does-not-have)
  - [Import and export](#import-and-export)
  - [Residue colours](#residue-colours)
  - [Find](#find-1)
  - [Numbering](#numbering)
  - [Properties](#properties)
  - [DNA and protein](#dna-and-protein)
  - [Back-translation](#back-translation)
  - [Auto-annotation](#auto-annotation)
  - [Alignment, BLAST and find](#alignment-blast-and-find)
  - [Graph tracks](#graph-tracks)
  - [Motifs and sites](#motifs-and-sites)
  - [UniProt and NCBI protein import](#uniprot-and-ncbi-protein-import)
  - [Disulfide bonds](#disulfide-bonds)
  - [Variants](#variants)
  - [Domain map](#domain-map)
  - [Proteolysis](#proteolysis)
  - [SDS-PAGE](#sds-page)
  - [Secondary structure](#secondary-structure)
  - [3D structure](#3d-structure)
  - [Limits](#limits-2)
- [Melting Temperature (Tm)](#melting-temperature-tm)
  - [Selection tooltip](#selection-tooltip)
  - [Nearest-neighbor method](#nearest-neighbor-method)
  - [Hairpin and self-dimer Tm](#hairpin-and-self-dimer-tm)
- [Restriction Enzyme Database](#restriction-enzyme-database)
  - [How sites are drawn in the sequence view](#how-sites-are-drawn-in-the-sequence-view)
  - [Saved enzyme sets](#saved-enzyme-sets)
- [Virtual Gel](#virtual-gel)
  - [Lanes](#lanes)
  - [Migration model](#migration-model)
  - [Bands](#bands)
  - [Ladders](#ladders)
  - [Looks and export](#looks-and-export)
  - [Diagnostic digest designer](#diagnostic-digest-designer)
- [Primers](#primers)
  - [Primers as oligos](#primers-as-oligos)
  - [Design workbench](#design-workbench)
  - [Primer library](#primer-library)
  - [Overview of the search](#overview-of-the-search)
  - [Individual Primer Scoring](#individual-primer-scoring)
  - [Pair Scoring](#pair-scoring)
  - [Thermodynamics](#thermodynamics)
  - [User-Configurable Parameters](#user-configurable-parameters)
- [Codon Optimization](#codon-optimization)
  - [Targets](#targets)
  - [Genetic codes](#genetic-codes)
  - [Codon usage tables](#codon-usage-tables)
  - [What gets changed](#what-gets-changed)
  - [Constraints](#constraints)
  - [Algorithm](#algorithm)
  - [Metrics](#metrics)
  - [Applying](#applying)
- [Sequence Alignment](#sequence-alignment)
  - [Engines](#engines)
  - [The alignment viewer](#the-alignment-viewer)
  - [Editing an alignment](#editing-an-alignment)
  - [Adding sequences and realigning](#adding-sequences-and-realigning)
  - [Alignment formats](#alignment-formats)
  - [Figures](#figures)
  - [Built-in pairwise algorithms](#built-in-pairwise-algorithms)
  - [Scoring](#scoring)
  - [Size limits](#size-limits)
- [BLAST](#blast)
- [CRISPR Guide Design](#crispr-guide-design)
  - [Nucleases are data](#nucleases-are-data)
  - [Finding sites](#finding-sites)
  - [Scoring, in three separate columns](#scoring-in-three-separate-columns)
  - [Off-target search](#off-target-search)
  - [What the views draw](#what-the-views-draw)
  - [Designing for a goal](#designing-for-a-goal)
  - [Prime editing](#prime-editing)
  - [Ordering](#ordering)
  - [Screening](#screening)
  - [Reading the result](#reading-the-result)
  - [The guide library](#the-guide-library)
  - [Keeping a guide](#keeping-a-guide)
  - [Limits](#limits-3)
- [Cloning](#cloning)
  - [Each part is cut on its own](#each-part-is-cut-on-its-own)
  - [Which sites a map offers](#which-sites-a-map-offers)
  - [Which piece goes into the reaction](#which-piece-goes-into-the-reaction)
  - [The reaction strip](#the-reaction-strip)
  - [The product keeps the vector's numbering](#the-product-keeps-the-vectors-numbering)
  - [Ends and ligation](#ends-and-ligation)
  - [Seamless assembly (HiFi, Gibson, In-Fusion, SLIC)](#seamless-assembly-hifi-gibson-in-fusion-slic)
  - [Golden Gate](#golden-gate)
  - [Overhang fidelity](#overhang-fidelity)
  - [Gateway](#gateway)
  - [TOPO](#topo)
  - [Methylation](#methylation)
  - [What the reaction gives](#what-the-reaction-gives)
  - [Junctions](#junctions)
  - [Oligos to order](#oligos-to-order)
  - [Verifying the construct](#verifying-the-construct)
  - [Libraries](#libraries)
  - [Limits](#limits-4)
- [Sanger Assembly](#sanger-assembly)
  - [Assemblies and contigs](#assemblies-and-contigs)
  - [Plates of clones](#plates-of-clones)
  - [Trimmed ends in a contig](#trimmed-ends-in-a-contig)
  - [Trimming reads](#trimming-reads)
  - [Overview figures](#overview-figures)
- [NGS Read Sets](#ngs-read-sets)
  - [Import](#import)
  - [Storage](#storage)
  - [QC](#qc)
  - [Quality report](#quality-report)
  - [Trimming and filtering](#trimming-and-filtering)
  - [Export](#export)
  - [Limits](#limits-5)
- [NGS Mapping and Assembly](#ngs-mapping-and-assembly)
  - [Mapping to a reference](#mapping-to-a-reference)
  - [Stored mappings](#stored-mappings)
  - [Viewing a mapping](#viewing-a-mapping)
  - [Variants](#variants-1)
  - [Samples](#samples)
  - [Primer clipping](#primer-clipping)
  - [Junctions](#junctions-1)
  - [Guided pipeline](#guided-pipeline)
  - [De novo assembly](#de-novo-assembly)
  - [Figures](#figures-1)
  - [Scale](#scale)
  - [SAM and BAM](#sam-and-bam)
- [Fetching from NCBI and UniProt](#fetching-from-ncbi-and-uniprot)
- [File Format Support](#file-format-support)
  - [Geneious files](#geneious-files)
- [PDF Export](#pdf-export)
  - [One painter, two outputs](#one-painter-two-outputs)
  - [Layout](#layout)
  - [Fonts and text](#fonts-and-text)
  - [Colours](#colours)
  - [Limits](#limits-6)
  - [Figures and reports](#figures-and-reports)
- [References](#references)
- [License](#license)

## Repo Layout

```
.                        the published site (GitHub Pages → seqnexus.app)
├── index.html               landing page (hand-written, not built)
├── app.html                 the built editor (generated, commit it)
├── *.worker-<hash>.js       the editor's Web Workers (generated, commit them)
├── 3Dmol-<version>.min.js   the structure viewer, copied from app/vendor by the build (commit it)
├── impressum.html / datenschutz.html
├── assets/                  favicons, screenshots
├── wasm/                    MAFFT, MUSCLE and Kalign (biowasm), run by the alignment tool
└── app/                     Vite + React source for the editor
    ├── app.html                 Vite entry, builds to ../app.html
    ├── vendor/3dmol/            3Dmol.js browser build and its license (see its README)
    └── src/
```

---

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

---

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
> `app/vite.config.ts`. Do not turn it on: it would delete the repository.

---

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

---

## Overview

- **Multi-document tabs** with session persistence (localStorage + IndexedDB)
  and session files for backup; see [Storage & Persistence](#storage--persistence)
- **Proteins** as documents of their own: FASTA and GenPept in and out, the
  same viewer with residue colour schemes, features, find and numbering from
  any residue; mass, pI and charge, extinction coefficient and the sequence
  indices; translated from a coding feature and linked back to its codons;
  back-translation, tag and protease-site annotation, blastp; see
  [Proteins](#proteins)
- **Three zoom modes** (21 levels): line → dots → letters
- **Linear and circular views** with split mode (resizable divider); see
  [Plasmid Map](#plasmid-map)
- **GenBank import/export** with streaming parser for large files (>1MB)
- **FASTA, SnapGene (.dna), Geneious (.geneious), GFF3 import/export**
- **Annotation editing** - a feature panel grouped by type or sorted by
  position, with a filter that takes `type:`, `len>` and `strand:` terms, run
  from the keyboard, following the selection, and checking every CDS for its
  frame, start and stop; see [Feature Panel](#feature-panel)
- **Several ranges at once** - Ctrl+drag or Ctrl+click on features, in the
  sequence view and on the map; touching ranges merge; copied, deleted,
  translated and annotated joined, as exons are
- **Find/replace** on both strands, with IUPAC codes, up to 3 mismatches,
  protein search in all six frames, regex, and a list of hits with their
  strand, feature and context
- **ORF finder** - 6-frame, configurable, Web Worker; see [ORF Finder](#orf-finder)
- **CRISPR guide design** - protospacers for a dozen nucleases or one you
  describe yourself, scored for activity, for the repair the break is likely to
  get and against the rules a spacer has to pass, drawn on the sequence with
  the PAM and the cut; off-target search with mismatches and bulges over any
  sequence you name, which the result always names back; tasks for knocking a
  gene out, deleting a region, knocking a payload in with a donor that will not
  be re-cut, base editing with its bystanders spelt out, prime editing with the
  pegRNA built in its pieces, and tiling a region; the oligos to order with
  every added base marked, a screening amplicon and the enzyme that reads it
  out, and a library of the guides you keep; and the result read back
  afterwards, either by taking an edited chromatogram apart against its
  control or by counting alleles in amplicon reads;
  see [CRISPR Guide Design](#crispr-guide-design)
- **Restriction enzyme analysis** - hundreds of enzymes from REBASE, with a
  virtual gel; see [Virtual Gel](#virtual-gel)
- **Primers** - primers and probes as oligos with 5'/3' overhangs and
  mismatches, binding sites found automatically; a docked design workbench
  with a candidate track, per-primer inspector and live pair checks
- **Codon optimization** - 19 genetic codes, host usage tables (built-in, or
  imported from EMBOSS cusp / GCG CodonFrequency), motif/homopolymer/GC/repeat
  constraints
- **Sequence alignment** - pairwise (global/local) and multiple sequence
  alignment with MAFFT, MUSCLE or Kalign, in an editable alignment view; see
  [Sequence Alignment](#sequence-alignment)
- **In-silico cloning** - restriction cloning on real plasmid maps (click the
  sites to cut), seamless assembly (HiFi/Gibson/In-Fusion/SLIC), Golden Gate,
  Gateway, TOPO, and combinatorial libraries; see [Cloning](#cloning)
- **NGS read sets** - FASTQ(.gz) import with R1/R2 pairing, QC charts and
  verdicts, fastp trimming and minimap2 mapping (WebAssembly), FASTQ.gz export;
  mappings viewed from a whole genome down to single bases (coverage, reads
  coloured by strand or pair, downsampling, sorting, fragment-length brushing),
  variants with live thresholds and technology presets, VCF, consensus;
  several samples per mapping with a samples x variants matrix and clone
  verification per sample; primer clipping for amplicons; soft-clip junctions;
  a guided pipeline from reads to variants; figures as SVG, PNG or PDF;
  mappings exported as BAM (with its index) or SAM, and imported from either
- **Sanger sequencing** - chromatograms (AB1, SCF) with quality scores and
  base editing, trimming, mapping to a reference or de novo assembly kept as
  assemblies with their contigs, variants, clone verification; see
  [Sanger Assembly](#sanger-assembly)
- **NCBI BLAST** - search NCBI databases directly from the editor; see
  [BLAST](#blast)
- **PDF export** of the sequence as the text view draws it, vector, on A4
- **10 themes** (5 light, 5 dark), a **file explorer** with folders, tags,
  search and grouping, a **command palette**, keyboard shortcuts and
  right-click context menus; see [Working in the Editor](#working-in-the-editor)

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

## Working in the Editor

The window is three panels: the file explorer on the left, the centre panel
(a sequence, protein, alignment, contig, read set, gel or cloning design),
and the right sidebar (features, enzymes, primers and the other tools). The
centre panel keeps one tab per open document.

### The explorer

Everything in the session is an explorer item of one of ten kinds: sequence,
protein, Sanger read, NGS read set, alignment, assembly, contig, gel, cloning
design and oligo. Each kind has its own icon; topology (circular or linear)
is a pip on the icon and a word in the metadata line, so a plasmid and an
alignment can be told apart at a glance.

- **Folders and grouping.** Items live in folders you make (drag to move,
  or file a selection from the bulk bar). How the list is shaped is a
  presentation choice, separate from the folders: group by folder, by kind,
  by tag, by date, or show a flat list, and sort by name, creation, last
  change, size or kind. Switching modes never moves anything. Rows come in
  three densities.
- **Filter and search.** The filter bar takes a text search, a set of kinds
  and a set of tags; an item matches a tag filter when it carries any of the
  listed tags. The filter is deliberately not saved between sessions: a
  saved filter that hides items would open the next session with work
  apparently missing and no visible cause. A count badge shows whenever a
  filter is active.
- **Tags and notes.** Any item takes tags (existing tags are chips to
  toggle, so reusing one cannot introduce a near-duplicate by typo) and a
  short free-text note. Both show in the hover card, together with the
  description and a thumbnail: the plasmid map for a circular sequence, the
  trace for a read. The card is built only on hover, so a session of
  several hundred items costs nothing to scroll.
- **Deleting.** A delete needs no confirmation: the item lands in a delete
  buffer, a toast offers Undo, and the same five most recent entries stay
  reachable in a Recently Deleted strip above the tree until the session
  ends. Bulk deletes still confirm.
- **Selection.** Click, Ctrl+click and Shift+click select items; the bulk
  bar at the foot of the panel offers what can be done with all of them
  (export, align, file into a folder, tag, delete). The tree is a flat,
  windowed list, which is what keeps a few hundred reads scrolling
  smoothly and gives Shift+click its ordering for free.
- **Keyboard.** Arrow keys move through the tree, Left and Right fold and
  unfold groups, typing jumps to the next item whose name starts with what
  was typed, Enter opens.
- **Collapsed.** Collapsed, the explorer becomes a narrow rail of per-kind
  counts; clicking a kind expands the panel and scrolls to that group.

### Views

A sequence opens in the text view, the plasmid map, or split, with the two
stacked and a draggable divider between them; see [Plasmid Map](#plasmid-map).
The text view has three render modes chosen by zoom level (line, dots,
letters; see [Rendering](#rendering)), with Ctrl+wheel zooming around the
pointer. The minimap along the edge shows the whole sequence with the
viewport, features and any graph track on it.

### The command palette

Ctrl+K (Cmd+K on a Mac) opens the command palette. Every command in the app
is in it, in five groups (File, Edit, Analyse, View, Cloning), with its
shortcut shown beside it and the ones that need something you do not have
open greyed out. The toolbar's overflow menu is built from the same
registry, so the two cannot drift apart. Search is a subsequence match
biased towards word boundaries, and each command carries extra search terms
("print figure publication" finds Export PDF). Recent commands come first.

### Undo

Every document keeps its own undo history, up to 100 steps. A step is a
lightweight snapshot: the piece table's tree (a few hundred bytes, however
long the sequence) and a reference to the annotation array, which is shared
between consecutive steps when an edit left the features alone. Each step
carries a label ("Add feature lacZ"), shown in the Undo and Redo tooltips.
A continuous interaction, such as dragging a colour picker over a group of
features, collapses into one step rather than one per frame. Alignments,
contigs, gels and cloning designs keep their own histories the same way, so
Ctrl+Z and Ctrl+Y work in every workspace.

### Themes

There are ten themes: Light, Solarized, Nature, Rosé and Lavender (light);
Dark, Midnight, Dracula, Nord and Catppuccin (dark). A theme is a block of
CSS custom properties on the app root, selected by a `data-theme`
attribute; every colour in the app, including the ones the canvases draw
with, comes from those tokens. Exports (PDF, SVG, PNG, gel images,
publication maps) ignore the theme and draw in the light theme's colours or
a fixed print palette, so a figure looks the same whoever exports it.

### Keyboard shortcuts

| Keys | Action |
|------|--------|
| Ctrl+K | Command palette |
| Ctrl+F | Find and replace |
| Ctrl+G | Go to position |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Ctrl+Shift+S | Export |
| Ctrl+P | Export PDF |
| Arrow keys | Move the caret; Shift extends the selection |
| Ctrl+Left, Ctrl+Right | Jump by one ruler group (10 bases) |
| Ctrl+drag, Ctrl+click | Add a range or a feature to the selection |
| Ctrl+wheel | Zoom around the pointer |
| Delete, Backspace | Delete the selection (confirmed above a size) |

Mac uses Cmd where Ctrl is written. Each workspace adds its own keys, listed
in its section: the feature panel, the alignment editor, the gel and the
explorer.

### Session files and backups

Everything the app holds lives in this browser's storage (see
[Storage & Persistence](#storage--persistence)), which the browser may
clear: under storage pressure, after a week without a visit in Safari, or
when site data is cleared. The copy that survives that is a session file.

**Export Session** writes one JSON file (format `seqnexus-session`, version
1) with every sequence, protein, primer, enzyme set, gel and cloning design,
and optionally the Sanger reads, alignments and contigs, which can be large.
NGS read sets are never included, since their reads would make the file
huge; they stay in the browser. **Import Session** merges a file into the
current session, giving everything fresh ids and rewriting the references
between items, so a session can be imported twice or into another session
without collisions.

The status bar keeps track of when the last complete export was made (one
that left out reads, alignments or contigs does not count) and whether
anything has changed since. A reminder appears weekly or monthly (or never),
and whatever the schedule, a warning appears when storage is above 80% of
the browser's quota. Dismissing a reminder is "later", not "never".

---

## Plasmid Map

The circular view draws the sequence as a ring with its features, cut sites,
primers and tracks around it. A linear sequence is drawn on the same ring,
broken at the origin with an end bar on each side, so it does not read as a
circle. The map view, the split view, the cloning workspace's maps, the
explorer's thumbnails and the PDF export's map page all draw from the same
code.

### One scene, two renderers

The map is built in two passes. A layout pass turns the document into a
backend-neutral display list (arcs, labels, leader lines, ticks), using only
a text-measurement callback from the host. An emitter then walks that list:
one issues Canvas 2D calls for the screen, the other writes SVG. Because
both consume the same list with the same measurer, an exported figure
matches the screen down to the label positions, and label placement can be
tested without a DOM.

The SVG export writes real `<text>` elements, not outlines, so a figure stays
editable and searchable in Illustrator or Inkscape, with curved feature
names on `<textPath>`. Both exports render at fit scale whatever the zoom on
screen, so a figure is never cropped to the viewport you happened to be
looking at; PNG is rendered at 3x, roughly 300 dpi for a figure placed at
2.5 inches.

### Styles and labels

Four presets (Modern, Classic, Minimal and Publication) set the backbone
radius, feature fill opacity, outline colour, fonts and where feature names
go when they do not fit inside their own arc: inside the ring on tiers, or
outside with leader lines. Publication draws black on white and ignores the
theme. Ruler numbers and cut-site names share one tier map inside the
circle, lower tiers filled first, and a name pushed inward gets a leader
line back to the backbone. Overlapping features are stacked onto separate
rings.

### Rings and tracks

- Features, stacked so that none overlap.
- Cut sites of the enzymes shown in the enzyme panel, with a mark on the
  backbone and a name; see [Restriction Enzyme Database](#restriction-enzyme-database).
- Primer binding sites from the primer library.
- Dam (GATC) and Dcm (CCWGG) methylation sites, when switched on.
- GC content and GC skew as a ring, sampled into a fixed number of windows
  (one per half degree) rather than a fixed window size, so a 3 kb plasmid
  and a 5 Mb genome cost the same and the ring never has more arcs than
  there are pixels to hold them.
- A legend.

### Working on the map

A drag around the ring selects, in the direction the pointer turned, so a
drag past the origin keeps going rather than flipping to the short way
round; a range past the origin has its anchor after its caret, as
everywhere else in the app. A linear sequence cannot be selected across its
ends. Ctrl+wheel zooms around the pointer, with a visible button to reset
to fit, since a zoom the pointer cannot undo needs a way back. Clicking a
feature selects it; clicking a cut site puts the caret there; the pointer
hit order in a crowded multiple cloning site is the cut-site name under the
pointer first (the layout has already spread the names apart, so they are
the one target that can be hit on purpose), then the nearest mark on the
backbone, then the topmost feature arc.

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

The extra ranges are tied to the tab and to the sequence's edit count. Any
change to the bases, including undo and redo, drops them. Base edits rewrite
the sequence in place, so ranges kept across an edit could point at the
wrong bases.

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

---

## Annotations

A feature is a typed, stranded range with qualifiers, stored in the
document's interval tree (see [Data Structures](#data-structures)). A
feature made of several ranges (the exons of a spliced CDS) keeps them as
segments. The readers normalise what they import, so that a plasmid map
shows one arrow per thing rather than one per GenBank convention; this
section records those rules.

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

### A gene and its CDS

NCBI records give each coding region twice: a `gene` feature, carrying the
locus tag and the gene's database link, and a `CDS` over the same bases,
carrying everything about the protein. On a plasmid map that is two arrows
for one gene. Every reader (GenBank, NCBI fetch, SnapGene, Geneious) folds
such a gene into its CDS: the gene is dropped and its qualifiers are added to
the CDS's, so the locus tag and the gene's `/db_xref` are kept. This is what
SnapGene does when it reads GenBank.

A gene is folded only when it has exactly the CDS's span and strand and is
the same gene: the same `/gene`, or failing that the same `/locus_tag`, or
failing both the same name. A gene that is longer than its CDS (one with
UTRs, an expression cassette with its promoter), a gene with no CDS (an rRNA
gene), and a spliced gene drawn exon by exon are kept. A GenBank export
writes the CDS only.

### The source feature

Every GenBank record also has a `source` feature over the whole sequence,
carrying the organism, molecule type and strain. It says what the sequence
is, not where anything is on it, so as a feature it would only be one more
ring or row the length of the sequence. Every reader (GenBank, NCBI fetch,
SnapGene, Geneious) takes it out of the features into the document's
metadata, where nothing draws or lists it, as SnapGene does not show it
either. A GenBank export writes it back as the first feature,
`source 1..<length>` over the sequence as it is then, with its qualifiers.
Only the qualifiers are kept: a source over the whole sequence stays over
the whole sequence whatever is inserted or deleted. Documents made from one
(a PCR product, an edited or codon-optimized copy) keep it.

A `source` over only part of the sequence (one of several in a construct,
saying which stretch comes from which organism) has a position that matters
and stays a feature.

---

## Feature Panel

The Features tab of the right sidebar lists the document's features, either
grouped by type (larger groups first, each in sequence order) or as one list
sorted by position, where a hairline under each row shows where the feature
sits along the sequence. Each row gives the range and, under it, the length.

### Filter

Plain words match a feature's name, type and qualifier values, and every word
must match; a quoted phrase is one word. Terms narrow further:

| Term | Keeps |
|------|-------|
| `type:CDS`, `t:cds` | features whose key contains the text; several `type:` terms keep any of them |
| `len>500`, `len<=1.5k`, `len=300` | spans compared in bases (residues on a protein); `k` is a thousand |
| `len:100-1k` | spans in the range, both ends included |
| `strand:+`, `strand:-`, `strand:none` | one strand (also `fwd`, `rev`, `0`) |

A feature across the origin is measured by its wrapped span. A term that does
not parse (`len>abc`) is kept as a plain word, so a typo empties the list
instead of being ignored. "Only features where the selection is" keeps the
features that share a base with any selected range, or the base after the
caret when nothing is selected.

### Following the sequence

Rows of features under the selection carry a thin bar. Clicking a feature on
the map or in the sequence selects exactly its span; the panel then scrolls
to that row and makes it the keyboard's row. Hovering a row highlights the
feature in the sequence and on the map, as hovering there does.

### Keyboard

The list is one focusable listbox. The sequence editor ignores keys aimed at
a listbox (and at text fields, menus and dialogs), so nothing typed here
edits or moves through the sequence. Up and Down move through the rows and
select each feature's span (Shift extends the multi-selection, Space toggles
a row), Enter opens the editor, F2 opens it on the name, Delete removes the
feature (several at once after a confirmation), Escape closes the editor or
clears the multi-selection, Ctrl+C copies the feature's bases, Ctrl+Z and
Ctrl+Y undo and redo, and any letter goes to the filter.

### Editing

Each field is one undo step. Name and qualifier text writes through as it is
typed and is folded into one step per visit to the field; positions are
drafts committed on Enter or when the field loses focus, after a check that
the feature is not empty, not past the end and, on a linear sequence, not
backwards. A joined feature is edited part by part: start and end follow the
first and last parts, and parts that would overlap or run backwards are
refused with the reason. Editing the overall range of a joined feature used to
drop its parts without a word (the model keeps parts only while they agree
with the span); the parts editor, and an explicit Make One Span, replace it.

### CDS checks

Every CDS is read in its declared frame (from `/codon_start`, with its
`/transl_table`) and the row is flagged when:

- **a stop codon comes before the last codon** (a warning): the boundaries
  or the frame are wrong;
- **the length is not a whole number of codons** (a warning);
- **the first codon is not a start codon** (a note): checked only when
  `/codon_start` is 1, since a feature declared to start mid-codon is partial;
  the starts are those of the feature's genetic code, or ATG, GTG and TTG
  without one;
- **the last codon is not a stop** (a note): a GenBank CDS includes its stop
  codon, so the feature ends early or its 3′ end is partial. It is only
  checked in frame (out of frame the last codon read is not the one the
  feature ends on) and not for a feature cut short at a cloning junction.

The two notes are often correct (alternative starts, partial genes from a
larger record), so they are drawn quieter than the warnings. Partial
locations (`<1..300`) are not kept on import, so a partial CDS read from a
GenBank file is noted as missing its stop. The editor of a CDS shows its
translation with the same messages, a Copy button and Open as Protein.

---

## Feature Library and Auto-annotation

Auto-annotation proposes features by finding known elements in the
document: the built-in library of common plasmid parts, plus any database
the user imports (an imported entry with the same name and type replaces
the built-in one).

### The built-in library

The library holds about 730 common plasmid parts, each with its GenBank
source. They are stored 2-bit packed and decoded the first time a scan
needs them. Protein-only parts (tags and fusion partners) are in the
protein library (see Proteins, Auto-annotation).

- **RNA entries** (the Spinach, Broccoli, Corn and Mango aptamers) are
  stored in DNA letters. A plasmid encodes them with T, and the scan
  compares letters literally, so an entry written with U would never be
  found.
- **Feature types.** A protein-coding entry is a CDS:
  every entry that is a whole open reading frame (a start, no internal
  stop, a stop at the end) is typed CDS, along with coding fragments and
  domains (KRAB, KASH, an activation domain). The exceptions are elements
  that read through in one frame by chance: tandem response elements
  (3X NFAT, 5X ATF6, 8X TCF/LEF, 12X ZFHD1), packaging signals, introns and
  the SV40 enhancer. The type decides how the feature is drawn, whether the
  feature panel's CDS checks apply, and whether the entry is translated
  into the protein library.
- **Versions of one element.** A part name often stands for more than one
  sequence. Some are different genes: kanR is both
  Tn903 aph(3')-Ia and the Gram-positive aph(3')-IIIa, blastR is both bsr
  and BSD, and tetR is both tet(A) and the tet(C) of pBR322 and its
  descendants. Others are versions of different lengths: the lacZ alpha of
  pUC19, pBluescript, LITMUS and a dozen other vectors, or a minimal CMV
  promoter beside the full one. Keeping only the longest of each name
  would mean the scan never finds the others, because a reference is
  matched over its whole length. A pUC19 lacZ alpha (324 bp) cannot match
  a 576 bp reference. So each distinct version is kept under a qualified
  name (`tetR (pBR322)`, `lacZα (pUC19)`, `rb glob PA (short)`), with the
  shared name as its group. A version is dropped only when the main entry
  already finds it (EGFP and EYFP that differ by a few bases, a URA3
  promoter nine bases shorter). One more was dropped for a different
  reason: a degenerate thyroid response element, written with N and R
  codes that the literal comparison cannot match.

### The scan

The document is indexed by k-mers (k = 6, 8 or 10 by document length,
longer for longer documents, trading sensitivity for speed). For each
reference, on both strands, every shared k-mer votes for the document
position where the reference would start. A start with at least half the
votes a match at the threshold would give is compared base by base over the
reference's whole length. The comparison is ungapped percent identity. It
stops as soon as the mismatches exceed what the threshold allows. The
default threshold is 85%.

Overlapping hits of one reference (overlap of at least 75% of the shorter)
become one proposal: the most similar, and of equally similar ones the
longest. Versions of one element are treated as one reference for this,
by group and type. So a pUC19 plasmid gets one lacZ alpha, the version
that fits it best, rather than one per vector the library knows. A short
version inside a longer one gives way to the longer one when both match
equally well. Distinct elements that overlap (a promoter inside a gene,
a tag inside a fusion) are all proposed.

### Limits

- **Ungapped.** An insertion or deletion shifts the rest of the reference out
  of register, so a copy with an indel near its middle falls below the
  threshold. Keeping the versions of an element is the remedy for the
  common cases. Gapped alignment of every reference would cost a dynamic
  program per candidate.
- **Whole references.** A truncated copy is found only if its missing part
  is small enough for the remaining mismatches to stay within the threshold.
- **Literal letters.** An ambiguity code in a reference matches only the same
  code in the document.

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

## ORF Finder

Find ORFs (in the Analyse group) scans all six frames of the sequence and
draws every open reading frame as an overlay on the sequence view and the
map, listed in a panel grouped by strand and frame with clickable positions.

- **What counts.** An ORF runs from a start codon to the next in-frame stop
  codon of the document's genetic code. The start codons are chosen from
  ATG, GTG, TTG and CTG (ATG by default); the minimum size is given in
  codons, stop included. Interior ORFs (one that starts at a downstream
  start codon inside a longer ORF on the same strand) are shown by default
  and can be filtered out, leaving only the longest ORF ending at each stop.
- **Circular sequences.** Reading continues past the end into the start, at
  most one turn less a base, so an ORF across the origin is found once and
  cannot overlap itself. An ORF met from more than one frame of the scan
  (possible when the length is not a multiple of three) is listed once, with
  the frame counted from its own start.
- **Where it runs.** In a Web Worker; the same code runs on the page when a
  worker cannot be started (see the [Limits](#limits-5) of NGS read sets for
  when that is).

### ORFs as features

The overlay is an analysis result, not part of the document. Ctrl+click
picks ORFs on the canvas, and Add turns the picked ones (or all of them)
into CDS features in one undo step. An ORF that already has a feature with
exactly its span and strand is left out of what Add would create, so
pressing Add twice cannot make two copies; the bar is deliberately that
tight so a merely overlapping CDS (a shorter isoform, a neighbouring gene)
does not quietly swallow an ORF you could add. Unlike auto-annotation
suggestions, ORFs are not hidden once something covers them: the overlay
answers "where are the open reading frames", and the answer does not change
because one of them is now annotated. Toggle ORF Display hides the overlay.

---

## Proteins

A protein is the same document as a DNA sequence: the same piece table, the
same annotations and interval tree, the same undo history, explorer row,
folders, tags and session storage. The only difference in the model is the
alphabet the Sequence carries (`dna` or `protein`), which every edit and
snapshot keeps. A protein is always linear; a snapshot without an alphabet
is DNA.

### Alphabet

A protein may hold the twenty standard amino acids, selenocysteine (U) and
pyrrolysine (O), the ambiguity codes B (D or N), Z (E or Q), J (I or L) and
X (any residue), and the stop (`*`). Typing and pasting check against this
set the way DNA is checked against the IUPAC codes, and refuse anything else
with the offending characters named.

A pasted or imported record is sorted into DNA or protein by its letters: a
letter that only a protein can hold (E, F, I, J, L, O, P, Q, X, Z or a stop)
settles it; otherwise at least nine letters in ten have to be A, C, G, T, U
or N for the record to be DNA. The rule errs towards protein for short
stretches written only in IUPAC letters (ACDGHKMNRSTVWY are all codes), which
is the safer mistake: a peptide opened as DNA would be reverse-complemented
and translated, a short DNA fragment opened as a protein is only coloured
oddly. The New Sequence dialog follows the same guess until the molecule is
chosen by hand.

### What a protein does not have

Everything that needs bases is left out of a protein's view rather than
offered and refused: the complement strand, the translation rows, restriction
enzymes, ORFs, primers, the plasmid map and split view, GC content, Tm and
codon usage, methylation and cloning. The panel bar shows Features, Motifs,
Auto and Display; the toolbar buttons for the DNA tools are disabled with a
note saying why, and the ORF finder's slot holds the motif finder. The feature type list offers
protein feature keys (Region, Domain, Site, Chain, sig_peptide, transmembrane,
disulfide and so on, the GenPept keys and the UniProt categories spelt as one
word so they survive export) instead of promoters and terminators.

In the explorer a protein is its own kind, with its own icon, group and
filter, so a workspace of plasmids and the proteins they encode reads at a
glance. A protein row says its length in residues (`245 aa`) and omits the
topology word.

### Import and export

- **FASTA.** Each record is sorted by the rule above. A `.faa` file is read
  as protein throughout.
- **GenPept.** A GenBank-format record whose LOCUS line counts `aa` is a
  protein. Features sit on residues; a Region is named by its
  `/region_name`, a Site by its `/note`. The writer produces the same layout
  (`LOCUS name 142 aa linear date`, no molecule type, residues in lowercase
  blocks of ten), so a protein exported as "GenBank" is a GenPept file that
  NCBI's own tools read.
- **Plain text and the clipboard** go through the FASTA reader.
- **Export:** GenPept, FASTA, GFF3 and the feature CSV, and the PDF of the
  sequence view. SnapGene's `.dna` is a DNA format and is not offered for a
  protein; in a bulk export it falls back to GenPept.

### Residue colours

A protein document has its own colour preference, separate from the base
colour scheme, since a nucleotide palette says nothing about residues. The
schemes are the ones the translation strip under a DNA sequence already
offers, plus the two alignment conventions that colour a residue on its own
rather than by its column:

| Scheme | What it shows | Source |
|--------|---------------|--------|
| Hydrophobicity | Kyte-Doolittle hydropathy, blue (polar) to orange (hydrophobic) | Kyte and Doolittle (1982) |
| Polarity (default) | Acidic, basic, polar and non-polar groups, as textbooks colour them | |
| RasMol | The RasMol amino acid palette | |
| Clustal | Clustal X residue colours | Thompson et al. (1997) |
| MacClade | MacClade residue colours | |
| Taylor | One hue per residue, neighbours in the wheel are chemically similar | Taylor (1997) |
| Zappo | Physicochemical groups, as Jalview draws them | Waterhouse et al. (2009) |

As for bases, a scheme tints the letters or fills the cell behind each
residue, with the glyph drawn in whatever contrasts. The composition in the
statistics popover uses the same colours. Three-letter spelling is not drawn
on a protein's canvas: a residue is one cell wide there, where a codon in
the translation strip is three.

### Find

On a protein the query is searched as residues, on the one strand there is,
so the DNA/Protein and both-strands controls are not shown. The ambiguity
codes read as sets (X any residue but a stop, B D or N, Z E or Q, J I or L),
mismatches are allowed and counted in residues, and a regular expression
works as it does on DNA. A replacement is residues, checked against the same
alphabet.

### Numbering

A protein can be numbered from any residue, so a mature chain can count from
1 after its signal peptide, or a fragment can keep the numbering of the
record it came from. The start is set in the properties dialog and applies
to the ruler, the selection readout, feature positions and the find list.
It is stored as a negative display origin: the field that rotates a circular
sequence's numbering shifts a linear one's instead (`-24` shows the first
residue as 25). One field, two meanings told apart by sign, so every place
that already formats a position through `displayPosition` handles both.

### Properties

The Stats button of a protein opens its properties, computed from the
residues on every render (the maths is O(n) and a protein is short). With a
selection the numbers are of the selected residues, and a switch goes back
to the whole protein; the selection readout in the status bar and the drag
pill show the mass of a selection as well. The constants follow ExPASy
ProtParam, which the tests check against for a published 121-residue report
(mass, formula, charged residues, pI, GRAVY, aliphatic and instability
index all agree; the instability index to within 0.02).

- **Mass.** The sum of the average residue masses plus one water, and the
  monoisotopic mass. Selenocysteine and pyrrolysine have their own masses;
  B, Z and J take the mean of what they stand for, X the mean of the
  twenty; stops and gaps weigh nothing. The elemental formula leaves the
  ambiguity codes out.
- **Charge and pI.** Net charge by Henderson-Hasselbalch over the N
  terminus, Lys, Arg, His (positive) and the C terminus, Asp, Glu, Cys,
  Tyr (negative). The pI is where it crosses zero, found by bisection to
  0.001 pH. Four pKa sets are offered, since the set is most of why two
  calculators disagree: EMBOSS (the default, what the `iep` program
  reports), Bjellqvist (the ExPASy values, with their residue-specific
  terminal pKa), Lehninger (free amino acids) and Grimsley (averages
  measured in folded proteins). A slider gives the charge at any pH, and a
  titration curve shows it from 0 to 14 with the pI marked.
- **Absorbance at 280 nm.** Pace et al. (1995): 5500 per Trp, 1490 per
  Tyr, 125 per cystine. Three values: every Cys reduced, every pair of Cys
  as a cystine, and the disulfides the document annotates (`disulfide`
  features). A280 of a 1 mg/mL solution is ε over the average mass.
- **Indices.** GRAVY (the mean Kyte-Doolittle hydropathy), the aliphatic
  index of Ikai (1980), the instability index of Guruprasad et al. (1990)
  with its 40 threshold, and aromaticity (the fraction of Phe, Trp and Tyr).
- **Composition** with the residue colours of the view.

### DNA and protein

A coding feature, or a selection, is translated into a protein document of
its own from the context menu (the selection is read in frame from its
first base, in the direction it was dragged). The protein remembers its
source: the document, the feature, the coding span and strand, the exons
of a spliced feature, the `/codon_start` offset and the genetic code. A
single trailing stop is dropped; internal stops are kept so a nonsense
mutation shows. Features inside the coding region come along at residue
resolution, the coding feature itself excepted.

In the protein, a chip beside the name says where it came from and selects
the codons of the current residue selection in the DNA (or the whole coding
region). The context menu adds "Show codons in …", and "Add features to …",
which puts the protein's features on the DNA at the codons they cover,
skipping any the DNA already has, as one undo step on the DNA. The mapping
walks exons, so a feature across an intron becomes a joined feature. In the
explorer a translated protein nests under its DNA.

"Find in DNA" takes a selected peptide to any open DNA document and
searches its six frames, through the protein search that already exists.

### Back-translation

For a protein the codon optimizer becomes a back-translator: every residue
gets the codon the chosen host uses most (B, Z and J as Asp, Glu and Ile;
X, U and O have no codon and are reported), and that DNA is then optimized
with the same settings and constraints as any coding sequence, so a motif
to avoid is avoided here too. "Open as DNA" opens the result with the
protein as its one coding feature. There is nothing to apply in place.

### Auto-annotation

A protein is scanned against a protein library instead of the DNA
databases: a curated list of epitope and purification tags (His6, FLAG,
HA, Myc, V5, Strep, Avi, ALFA, HiBiT, Spy and Snoop tags and others),
protease sites (TEV, thrombin, HRV 3C, enterokinase, Factor Xa), linkers,
localization signals (NLS, NES, KDEL, HDEL, SKL) and 2A peptides; a
second list of protein parts with the fusion partners (GST, MBP, SUMO,
thioredoxin, SNAP, CLIP, HaloTag, Fc, DHFR, KSI, the TAP tag, cellulose-
and chitin-binding domains), more epitope tags (AU1, AU5, Ty1, KT3, OLLAS, NE, E2, HSV, Protein C and
others), the TVMV site, near-infrared and blue reporters, and activation
domains; and the coding entries of the DNA library translated with the
standard code, so the same GFP or kanR is found on a plasmid and on its
protein. Versions of one entry (the three TAP tags, the two E2 tags) form
a group, as in the DNA library. Parts shorter than six residues are left
out of that list (the four-residue C-tag, polyArg, polyAsp, the PKA
site): a natural protein contains them by chance, so a hit would mean
nothing. The scan is
the DNA matcher on residues, with a 3-mer seed and one strand. Peptides
shorter than ten residues are matched exactly, since a six-residue tag with
one mismatch is not that tag; longer entries take the similarity threshold.
Proposals, picks and conversion work as for DNA.

### Alignment, BLAST and find

Protein documents appear in the alignment dialog, which already recognised
protein letters and switches to BLOSUM62 and the protein colour schemes.
BLAST offers blastp and tblastn for a protein query and swaps its saved
program when the open document changes kind; hits of a protein search link
to NCBI's protein records.

### Graph tracks

A protein can carry one graph track under its feature lanes, drawn as a
filled curve on every row of the sequence view, along the minimap, and in
the PDF. The curve is the mean of a per-residue scale over a window centred
on each residue; the window is cut short at the two ends so every residue
has a value (ProtScale leaves the first and last half-windows blank), and
residues the scale does not know (X, B, Z, a stop) are left out of the mean
rather than counted as zero. Two prefix sums make the profile O(n) whatever
the window. The scales, their default windows and their sources:

| Scale | Window | Guide | Source |
|-------|--------|-------|--------|
| Hydropathy | 9 | 0; above is hydrophobic | Kyte and Doolittle (1982) |
| Hydrophilicity | 7 | 0; peaks are exposed, likely antigenic | Hopp and Woods (1981) |
| Hydrophobicity | 9 | 0 | Eisenberg et al. (1984), the consensus scale |
| Charge at pH 7 | 9 | 0 | Side-chain charge by Henderson-Hasselbalch with the EMBOSS pKa values; Lys, Arg, His positive, Asp, Glu, Cys, Tyr negative, the rest zero |
| Flexibility | 9 | 1 | Vihinen et al. (1994) normalized B-factors |

The windows are ProtScale's defaults, and any odd window from 1 to 21 can
be chosen instead. The minimap's copy of the track is the same values
averaged into one bin per pixel, with the value under the pointer in the
hover readout.

### Motifs and sites

The motif finder sits where the ORF finder sits for DNA and answers the same
question for residues: where are the things worth a feature. It scans the
protein against a short library of patterns written in PROSITE notation
(`N-{P}-[ST]-{P}`: elements separated by hyphens, `x` any residue, `[..]`
one of, `{..}` none of, `(n)` or `(n,m)` repeats, `<` and `>` the ends),
which a small parser turns into a regular expression. Every occurrence is
reported, overlaps included, by matching in a lookahead at each position.

The library is deliberately short. PROSITE's full set of patterns finds a
site every few residues of any protein, which is why its own tools hide the
frequent patterns by default; what is kept here is what a lab checks a
construct for. The categories: modification sites (the N-glycosylation
sequon, kinase and myristoylation sites, amidation, sumoylation, the CAAX
box), processing sites (furin, caspase-3, the acid-labile Asp-Pro bond),
targeting signals (mono- and bipartite nuclear localization signals, ER
retention, PTS1, RGD), binding and catalytic signatures (the P-loop,
EF-hand, C2H2 zinc finger, the serine and cysteine protease active sites),
the leucine zipper, and the sequence liabilities a developability review
flags (deamidation, Asp isomerization, oxidation-prone and glycation-prone
pairs). Each entry names its PROSITE accession or the paper it comes from;
the panel shows the pattern beside the hits. A pattern this short also
matches by chance, so a hit is a place to look, not a finding, and the panel
says so.

Membrane spans ride the same overlay as one more category, from the rule of
Kyte and Doolittle (1982): a 19-residue window whose mean hydropathy
exceeds 1.6. Each residue whose window passes marks a candidate; runs of
them, widened to the window they were judged by and merged where they
touch, are the segments, and segments shorter than 15 residues are dropped.
Only whole windows count, so the ends of a protein do not pass on half a
window of leucines. The rule finds hydrophobic stretches, not whether the
protein is in a membrane at all, which is why its hits are provisional
features until converted.

Hits are drawn as an overlay like ORFs, in the colour of their category:
Ctrl-click picks one, the panel bar converts the picked ones (or all of
them) into features of the type the pattern names (`glycosylation`,
`modified_residue`, `Site`, `Motif`, `active_site`, `transmembrane`) as one
undo step. A hit the document already has a feature for, by name and
residues, is not added twice. Categories can be switched off in the panel
and the overlay follows. The scan is a regular-expression pass over a short
protein and runs on the residues themselves, so a substitution moves a site
at once.

### UniProt and NCBI protein import

"Import by Accession" takes a UniProt accession or entry name (`P69905`,
`HBA_HUMAN`), an NCBI protein accession (`NP_000509.1`, GenPept from the
`protein` database) or a nucleotide accession, guessing the source from the
accession's shape: UniProt accessions follow a fixed pattern (a letter, a
digit, then letters and digits in the published arrangement), RefSeq
proteins start `NP_`, `XP_`, `WP_`, `YP_` or `AP_`, GenBank proteins are
three letters and five or seven digits. The guess can be overridden.

A UniProt entry comes through the REST service's JSON, which the server
sends with CORS headers so the page can ask for it directly. The document
is named after the gene (or the entry name), described by the recommended
protein name and organism, and carries the entry's features as annotations
on their residues: chains, peptides, signal and transit peptides, domains
(zinc fingers and DNA-binding regions among them), regions (coiled coils,
compositional bias, topological domains), motifs, repeats, membrane
segments, active and binding sites, modified residues (lipidation and
cross-links among them), glycosylation, disulfide bonds and natural and
mutagenesis variants. A natural variant is named in the short HGVS form
(`p.D7G`) with the original and the alternative residues as qualifiers.
Secondary structure (helix, turn, strand), sequence conflicts, the initiator
methionine and features without a fixed position are left out: they are
about the record, not the protein. The entry's PDB identifiers and whether
AlphaFold has a model are kept in the document's metadata for the 3D
viewer.

### Disulfide bonds

A disulfide is a feature of type `disulfide` with two one-residue segments,
one per cysteine, so the feature model that already carries exons carries
bonds. It is drawn as an arc from one cysteine to the other over the feature
lane rather than as a bar with a line across; the properties panel counts
it for the extinction coefficient. Two cysteines selected together (Ctrl-
click) offer "Add Disulfide Bond" in the context menu. In GenPept the bond
is written as `bond(48,52)`, which is the format's own notation and what
the reader already accepted.

### Variants

A protein in a lab is usually a variant of something, so an edit to a
protein is written down. Replacing selected residues (typing over a
selection, pasting, or "Mutate to" in the context menu, which lists the
twenty residues and a stop for a single selected residue) and deleting
residues create a `variant` feature on the residues the edit left behind,
named in the one-letter HGVS short form the literature uses (`p.K27M`,
`p.K27del`, `p.K27_L29del`, `p.K27_L28insAG`, `p.K27_V28delinsRST`,
`p.K27*`), with the recommended three-letter name (`p.Lys27Met`) in the
note and the original residues, the replacement and the position as
qualifiers. Positions follow the displayed numbering. The feature and the
edit are one undo step. A deletion that meets one already recorded extends
it, so Backspace held down is one deletion and not five. Inserting at the
caret is not recorded: a protein typed in from scratch is not a variant of
its first residue. The feature list, grouped by type, is the mutation list;
"Add features to" carries variants to the DNA with everything else. The
record can be switched off in the display settings.

### Domain map

A protein's Map view is a linear domain map: the chain as a bar with a
residue ruler, its features in lanes above it as bars in their colours
(the name inside when it fits, beside it otherwise), one-residue features
as lollipops with the name above, and disulfide bonds as brackets under
the chain joining their cysteines. Split stacks the map over the sequence
at the map's own height. Hovering a feature shows its card, clicking it
selects its residues, and the current selection is a band on the map.

The map is built as the same backend-neutral display list the plasmid map
uses (rectangles, lines, dots and text with a halo), so one canvas
renderer, one SVG emitter and one image export draw it, and the exported
PNG or SVG is the figure on screen. The plasmid map's style setting applies
(Publication draws black on white and ignores the theme) and so does its
palette. Features are laid out greedily into lanes, widest first, with a
site's label counted as its width so names do not collide; the map is as
tall as the lanes need. The scene gained a height beside its size for this,
which the renderers honour and the square plasmid map leaves unset.

### Proteolysis

The Digest button (the restriction enzymes' slot on a protein) cuts the
protein with one or more proteases. The rules follow ExPASy PeptideCutter
where it states a simple rule: a residue before the bond, and a residue
after it (proline, usually) that blocks the cut. Trypsin after Lys or Arg
not before Pro; chymotrypsin after Phe, Tyr, Trp (high specificity) or
also Leu and Met (low); Lys-C after Lys; Arg-C after Arg; Glu-C after Glu
(bicarbonate) or Glu and Asp (phosphate); Asp-N before Asp; pepsin at pH
1.3 after Phe or Leu, not before Pro nor after a Pro at P2; cyanogen
bromide after Met. PeptideCutter's longer exception lists (trypsin's CKD,
DKD, CKH, CKY, RRH, RRR and the WKP and MRP exceptions to the proline rule)
are not applied: they fine-tune a minority of sites, and the simple rule is
what every other tool uses. The engineered proteases cut at their
recognition sequence only: TEV at ENLYFQ before Gly or Ser, thrombin at
LVPR before Gly or Ser, Factor Xa after IEGR or IDGR, enterokinase after
DDDDK, HRV 3C at LEVLFQ before Gly. Several proteases pool their sites.

With missed cleavages, every run of up to n+1 consecutive fragments is a
peptide too, listed beside the complete digest and marked partial. Each
peptide carries its position in the displayed numbering, monoisotopic and
average mass (the ProtParam residue masses plus one water), m/z at charges
1 to 3 from the monoisotopic mass and the proton's mass (1.007276 Da), pI
with the EMBOSS pKa set, and GRAVY. The header gives the number of
peptides, the sequence coverage of the complete digest and the largest
peptide. A peptide clicked is selected on the sequence; "Show on sequence"
draws the peptides as bars over the protein (alternating colours, partials
grey), the table exports as CSV, and "Run on gel" opens an SDS-PAGE gel
with the protein intact beside the digest.

### SDS-PAGE

The virtual gel has a kind: agarose for DNA, SDS-PAGE for proteins. A gel
started from a protein is poured as 12% acrylamide with a protein ladder,
the protein intact and a tryptic digest; the kind can be switched in the
gel's settings, which then offer the acrylamide percentage instead of
agarose and buffer, protein ladders instead of DNA ladders, and protein
lanes (a protein document, intact or cut with the proteases above, with
missed cleavages) instead of sequence and PCR lanes. Every label, the size
cursor, the inspector, the CSV and the PDF print kilodaltons.

The migration model is the agarose model's sigmoid in log size with the
protein's mass as the size. SDS gives every chain the same charge per
mass, so mobility is set by size alone and the distance run is linear in
log mass across the gel's useful window, which is the Ferguson relation a
standard curve is drawn on. Each acrylamide percentage is given the
window it is recommended for (6%: 60 to 250 kDa, 8%: 40 to 180, 10%: 25 to
120, 12%: 15 to 80, 15%: 8 to 50); the characteristic mass is the window's
geometric centre and the steepness puts the window's ends near 15% and 95%
of the run. Bromophenol blue runs with the ion front in SDS-PAGE, so the
run slider is the front of the run. Band spread, merging, brightness and
the detection threshold are the agarose model's. The species' size field
holds base pairs on a DNA gel and daltons on a protein gel, so the band,
label and layout code is written once. A digest lane shares the load among
the complete digest's peptides by mass, with each missed cleavage leaving a
partial a fifth of its share; a peptide can be selected in the protein or
opened as a protein of its own, numbered as in the chain it came from.

The ladders are representative of the common prestained 10 to 250 kDa and
dual-colour sets, an unstained broad-range set (6.5 to 200 kDa) and a
low-range peptide marker (1.4 to 26.6 kDa), equal mass per band with the
coloured reference bands heavier, about 2.5 µg in a well. Gradient gels
are not modelled.

### Secondary structure

Chou and Fasman's conformational parameters (1978) are three more graph
tracks (helix, strand and turn propensity, windows 7, 5 and 5), and their
nucleate-and-extend rule predicts helices and strands that ride the motif
overlay as a Structural category beside the membrane spans. A helix is
nucleated where four of six residues have P(alpha) above 1.03 and
extended both ways while the mean over four residues stays at or above
1.00; a strand where three of five residues have P(beta) above 1.05, with
the same extension; a segment is kept when it is at least six (helix) or
five (strand) residues long and its own propensity beats the other's, and
where a helix and a strand overlap the one with the higher mean keeps the
residues. Turns are not predicted (the tetrapeptide probabilities are
left out). The method is about 55 to 60% accurate per residue and is kept
for its transparency: the propensity table says why a helix is predicted
where it is. The segments are provisional until converted, like every
other hit on the overlay. GOR IV and COILS are not included: GOR IV's
parameter tables are too large to embed faithfully and COILS's scoring
matrix is not reproduced here; a structure from PDB or AlphaFold (the 3D
view below) is the better answer for both.

### 3D structure

A protein's 3D view puts its structure beside its sequence. The structure
comes from one of three places: an experimental entry from the RCSB PDB by
PDB id (the entry's mmCIF, since large entries have no PDB-format file), the
AlphaFold database's model for a UniProt accession (the prediction API names
the current model file, fetched in PDB format), or a PDB or mmCIF file
opened from disk. A protein imported from UniProt offers the PDB entries
and the AlphaFold model its record names as one click. Opening a structure
file directly opens each distinct protein chain as a protein of its own
(the copies of a homodimer are one protein), with the structure attached.

The document keeps a reference only: the source, the id, the chain and the
key the coordinates are cached under. The coordinates themselves are kept
in the browser's IndexedDB, so a structure opens again offline; a fetched
one is fetched again when the cache is gone. A file's coordinates cannot be
fetched, so on another computer the panel asks for the file again (the
cache key is a hash of the file's text, so the same file reattaches). Only
the id goes to RCSB or the AlphaFold database, never the sequence.

**Lining up the residues.** A structure's residue numbers rarely match a
sequence's positions: the construct carries a tag the crystal lost, the
structure starts at the mature chain, disordered loops are missing, or the
depositors numbered from the native protein. So the protein is aligned to
each chain (Needleman-Wunsch, BLOSUM62, gap open -10 and extend -0.5, the
alignment tool's protein defaults) and the alignment gives the residue map;
chains with the same sequence are aligned once and the chain with the most
identical residues is chosen. The footer says how many residues aligned and
how identical they are, and a warning appears below 30% identity. The
alignment is redone after every edit, so a mutation or deletion moves the
map with it. The chain can be changed by hand.

Reading the file: residues of the first model with an alpha carbon and a
residue name the code table knows (the twenty, selenocysteine and
pyrrolysine, and the modified residues structures use for standard ones,
such as selenomethionine, phosphoserine and pyroglutamate, read as their
parent), numbered by the author numbering; waters, ligands and nucleic
acids drop out without a list of them. Each residue's B-factor is the mean
over its atoms; in an AlphaFold model that column holds the pLDDT.

**The view.** The viewer is 3Dmol.js (Rego and Koes 2015), loaded on first
use from a script beside app.html, so it costs nothing until a structure is
shown and works when the app is opened from disk. The matched chain is drawn
as cartoon, sticks or a surface; other chains are faint cartoons, ligands
sticks, water hidden. Colouring:

| Colour | What it shows |
|--------|---------------|
| Features | Each residue in the colour of the smallest visible feature covering it, so a site inside a domain shows the site |
| Residue scheme | The protein colour scheme of the sequence view |
| N to C | Blue at the N terminus to red at the C terminus, to read a fold's topology |
| Chain | One colour per chain |
| Confidence | AlphaFold's pLDDT in the AlphaFold database's four bands and colours: very high above 90, confident 70 to 90, low 50 to 70, very low below 50 |

A surface is built per colour as patches shaped by the whole chain (3Dmol's
per-vertex colour callback does not reach every vertex of a surface), and
the N-to-C spectrum is cut to 20 steps on a surface to keep the patches
few.

**Linked to the sequence.** Residues selected in the sequence are drawn as
sticks in the accent colour; a feature hovered in the sequence lights up its
residues; a residue clicked in 3D is selected (and scrolled to) in the
sequence; hovering a residue names it, its chain, its position in the
protein and, for an AlphaFold model, its pLDDT. The view exports as PNG.

### Limits

The three-letter spelling is not drawn on a protein's canvas.
The motif library is a curated subset of PROSITE, not the database; a
pattern file cannot yet be imported. The domain map is not placed in the
PDF export, which draws the sequence view; export it as SVG or PNG. SDS-PAGE
gradient gels and glycosylated or otherwise anomalous migration are not
modelled. The structure view shows structures; it does not predict them,
and it does not edit coordinates. Residues are matched to the structure by
author number, so a structure using insertion codes (27, 27A) maps the
first of each number only. Only the first model of an NMR ensemble is read.

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
   the internal-mismatch parameters (Allawi & SantaLucia 1997-98, Peyret
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
  primer pair (within 2 kb). ≥ 6 °C is good, 3-6 °C is ok, less is poor.

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

### How sites are drawn in the sequence view

- **Names** sit above the ruler at their cut, each in the lowest row where it
  clears the name before it. A line gets only the rows its own names need (up
  to five), so a line with no site carries no space for them. Names that fit
  in none of those rows become a "+N" chip in a row above, which lists them on
  hover and selects the stretch they cover on click. Earlier, every line had
  three rows and the overflow was drawn into the top one over its neighbours.
- **A bar per site** marks its recognition sequence between the ruler and the
  bases, in lanes so sites that overlap or merely touch stay apart. This
  replaced a tint on the bases themselves, which merged adjacent sites (the
  usual case in a multiple cloning site) into one block. There are no bars at
  the most zoomed-out levels, where a six-base site is under a pixel.
- **The cut** is a step through both strands: down through the top strand at
  its cut, across between the strands, down through the bottom strand at its
  cut. The step's width is the overhang, so a sticky end, a blunt end and
  which strand protrudes read at a glance. With only one strand shown, it is
  the top-strand cut alone.
- **Hovering** a name, a bar or a chip ties a site together: its name, its
  line to the ruler, its bar, a tint over its bases and its cut light up, and
  every other site fades. Names are the reliable target in a crowded stretch,
  since they are the one part already spread out.

### Saved enzyme sets

The Restriction Analysis panel runs a subset of the database: one of the
built-in groups (common 6-cutters, Type IIS, blunt cutters and so on), or a
set of the user's own. A set is made from what the panel lists: narrow the
enzymes down with the subset, the search and the cut filters, and save the
list under a name. A saved set can be renamed, have its enzymes edited as a
list of names, or be deleted (with Undo). Geneious enzyme sets come in as
saved sets too (see [Geneious files](#geneious-files)). The codon
optimizer's restriction sites to avoid can be a saved set as well as a
built-in group; a set deleted since leaves it avoiding none.

A set holds enzyme names, spelt as the database spells them and matched
without regard to case, not the enzymes themselves, so it keeps working
when the database is rebuilt. A name the database does not know is left
out and said so: the database is REBASE's commercially available enzymes,
and a set from elsewhere can name others. Sets are saved with the session
and travel in session files; a merged session adds its sets beside the ones
already saved, skipping any with the same name and enzymes.

---

## Virtual Gel

A gel is an explorer item: a set of running conditions and an ordered row of
up to 20 lanes, each holding one sample, the way a real comb leaves wells
empty. It opens as a workspace with the gel drawn tall on the left and an
inspector on the right for the selected lane or the running conditions.
Nothing is behind a Run button: the gel is re-simulated on every change.
Every change is an undo step. A gel has a kind: agarose for DNA, SDS-PAGE
for proteins (see [SDS-PAGE](#sds-page) under Proteins for the protein
side).

### Lanes

A lane is a ladder, a sequence (uncut, or cut with any enzymes; the digest
dialog's "Run on gel" starts a gel from the current digest), a PCR product
(a template and two primers from the primer library), typed-in band sizes
to compare against a real gel, or a protein. Lanes are worked directly on
the gel: click a lane to select it, drag wells to reorder, click the empty
well after the last lane to add one, hover a band to see what is in it, and
read the size at any height off the cursor line. Keyboard: Left and Right
pick a lane, Alt+Left and Alt+Right move it, Delete removes it, Insert adds
one.

Mass is tracked from the load (500 ng for a digest, 100 ng for a PCR, 50 ng
per typed band) down to every fragment, which gets the share of the load
its length is of the whole, so brightness on the gel means something.
Uncut circular DNA splits into forms with different mobilities: a clean
miniprep is 80% supercoiled, 17% nicked and 3% linear by default, with
other presets offered. A circular sequence cut once is one full-length
linear molecule. Sites that dam or dcm methylation blocks are skipped, by
the same rule as the cloning digest (see [Methylation](#methylation)), so
the two always agree. A PCR lane shows the product and, fainter (15% of its
mass, at most eight), any other product the pair could make.

The lane inspector lists every molecule in the lane with its size, form and
mass and its coordinates on the source. Rows and bands are linked (hover a
row to outline its band), a fragment can be found in its sequence with the
fragment selected, and a band can be cut out: the fragment opens as a new
sequence with its features carried over and its ends described, the way a
band is cut out of an agarose gel and purified.

### Migration model

Mobility relative to free DNA follows a sigmoid in log size:

```
r(L) = m + (1 - m) / (1 + (L / Lc)^alpha)
```

Small fragments slip through the pores and approach r = 1; large ones
reptate at a limiting mobility m, so everything above the resolution window
piles into a compression zone below the wells instead of spreading out. Lc
is the size the gel separates best: 1,900 bp at 1% agarose in TAE, falling
with the agarose percentage to the power 1.8 as the pores shrink. TBE
sieves a little harder (Lc scaled by 0.8), which is why it resolves small
fragments better. alpha is 1.25; m is 0.05 at 1% and shrinks with denser
gels. Agarose runs from 0.5% to 3%.

The run is timed by the bromophenol blue front, as it is at the bench ("run
until the dye is three quarters down"), which stands in for voltage x time.
The dye is a small molecule with a fixed relative mobility (0.9; xylene
cyanol 0.32), so the DNA size it co-migrates with falls out of the model:
about 350 bp in 1% TAE and 100 bp in 2%, matching loading-dye charts.
Fragments that would travel past the end of the gel have run off and are
listed as such. Three formats set the run length: mini (60 mm), midi (130
mm) and large (180 mm).

The parameters were tuned by eye against published ladder images and dye
co-migration tables. The model is approximate by design: good enough to
judge whether two bands will separate, not a substitute for a real gel.

### Bands

Each molecule lands at a distance from the well with a Gaussian spread, in
millimetres, from three sources: stacking out of the well (DNA entering the
gel stacks into a layer much thinner than the well, 0.18 mm sigma),
diffusion, which grows with distance and hits small fragments hardest, and
overloading, where a band holding hundreds of ng is visibly fatter (from
100 ng up). Molecules whose centres are closer than 1.6 mean sigmas merge
into one band, so 3,000 and 2,950 bp read as a single, brighter band, as
they would for real; the merged band's centre is mass-weighted and its
spread follows the law of total variance. Bands under 2 ng are below what
ethidium bromide shows and are drawn faint.

### Ladders

Each ladder band carries a mass. Most commercial ladders load roughly equal
mass per band, with one or two reference bands at about 2.5x to orient by
eye, and the built-in ladders follow that pattern for a 500 ng load;
they are representative, not any one vendor's datasheet. Lambda/HindIII is
a digest of a single molecule, so its fragments are equimolar and their
masses scale with size, which is why its 125 bp band is barely visible on a
real gel too. Protein ladders (the common 10-250 kDa and broad-range sets)
load about 2.5 µg.

### Looks and export

The gel is imaged through a look: UV with ethidium bromide, the same
inverted, blue light with SYBR Safe or GelGreen, or a schematic of flat
vector bands for figures. A look is a colour ramp from bare gel to
saturated band; exposure is adjustable from -2 to +2 stops. The canvas, the
high-resolution PNG, the SVG (labels, wells and schematic bands as real
vector shapes, a raster slab embedded as an image) and the PDF all paint the
same scene, so they cannot drift apart. A lane table exports as CSV, and
the PDF carries it under the image.

### Diagnostic digest designer

Given the sequences a sample might be (the clone you wanted, the empty
vector, the insert backwards), the designer finds the enzymes that tell
them apart on this gel. Every single enzyme and, optionally, every pair
from a pool (common 6- and 8-cutters, all 6-cutters, or every enzyme) is
tried on every candidate, and each digest is run through the same migration
and band model the gel draws, so "distinct" means distinct at this agarose
percentage and run length.

A design scores well when the candidates' band patterns sit far apart (the
smallest, over all pairs of candidates, of the largest gap between a band
in one lane and the nearest band in the other, a Hausdorff distance; under
1 mm is hard to tell by eye, 3 mm counts as fully distinct), when each
pattern is readable (at most seven bands, inside the gel's useful range,
none merged, none under 250 bp), and when it needs one familiar enzyme
rather than two. Pairs are only tried among enzymes that cut every
candidate at most four times, and no design may cut a candidate more than
eight times, which keeps a full 6-cutter search fast. With a single
candidate only readability counts: a clean confirmatory digest. Applying a
design lays the gel out for it (a ladder that fits, then a lane per
candidate) in one undo step. Isoschizomers that would do the same job are
listed with each design.

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
| Forbidden motifs | Enzyme groups (built in, or a saved enzyme set), individual enzymes, custom IUPAC motifs, and presets for Type IIS sites, internal Shine-Dalgarno, polyA signals, cryptic splice sites and E. coli promoter boxes. Checked on both strands. |
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

## Sequence Alignment

### Engines

Multiple alignment normally runs MAFFT 7.520, MUSCLE 5 or Kalign 3.3: the
biowasm WebAssembly builds kept in `wasm/` (see `wasm/README.md`), one job
per worker so a job can be cancelled. MAFFT runs as `tbfast`, which does
the pairwise stage, the progressive alignment and 16 rounds of iterative
refinement itself, with the three *-INS-i strategies the `mafft` script
offers: L-INS-i (local pairwise, best when sequences share one alignable
domain with unalignable ends), G-INS-i (global pairwise, for sequences
similar over their whole length) and E-INS-i (generalised affine gaps, for
several conserved domains separated by long unalignable regions). Kalign
detects DNA or protein itself.

"Automatic" uses the built-in pairwise aligner for exactly two sequences,
MAFFT L-INS-i when its estimated running time is 20 seconds or less, and
Kalign otherwise. The estimate comes from timing the WebAssembly builds on
one thread and is good to a factor of two or three: enough to warn before
starting something that will take minutes, which the dialog does.

Rows are sent to the tool renamed `s0`, `s1`, ... (names with spaces, odd
characters or duplicates can confuse the tools) and put back in input
order whatever order the tool writes them in. Every row is checked to have
come back with exactly its residues, so a tool that dropped or changed one
cannot slip a wrong alignment through. A fresh WebAssembly instance is
started for every run, which costs milliseconds against seconds of
alignment.

### The alignment viewer

An alignment is a document of its own: a stack of gapped rows that you own
and edit. A row is a copy; it remembers which sequence it came from, for
display, but editing it never reaches back into the source, and the source
changing never reaches into the alignment. "Extract row as sequence" is the
way out. Every row is the same length, and the document stays rectangular
with no gap-only columns at the right edge. How the alignment came to be
(the engine and strategy, or the file and format it was imported from) is
kept with it, for display and for "realign".

The grid draws names on the left, header tracks on top and residues in a
scrolling canvas; only the visible cells are painted. Display settings are
kept per alignment, outside its undo history (changing the colours is not
an edit), and saved with it:

- **Colour schemes.** Some colour a residue by what it is (Zappo, Taylor,
  nucleotides); others by its column: Clustal X colours a residue only where
  the column is conserved enough, percent identity shades by how many rows
  share it, BLOSUM62 compares with the consensus. Colours can fill the cell
  or the letter, and residues identical to the comparison row or consensus
  can be drawn as dots. The palette is blended into the theme's canvas
  colour, so one set of colours reads on light and dark themes.
- **Tracks.** Consensus (with a threshold from "most common residue" to
  unanimous), identity and similarity graphs, a sequence logo and Clustal
  conservation marks, all read off the column profile. Mean pairwise
  identity for a selection is computed from the column counts (the
  identical pairs in a column with counts c_k are the sum of C(c_k, 2))
  rather than by comparing every pair of rows, so the statistics stay
  linear in the selection's size and update on every edit.
- **Translation.** A DNA alignment can show a translation strip, or colour
  bases by the amino acid they encode. Each row is read from its own first
  residue in the chosen frame, skipping gaps, so a codon can straddle a gap.
  A gap run inside the coding stretch whose length is not a multiple of
  three shifts the frame for the rest of the row; those runs and internal
  stops are reported, since they are usually alignment or sequencing errors
  to correct.
- **Search.** A motif (IUPAC codes for DNA, X for protein) is searched in
  each row without its gaps, so a motif split by a gap is still found, and
  reported as the columns it spans.

Gestures: drag across cells to select a block, drag along the ruler to
select columns, click a name to select its row (Ctrl adds, Shift extends),
drag names to reorder, double-click a name to rename. The inspector shows
statistics for the selection (the whole alignment when nothing is selected)
and the actions that apply to it.

### Editing an alignment

Viewing is the default; Edit turns on direct editing. Type residues to
overwrite (or insert, with the Insert key), Space or `-` inserts a gap,
Backspace and Delete remove gaps or replace residues with gaps, and a
selected block can be dragged sideways to slide it through the gaps beside
it. Edits that make some rows longer pad the others with trailing gaps.
Every change is a named undo step.

### Adding sequences and realigning

Sequences (open sequences, Sanger reads as trimmed, or pasted FASTA) can be
added to an alignment in two ways. "Fit to this alignment" aligns each new
sequence to the alignment as a profile, the column residue frequencies,
and only inserts gap columns into the existing rows, so hand edits stay as
they are. Profile-sequence scoring is the expected substitution score
under the column's frequencies, with affine (Gotoh) gaps and free end gaps,
so a partial sequence (a read, a fragment, a single domain) lies where it
fits instead of being stretched across the whole alignment. "Realign
everything" runs an engine on all rows.

Realign also works on a selection: only the chosen block is sent to the
engine, as ungapped residues, and the result is spliced back in place, so
the rest of the alignment, including hand edits, is untouched. Rows with no
residues in the block are left alone.

### Alignment formats

Alignments are read and written as aligned FASTA (also A2M), Clustal (as
written by Clustal W/X/Omega, MUSCLE and MAFFT), PHYLIP (strict or relaxed
names, sequential or interleaved; files rarely say which, so the reader
tries each and keeps the first reading in which every row has the declared
length), NEXUS (the DATA or CHARACTERS block, with comments, quoted names,
interleaving, MATCHCHAR and polymorphisms; other blocks are skipped),
Stockholm (annotation lines skipped, first alignment only), GCG MSF (with
its checksum), MEGA (.meg; a distance matrix in the same extension is
refused with a clear message) and PIR/NBRF (also used for MODELLER). The
format is decided by the file's content first and its extension only when
the content does not say.

### Figures

Export the alignment as a figure: pick the region, the line width, the
tracks and the size, see it, then save SVG, PNG or PDF. Colours,
highlighting and translation follow the current view.

### Built-in pairwise algorithms

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

#### Built-in progressive MSA

The alignment worker also carries a progressive multiple aligner, used when
it is handed three or more sequences (the alignment tool itself sends three
or more to MAFFT, MUSCLE or Kalign):
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

## BLAST

BLAST Search (in the Analyse group, and from a feature's menu) sends the
whole sequence, the selection or a feature to NCBI BLAST and shows the hits
in the editor. It needs a network connection; nothing runs locally.

- **Programs and databases.** For a DNA query: megablast (fast, high
  similarity), blastn, blastx (translated query against a protein
  database) and tblastx; for a protein query: blastp and tblastn. The
  nucleotide databases offered are core_nt, nt, RefSeq RNA, RefSeq
  representative genomes, RefSeq Select and wgs; the protein ones are nr,
  Swiss-Prot, RefSeq protein and pdb. Opening the dialog from a protein
  switches to blastp against nr, and from DNA back to megablast against
  core_nt. The E-value threshold (10 by default) and the number of hits (25)
  can be set. Settings are remembered between searches.
- **How it runs.** The NCBI URL API's two-phase workflow: the search is
  submitted and answered with a request id (RID), then its status is polled
  every 15 seconds until it is ready and the result is fetched as JSON.
  Requests use URL-encoded form bodies so the browser sends no CORS
  preflight. A search still running after 15 minutes is given up on, with
  the RID shown so it can be looked up at NCBI.
- **Results.** A table of hits with accession, title, organism, E-value,
  bit score, identity and coverage; each hit expands to its HSPs with the
  aligned query, midline and subject. Checked hits can be added to the
  document as features over the aligned query range in one undo step. The
  last ten results are kept in the browser's localStorage and reopen
  without a new search.

---

## CRISPR Guide Design

Guides are found, scored and kept the way restriction sites are found and
cloning parts are kept: a scan over the open sequence, an overlay that draws
what it found, and a conversion into features for the ones worth keeping. The
Guides tab in the right sidebar holds the whole of it, and there is no Run
button: the settings are the scan.

### Nucleases are data

A nuclease is a record, like a restriction enzyme in `enzymes/db.ts`. It
carries its PAM as an IUPAC pattern, which side of the protospacer the PAM
sits on, the spacer lengths it accepts, where it cuts and whether it cuts at
all. Adding one is a row in `crispr/nucleases.ts`, and the same record can be
built from what a user types, so a PAM that was published this month can be
scanned today. The shipped set covers the SpCas9 family and its PAM variants,
the D10A nickase and a catalytically dead version for interference and
activation, SaCas9 and its KKH variant, St1, Nme and Cj Cas9, and the Cas12a
proteins with their 5' PAM and staggered cut.

Both cut offsets are stored as distances in bases from the PAM edge of the
protospacer, counted into the protospacer and onward, so they do not change
when the spacer length does:

| Nuclease | PAM | Spacer | Cut offsets | End |
|----------|-----|--------|-------------|-----|
| SpCas9 | NGG, after | 20 | 3 and 3 | blunt |
| SaCas9 | NNGRRT, after | 21 | 3 and 3 | blunt |
| Cas12a | TTTV, before | 23 | 18 and 23 | 5' overhang |

`cut.site` is the cut on the strand the protospacer is written on and
`cut.opposite` the cut on the other; the finder turns both into sense-strand
coordinates, reported as `cutTop` and `cutBottom` the way the enzyme finder
reports `fwdCut` and `revCut`. Anything that draws a break or measures a
fragment can then treat a nuclease and an enzyme alike.

A nuclease the user describes may leave both cut positions empty. That is not
a missing field but a claim withheld: the row finds sites and scores them, and
reports no cut, so nothing downstream pretends to know where the break is.

### Finding sites

The PAM is matched as an IUPAC pattern on both strands and the spacer is taken
from the side the nuclease expects it, which makes the scan linear in the
sequence length. A circular molecule is searched across its origin, so a site
spanning the origin is found once and its coordinates are wrapped back into
the sequence, with an end below its start as elsewhere in the app. On a linear
molecule a PAM with no room for its spacer is not a site and is left out,
while a site whose cut falls off the end is reported and flagged: the
recognition is real, nothing is cut.

A spacer holding anything other than A, C, G or T is not returned. It could
not be ordered and its scores would be meaningless, so the scan counts those
instead and the panel says how many, which is what makes an unfinished contig
explain itself rather than look empty.

A two-base PAM on a long sequence is effectively unbounded, so the scan stops
at a site cap and says that it did. The panel then suggests narrowing the scan
to the selection, which is the setting it already offers.

### Scoring, in three separate columns

A single figure of merit would hide which property a guide fails on, so three
kinds of claim are kept apart and sorted one at a time.

**The activity model.** What ships is a transparent heuristic over sequence
properties that are consistently reported to track SpCas9 activity: GC content
against an optimum of 55%, T at the four bases next to the PAM, which base sits
against the PAM, the first base of an NGG PAM, and penalties for a terminator
run, a long homopolymer and self-folding. It is not one of the published fitted
models. Those are regressions over thousands of measured guides with a fixed
window of flanking sequence, and their coefficients belong in a data file; the
model registry in `crispr/score/ontarget.ts` exists so such a table can be
added as data and selected per nuclease without touching the finder or the
panel. Because the number is a heuristic, every term is returned with its
contribution and the inspector shows the arithmetic.

Only the SpCas9 family carries a model. Every other nuclease reports no score
rather than borrowing one fitted for a different protein, which would read as
information while being noise.

**The repair outlook.** End joining often uses a short identical stretch on
either side of the break, deleting what lies between the two copies and keeping
one. Which deletions are available is a property of the sequence, so it can be
predicted, and the share of them that shift the reading frame is the most
useful single number when the goal is to knock a gene out. Following Bae and
colleagues, every pair of identical stretches flanking the cut within a
40-base window is enumerated and scored

```
pattern = 100 * exp(-deletionLength / 20) * (length + gcCount)
```

so short deletions and GC-rich microhomologies dominate, and the out-of-frame
score is the share of the total carried by deletions whose length is not a
multiple of three. Pairs are enumerated once per deletion length by walking the
diagonals of the comparison, which counts each maximal microhomology a single
time rather than once per nested copy of it. The formula is implemented as
published; the tests check its invariants, not numeric agreement with the
authors' own tool. A cut too close to the end of a linear molecule returns
nothing rather than a number from a short window, and above a cap of 2000 sites
the prediction is left out of the batch and made for the selected site alone.

**The flags.** Properties of the sequence that hold whatever the nuclease, each
reported as a named chip with a sentence of detail: GC outside 35% to 75% (and
badly outside 25% to 85%), four or more T in a row, which reads as a terminator
and cuts a transcribed guide short, a homopolymer of five or more, a
self-folding stem of seven bases or more, and the promoter's start base, where
U6 transcribes best from a G and T7 from two. The last is a note rather than a
fault: the usual answer is to order the guide with the extra base added.

### Off-target search

A guide is only as good as the places it does not bind, so the panel can take
a finished spacer and look for near copies of it next to a usable PAM. The
search is the site finder run the other way round: PAM positions first, which
is cheap, then the spacer compared from its PAM-proximal end outward so a
site that cannot qualify is abandoned after a few bases.

**What is searched is always named.** The app ships no genome. Pretending
otherwise would be the worst thing this feature could do, because a
specificity score from a 5 kb plasmid reads exactly like one from a
chromosome. The scope is the first control in the section, not a buried
setting, and every result carries the names and the total size of what was
read back to the panel, which prints them under the count. Three scopes: the
open sequence, every open sequence, or a FASTA file (one record or many)
loaded for the purpose, up to a size the page can hold.

**Mismatches and unpaired bases.** The budget is up to six mismatches.
Bulges, meaning one unpaired base in the target or in the guide, are off by
default because they multiply the work, not because they do not happen; with
them on, each PAM position also gets a comparison at one base longer and one
base shorter, with the gap position enumerated so the result stays exact
rather than heuristic. Weaker PAMs are a separate switch: the SpCas9 rows
carry NAG as an alternative, which is searched only when asked and scored
down when found.

**Scoring is a heuristic, for the same reason the activity model is.** A
mismatch leaves most of the site's activity when it falls at the far end of
the spacer and almost none when it falls against the PAM, so each mismatch
multiplies the site's score by a factor interpolated between the two:

| Where the mismatch falls | Factor |
|--------------------------|--------|
| against the PAM | 0.08 |
| at the far end of the spacer | 0.85 |
| an alternative PAM, whatever the mismatches | 0.2 |
| an unpaired base | 0.25 |

The line between the two ends is deliberately straight. The real profile is
bumpy and sequence-dependent, and smoothing it is more honest than inventing
the bumps. A fitted table belongs in a data file beside the model, exactly as
for the activity model.

The aggregate takes the shape the field uses: a guide with nothing else to
bind scores 100, and the score falls as credible hits accumulate.

```
specificity = 100 / (1 + sum of hit scores)
```

**The guide's own site is not one of its off-targets**, so it is excluded and
counted separately. A second perfect match elsewhere is reported, and marked:
a spacer that matches two places exactly cannot tell them apart.

**What a hit lands in matters as much as how many bases differ.** When the
target is a document with features, the smallest feature covering the hit is
named on the row, and one in a coding feature is marked. Each hit is drawn as
two lines, the spacer and the site under it with matching bases as dots, so
the mismatches are the only letters there are to read.

The search runs in the worker, reports progress target by target, and can
cover several guides in one pass, since the targets are read once either way.

### What the views draw

In the sequence view a guide is a stand-in annotation in the feature lanes,
the way a primer binding site is, so it rides the existing stacking, hover and
hit-testing. Its footprint is the protospacer plus the PAM, so the PAM has room
in the lane rather than being drawn over its neighbour. Within that footprint
three things are drawn in order of prominence: the protospacer as a bar with
its arrowhead at the 3' end, the PAM as a solid block in its own shade, and the
cut as a tick through the bar. A staggered cutter gets two ticks joined across
the middle, which is what makes an overhang visible without reading a number.
Picked guides are outlined in the accent colour, as picked ORFs and motifs are.

On the plasmid map only the cut is drawn, as a tick outside the backbone with a
dot at its end and a shorter companion tick for the second cut of a staggered
pair. A 20-base arc on a plasmid-wide circle is a smudge; the cut is what a map
is read for, and the protospacer is there in the rings once it is a feature.
Clicking a tick selects its protospacer.

Above the candidate list is a strip dividing the sequence into as many buckets
as the strip is wide, each drawing its best candidate, coloured by the worst
flag that candidate carries. A table of a thousand rows hides whether the
candidates cluster and where the gaps are, which is the one thing the eye is
good at.

The colours are theme tokens (`--canvas-guide`, `--canvas-guide-pam`,
`--canvas-guide-cut`), defined for all ten themes and read through
`readSequenceColors`, so the print palette picks them up as it does the rest.

### Designing for a goal

Finding sites is the start of the job, not the job. The panel's tasks each
take the same scan and turn it into the answer to one question, so switching
between them costs nothing and nothing is scanned twice.

**Knock out.** A cut anywhere in a gene is not equally useful. Too near the
start codon and translation can restart past the damage; too near the stop and
a frameshifted protein keeps almost all of itself. So guides are ranked by
where they cut along the coding sequence, measured by walking the exons in
translation order rather than by subtracting coordinates, and each row says
which codon it cuts in and how much of the gene lies behind it. The ranking is
lexicographic, not a weighted sum, for the same reason the score columns stay
apart:

1. cuts inside the preferred stretch, 5% to 65% of the gene by default
2. no disqualifying flag
3. the out-of-frame share, when it is known
4. the activity score, when the nuclease has a model
5. earlier in the gene

**Delete.** Two cuts, one each side of a region, and the ends join. A pair is
judged on what it costs beyond the region asked for, so the overshoot on each
side is the first number on the row and the junction the join would leave is
next to it. Opening the result builds a real document: the bases with the span
gone, every feature moved, features wholly inside the deletion dropped, ones
that straddle it kept and marked truncated as elsewhere in the app, and a mark
at the join.

**Knock in.** A donor is the payload with a slice of the original sequence on
either side, which is not the interesting part. The interesting part is
whether the nuclease can still find its site once the repair is done. So the
donor is built, then scanned, and only then edited:

- if the payload broke the site, nothing is changed and the panel says so
- otherwise one base is changed to stop the repaired copy being cut again,
  preferring the PAM over the seed, since breaking the PAM stops the nuclease
  binding at all
- inside a coding sequence a change that leaves the protein alone is preferred,
  and when none exists the panel names the codon that changes
- the edited donor is scanned again, so the claim that it cannot be cut is
  checked rather than asserted

Arms default to 40 bases either side and can be made asymmetric, which doubles
the arm on the far side from the PAM.

**Base edit.** A base editor changes every base of its kind inside a short
stretch of the protospacer, so the bystanders are the whole difficulty and
they are listed, not summarised. Positions are counted the way the literature
counts them, from the end of the protospacer away from the PAM. Four editors
ship, two cytosine and two adenine, with their usual windows; the window is
editable, since a construct in hand may differ. When the chosen target base
falls in a gene, every edit in the window is given its codon consequence,
marked silent, missense or nonsense, and guides are ordered by how few
bystanders they bring.

**Tile.** A greedy pick down the quality order with a spacing rule, which is
what gives even coverage instead of the cluster you get by taking the best few
guides in a region. The gaps are reported as plainly as the picks, since a gap
is what a tiling set is judged on, and the set copies out as a table or
becomes features in one step.

Every task works from the selection or from a feature of the document, chosen
the same way, and the inspector and the off-target search stay available
throughout.

### Prime editing

A pegRNA is an ordinary guide with a tail: after the scaffold comes a template
for the edit, then a short stretch that pairs with the nicked strand and
primes the copying. The tail reads as the reverse complement of the strand
that will be made, which is the part that is easy to get backwards, so it is
built once and shown in its three pieces.

In the protospacer strand's own frame:

| Piece | What it is |
|-------|------------|
| nick | where the nickase cuts, three bases in from the PAM for SpCas9 |
| primer site | the bases just before the nick, reverse complemented |
| template | the edited sequence from the nick onwards, reverse complemented |
| pegRNA | spacer, then scaffold, then template, then primer site |

The edit is given as a span to replace and what to put there, which covers a
substitution, an insertion and a deletion without three cases. An edit behind
the nick is refused rather than fudged: the template is copied forwards, so a
change behind it cannot be written, and the panel says which way round the
guide needs to be.

The second nick of the paired strategy is offered from the same scan,
filtered to guides that nick the other strand within a band of distances,
which is a rule of thumb and therefore a setting.

### Ordering

Four shapes, because that is how guides are made: two annealed oligos into a
cut vector, a template to transcribe, a synthetic RNA, or a pegRNA's own
longer oligo. Every base the app adds is shown as an addition rather than
folded into the sequence, since the additions are where mistakes live: the G
a U6 promoter wants and only when the spacer does not already start with one,
the overhangs the vector wants, the promoter in front of a template.

**The scaffold is a vector's property, not a target's.** It is chosen in the
library view, where opening one shows its sequence and its length, since the
section asks you to check it against the plasmid on your bench and that
cannot be done without reading it. What ships is deliberately short: a scaffold is a long constant that is easy to print
wrongly and impossible to notice wrongly, so only the near-universal ones are
shipped, each saying what it is, and for anything else the panel asks for the
sequence from the plasmid in hand and keeps it. A scaffold that was never
typed is better than one that is almost right. The same reasoning applies to
the vector overhangs, which are presets that can be read and changed rather
than something guessed from a vector name.

### Screening

Decided with the order, not after it, because a guide that cannot be screened
cheaply is worth knowing about before the oligos are bought.

- **An amplicon across the cut**, designed through the ordinary primer
  designer, with the cut kept well away from both primers so a trace can be
  read through it and a small indel still shows.
- **A restriction site the cut sits inside.** An edit at the break disturbs
  the site, so the amplicon from an edited copy is no longer cut and two bands
  become one. The site has to be unique in the amplicon or an uncut band means
  nothing, so enzymes cutting it more than once are left out, and the ones
  whose site the cut falls nearest the middle of come first.

When no enzyme qualifies, the panel says so: that guide needs sequencing
rather than a gel.

### Reading the result

The last question is whether it worked, and it is answered from whichever
evidence came back from the bench. Two routes, one result.

**From two chromatograms.** An edited pool is a mixture: most molecules carry
one of a handful of small insertions or deletions and the rest are untouched,
so downstream of the break the trace is the same sequence read at several
offsets at once. That looks like noise and is not. Given the same amplicon
from an unedited control it can be taken apart:

1. The two traces are lined up on their base calls before the cut, where they
   should be identical, and the agreement is reported. If they disagree the
   comparison is not valid, and the panel says so rather than fitting anyway.
2. Over a window after the cut, one column is built per candidate offset from
   the control, and the edited signal is fitted as a non-negative mixture of
   them. Non-negativity is not a refinement here but the thing that makes the
   answer mean anything: a mixture cannot have negative parts, and an
   ordinary least-squares fit happily returns them. The solver is the
   active-set method of Lawson and Hanson.
3. The mixture is reported as a spectrum of length changes with their shares,
   the share that shifts the reading frame, and the quality of both fits.

What it cannot do is separate two different edits of the same length, or say
which allele is which. It reports lengths and shares, which is what a trace
can support.

**From amplicon reads.** Each read is aligned to the amplicon and judged on a
window around the break: the reference, an insertion, a deletion, a
substitution, or the donor that was supplied. Reads that agree are one
allele, and the table of alleles with their shares is the result, alongside
the spectrum and, for a base editing run, how often each position in the
window reads as something else.

Two decisions are worth stating. The window is narrow and centred on the cut,
because a change at the far end of an amplicon is a sequencing error or a
polymorphism rather than an edit, and counting it as one inflates every
number. And a read that does not span the whole window is not counted at all
rather than counted as unmodified, since a read that stops inside the window
cannot speak for the rest of it. Both counts of discarded reads are reported.

Alignment is accurate and not cheap, so a run takes a sample of a large read
set rather than the lot, and says how many reads it looked at and how many
the set holds.

### The guide library

Guides you keep, like the oligo library and in the same shape. A guide saved
once is yours across every document, and the useful question about it later
is not what it scored when you designed it but whether it binds the sequence
in front of you now, so each row says where it binds here, or that it does
not. Scores are shown as what they were when the guide was kept, because a
number recorded in March is not a measurement made today.

### Keeping a guide

A converted guide becomes a `misc_binding` feature over the protospacer alone,
not the PAM: the spacer is the part you order and the part that binds, while
the PAM belongs to the target, so a feature over it would claim the nuclease
recognises DNA it only reads from. The PAM and both cut positions go in the
note, which is what a GenBank round trip keeps. The inspector copies the
spacer without the PAM for the same reason.

### Limits

The off-target search reads what you give it and nothing else, and both the
activity model and the mismatch model are stated heuristics rather than fitted
tables. The knock-in donor changes one base at most to stop re-cutting; a site
that survives every single change is reported rather than worked around.
Scaffolds and vector overhangs are shipped only where they are near-universal,
and are otherwise asked for. Reading a result back decomposes a trace or
counts reads; it does not genotype a plate of clones well by well, and an
analysis is held for the session rather than kept as its own item, so it is
copied out as a table rather than saved. Trace decomposition cannot tell two
edits of the same length apart.

---

## Cloning

A cloning design is an explorer item that says what goes in, how it is
joined and what to call the product, for one of five methods: restriction
cloning (cut each part at the sites you click on its map, and ligate the
ends), Golden Gate (Type IIS enzymes cut beside their sites, so parts join
seamlessly in one pot), seamless assembly (HiFi, Gibson, In-Fusion, SLIC:
parts join on shared ends, in any order), Gateway (recombine a cassette
between att sites into a destination vector) and TOPO (topoisomerase joins
a PCR product straight into a ready-cut vector).

The design is what gets saved; results never are. Nothing is behind a
Simulate button: the design is re-run on every change, so the product, and
the reason there is not one, are always in front of you, and a fix to an
engine reaches every old design the next time it is opened. Each part
carries a snapshot of its sequence with a short fingerprint: a design that
only pointed at its sources would silently change, or break, when one was
edited or deleted, whereas one that keeps a copy can say "this source has
changed since, refresh?" and leave the choice to you. A part is a whole
sequence or a stretch of one (a stretch is a linear piece, whatever the
sequence was), with a role (vector or insert), an orientation (either way
round, forward only, or reverse only) and, for restriction cloning, whether
its ends were dephosphorylated. Every change is an undo step.

The workspace shows each part as the same plasmid map the sequence view
draws: one tab per part, plus one for the product, modelled on SnapGene's
Insert Fragment dialog. On a part's map you click the sites to cut at; the
product tab draws what comes out, with each part's contribution marked on
the backbone in that part's colour.

### Each part is cut on its own

Every part carries its own enzymes, chosen by clicking its sites. A part with
none of its own is cut with the design's enzymes, so the common case (cut
vector and insert with the same pair) is still one list. Cutting per part is
what makes compatible-end cloning possible: a vector opened with BamHI takes
an insert cut with BglII, because the two leave the same four-base 5'
protrusion, and a vector cut with EagI takes a NotI fragment for the same
reason. One shared list cannot express that, since BglII would then also be
used on the vector.

The first click cuts at a site, a second cuts at another as well (two cuts
take out the piece between them), and a third starts again from the site just
clicked. Shift+click adds a site regardless, for a three-enzyme digest.
Clicking a chosen site stops cutting there.

A site stands for its enzyme, not for one position: a digest cuts everywhere
that enzyme binds, so choosing one site marks every site of that enzyme as
chosen, which is what will happen in the tube.

### Which sites a map offers

The map shows every enzyme that cuts that part exactly once, which is the set
someone deciding where to open a vector looks at first, plus every enzyme the
design names, wherever and however often it cuts. The single cutters are the
commercially available enzymes with a recognition site of six bases or more
that cut inside or beside it, one name per specificity, preferring the name
people clone with: Type IIS enzymes are left out, because they cut away from
their site and are chosen deliberately for Golden Gate rather than found by
browsing. Neoschizomers stay separate, since enzymes that read the same site
but cut it differently leave different ends. A site the host's methylation
blocks is still drawn, faded, so the reason it cannot be used is visible
rather than the site simply being absent.

### Which piece goes into the reaction

Clicking the molecule away from a site chooses which piece of the digest is
used. Without a choice it follows from what the part is for: a vector gives
its longest piece (cut twice, that is the backbone, and the short piece is
what the insert replaces), an insert being taken out of a donor plasmid gives
its shortest (the long piece is the donor's own backbone, which is discarded),
and a linear insert gives its longest, since its ends are only the few bases
outside the sites.

### The reaction strip

Under the maps, each piece is drawn with both strands written out at each end,
as on a bench sheet, then the product. An end is green when it pairs with an
end of another piece, amber when it pairs only with its own piece's other end
(so that piece will close on itself) and red when it pairs with nothing, which
is usually the whole explanation for why a design gives no product.

### The product keeps the vector's numbering

A circular product of a cut-and-ligate reaction is rotated so that the
vector's first base is the product's first base, which is what SnapGene does
and what makes the coordinates upstream of the insertion unchanged. The
rotation moves bases, features, part spans and junctions together; a feature
that now runs across the origin ends below its start, as elsewhere in the app.
It is skipped when the vector's own first base was cut away or the vector went
in reversed, since then there is no base 1 to keep.

### Ends and ligation

A cut leaves a single-stranded protrusion on one strand. An end's kind is
which strand that is (a 5' end when the protruding strand's 5' end is at
this end of the molecule, 3' otherwise, or blunt), and its bases are always
written 5' to 3' along the strand that protrudes. That is the one
convention under which an end reads the same whichever way round you hold
the molecule, so flipping a fragment leaves both ends untouched, and it
makes annealing the ordinary base-pairing test: two ends meet when one's
bases are the reverse complement of the other's. Writing both ends as
top-strand bases instead, which is tempting since that is where they come
from, would make annealing an equality test and silently restrict ligation
to palindromic overhangs. An ambiguous base in an end (N, or any IUPAC
code) means the ends cannot be said to pair, so they do not.

Each side of a junction supplies the phosphate for one of its two nicks. A
junction with neither phosphate (two dephosphorylated ends) does not hold
together at all; one with a single phosphate leaves a nicked product,
which still transforms, since the cell repairs it. A fragment's top strand
carries the bases it contributes at each junction, so the product's
sequence is the parts' top strands concatenated, with nothing to add or
trim, and digesting a sequence and concatenating the pieces back in order
returns the original.

Fragments are tried in both orientations, since an insert with two
compatible ends goes in either way round and the wrong way round is a real
product people get. A path of fragments whose touching ends anneal is a
product: circular when the last end meets the first, linear otherwise.
Products are deduplicated up to rotation and listed best first.

### Seamless assembly (HiFi, Gibson, In-Fusion, SLIC)

NEBuilder HiFi, Gibson Assembly, In-Fusion and SLIC all do the same thing:
chew back one strand at each end, let the single strands anneal over a
shared stretch, fill in and seal. So one engine runs all of them, and a kit
is only a set of expectations about the shared stretch, taken from the
suppliers' own guidance:

| Kit | Overlap searched | Ideal | Worth a look above | Overlap Tm | Mismatches repaired |
|-----|------------------|-------|--------------------|------------|---------------------|
| NEBuilder HiFi | 15-60 bp | 25 bp (30 bp from five fragments) | 40 bp | not required | 2 |
| Gibson Assembly | 15-60 bp | 25 bp | 40 bp | at least 48 °C | 0 |
| In-Fusion | 15-40 bp | 15 bp | 25 bp | not required | 0 |
| SLIC / CPEC | 20-100 bp | 30 bp | 80 bp | at least 50 °C | 0 |

HiFi's polymerase and ligase tolerate a mismatch or two and it wants a
longer overlap for more than a few fragments; classic Gibson leans on the
overlap melting above the 50 °C assembly temperature; In-Fusion works at
room temperature, so the overlap only has to be long enough; SLIC anneals
without an exonuclease mix, so it wants a long, strongly melting overlap.
The melting temperature of each junction's overlap is reported with the
product.

Two things a plain "does A's tail match B's head" search cannot do, and
that people need constantly:

- **A circular part has no ends.** Hand it a plasmid and an insert carrying
  arms, and the plasmid is opened where the arms land: arms that sit next
  to each other give a clean insertion, arms flanking a stretch delete it.
  Nobody has to linearise a vector by hand first. Two circular parts have
  no fixed end between them at all, so they are left alone, and an arm that
  could land in more than one place on a circle is reported as ambiguous.
- **Order and orientation are found, not assumed.** Every part is tried
  both ways round, and the order comes out of which overlaps exist rather
  than the order the parts were listed in. The longest part is never
  flipped: any assembly that needs it the other way round is the same
  molecule read on the other strand, so nothing is lost, and the product
  comes out in the backbone's frame.

The overlap search anchors on an exact 12-base seed at the 3' end of the
arm, where annealing starts, then checks the rest with the kit's mismatch
allowance. A clean match always beats a longer one with a mismatch in it,
and only then does the longest win: preferring length first would make the
result depend on which way round the pair was searched, since where the
strands disagree the product takes one part's bases over the other's, and
the two searches would pick different parts. Mismatch tolerance is for arms
that really do disagree (a silent mutation left in a primer), not for
extending a good overlap. A single linear part whose own ends share
homology closes on itself, provided the arms are at most half of it. The
search over orderings is capped at 100,000 chain extensions.

Each part contributes the stretch from where its incoming overlap starts to
where its outgoing overlap begins, so every shared stretch is written once.
Features are read from a window widened by the outgoing overlap, so a
promoter or a CDS ending at an arm keeps its real extent instead of being
clipped at a junction drawn an arbitrary few bases to one side. Homology
between parts that are not meant to meet is reported as a warning: those
arms anneal too, and the assembly that comes out is not the one that was
drawn.

### Golden Gate

Every part is cut with the design's one Type IIS enzyme, as it would be in
the pot. A piece that still contains the recognition site is a backbone
piece and is discarded; the rest are the inserts. Inserts join where one's
3' overhang is the partner of another's 5' overhang, so the engine builds a
graph of compatible ends and walks it for circular products (Golden Gate
produces circular products), deduplicating rotations. The expected product
is a circle using every insert exactly once. Overhangs that read the same
on both strands, or appear on more than one fragment end, are warned
about, since the first will ligate to itself and the second makes the order
ambiguous, and ends that match nothing are listed.

### Overhang fidelity

A Golden Gate reaction is only as specific as its overhangs. T4 ligase will
join a pair that does not quite match, and when two overhangs in the set
are similar enough the reaction quietly assembles parts in the wrong order.
The published ligase fidelity work (Potapov et al. 2018, Pryor et al. 2020)
measured this: mismatches near the middle of a 4-base overhang are far
more disruptive than at the ends, and G:T wobbles are tolerated best of
all. SeqNexus uses a model of that behaviour rather than the measured
matrix, which is a few hundred thousand numbers; it reproduces what the
matrix is used for, which is ranking candidate sets, flagging the pairs
that will cross-react, and picking a set that will not.

- **Mispairs.** How readily each mispair forms, relative to a correct pair:
  G:T and T:G 0.30 (by far the most common off-target ligation); A:C 0.08;
  A:G 0.06; C:T 0.05; A:A and T:T 0.03; C:C and G:G 0.02. Two mismatches
  essentially never ligate, whatever they are.
- **Position.** A mismatch costs most where the duplex is held together:
  the weights across the four positions, from the ligated end inwards, are
  0.55, 0.12, 0.12, 0.55 (so a mismatch at the very end of the duplex barely
  registers and one in the middle stops the join).
- **Pairs and sets.** Every overhang is present at two ends in the
  reaction, so there are two ways a pair can go wrong (one overhang against
  the other, and one against the other's partner), and a pair's risk is
  the worse of them. The fidelity of a set is the share of ligation events
  that join the intended partners: correct joins over all the joins that
  could happen. Above about 0.95 a set assembles cleanly. The score, the
  riskiest pairs and plain-language notes are shown with the design.
- **Choosing a set.** When a design needs new overhangs, they are chosen
  greedily: start from whatever the design already fixes, then keep adding
  the candidate that cross-reacts least with everything chosen so far,
  within 25-75% GC, without three or four of the same base, and never the
  complement of a chosen overhang (that is the partner it is meant to meet).
  That is how the published high-fidelity sets were derived, and for the
  handful of overhangs a real assembly needs it gets within a hair of the
  best possible.

### Gateway

Three reactions: BP (attB x attP gives an entry clone with attL sites and
a byproduct with attR), LR (attL x attR gives an expression clone with attB
and a byproduct with attP) and MultiSite (two or three entry clones and a
destination vector). att sites are found by matching the roughly 25 bp
core recognition sequences of attB, attP, attL and attR, numbered 1 to 4
for MultiSite (from the Invitrogen Gateway manual and Hartley et al.
2000), on both strands with up to two mismatches, exact matches preferred
and overlapping matches of the same type deduplicated. In a real
recombination the full sites include flanking arms; the core is enough to
identify them.

The product's att sites are taken from the site table (attL is what attB x
attP leaves behind), since the arms that actually cross over lie outside
the cores stored here; the flanks on either side are the real parents'
sequence. The byproduct carries off the cassette the donor or destination
vector gave up, the ccdB counter-selection marker, which is why only the
product grows. Sites may sit on the bottom strand (an entry clone's sites
are often cloned in reverse, so the cassette is read backwards and goes in
reverse complemented, with its features turned round) and the cassette or
the backbone may run across the origin of a circular source; both are
handled. Two sites recombine as a pair only when they sit on the same
strand. For MultiSite, each entry clone must have exactly two attL sites
(when similar sites overlap, the two most separated with the fewest
mismatches are taken), and the sites must chain: attR1 to the first
entry's left site, each entry's right site to the next entry's left, and
the last to attR2.

### TOPO

Three variants: TOPO-TA (3' A overhangs on the PCR product, as Taq leaves
them), TOPO-Blunt (proofreading polymerases) and Directional TOPO (a 5'
CACC clamp on the insert enforces the forward orientation). Commercial TOPO
vectors are supplied linearised with topoisomerase I covalently bound at a
single CCCTT site, so the insertion point is found by that motif: a linear
vector is taken to be cut at its ends (with the motif expected within 30 bp
of one of them), and a circular one is scanned for CCCTT, preferring a site
near an annotated MCS, lacZ or other cloning feature when there are
several. For Directional TOPO the site whose next bases are the clamp's
partner is preferred.

The insert's ends are checked for the variant. A-overhangs are added by Taq
during PCR and are typically not in the designed sequence, so for TA they
are informational; a blunt insert that looks TA-compatible gets a warning;
a directional insert without CACC is reported. TA and blunt inserts go in
either way round, so both products are reported, forward first; the
directional product is forward only. In the directional product the
insert's CACC and the vector's four-base overhang are two strands of the
same four base pairs, not two stretches to be put end to end, so those
bases appear once: the clamp is kept, since it is part of the finished
construct and the translation context downstream of it depends on it, and
the vector's matching bases are consumed. A circular vector is opened at
the site, takes the insert and closes again with its origin kept at base
1.

### Methylation

dam puts N6-methyladenine on the A of GATC and dcm 5-methylcytosine on the
inner C of CCWGG; both motifs are palindromic, so each is methylated on
both strands. A methyl group only gets in an enzyme's way where it sits on
a base the enzyme reads, so a site is dropped only when a methylated base
of an overlapping motif lies inside its recognition sequence; a motif
merely nearby changes nothing. The sites so blocked are still drawn on the
part's map, faded, so the reason a site cannot be used is visible. The
same rule serves the cloning digest and the virtual gel, so the two always
agree, and a product inherits its backbone's methylation status, since it
is grown in the same strain.

### What the reaction gives

Every method reports the same thing, a list of products best first, so the
workspace shows a product the same way whichever reaction made it. The
intended construct is the circular product that uses every part once and
that the enzymes leave alone; it comes first, as one card that says what
it is. Everything else a real tube would also contain is folded away
beneath it, each named for what it is ("pUC19 closed on itself") rather
than by a second copy of the same name: knowing the vector will mostly
religate is worth something, but it should not crowd out the construct.
With "purified" on, only the chosen fragment of each digest is in the tube;
otherwise everything the digests produced is, which is what shows the
off-target products.

When the construct does not form, the panel says why and offers up to
three single changes that would make it form, tried in order of how small
a change they are: another fragment of the same digest, or a different
digest (the enzymes people clone with, pairs preferred since two enzymes
clone directionally, or a Type IIS enzyme for Golden Gate). Every fix
offered has been tried: the design is re-run with it, and only changes
that give the construct are suggested.

### Junctions

The seam is where cloning goes wrong quietly: a frame slips by one base, a
site survives that should have been cut away, an overhang is a base short.
None of that shows in a product's length, so the junction inspector draws
the bases either side of each junction on both strands, marks which part
each came from, and says whether the reading frame carries across. A
junction records how it was joined, by annealed ends or by a shared
stretch (with its melting temperature), so the product can be read
whichever reaction made it.

### Oligos to order

For the methods whose parts are amplified, the Oligos tab lists the primer
pair for each part: a binding half sized by the app's own primer designer,
so these oligos melt where the rest of its primers do (see
[Primers](#primers)), and a 5' tail carrying what the method needs.

- **Seamless assembly.** Each part's forward primer carries the tail end of
  the part before it, and its reverse primer the start of the part after
  it, reverse complemented since a reverse primer is written along the
  bottom strand. Together that gives every junction one shared stretch,
  contributed half by each neighbour. The length is the kit's ideal
  overlap, or its longer target when the design has many fragments.
- **Golden Gate.** Each primer's tail is the recognition site pointing into
  the part, a spacer so the enzyme cuts where it should, and the four-base
  overhang that decides where the part goes. The sites end up outside the
  product and are lost with the cut, which is why the assembly is seamless
  and one-pot.

Nothing here changes the design: it says what to order to build it. The
recombination methods join sequences you already have and need no oligos.

### Verifying the construct

A clone is confirmed at its junctions: the rest of it came from sequences
that were already known, but the seams are where a reaction goes wrong. So
the verification plan is one sequencing primer per junction, reading across
it, looked for in a window that ends a lead distance before the seam, so
the seam lands in the clean middle of the trace rather than in the first
fifty bases, which are never readable. Among the candidates, the one whose
read covers the seam with the most to spare either side wins. Near the end
of a linear product there may be no room upstream, and a junction with no
usable primer is reported rather than quietly skipped: it is the one place
you most need to see. The primers are the ones the primer designer would
make for sequencing (see [Primers](#primers)).

### Libraries

A library is the same design with alternatives at one or more positions.
Each position is a bin (a vector, a promoter, a set of coding sequences),
and every way of taking one part from each bin is a combination that goes
through the ordinary engines; a vector against a list of inserts is the
two-bin case of the same thing. Combinations are run one at a time in the
cloning worker rather than all at once, so a long run reports progress and
can be stopped: a few hundred constructs is normal, and each one is a full
assembly. A rough estimate of the work warns before a big run.

Parts can be read from a spreadsheet, since a library is usually already
written down as one: a CSV or TSV with a `sequence` column and a `bin`
column saying which position each part belongs to. Bins come out in the
order they first appear, so the file's own order decides the order of the
assembly, and a row with no bin goes into one named after itself, which is
what a plain list of inserts should do. The product names follow a
template. What comes out is a table with a row per construct and a column
per position (did it form, is it ambiguous, its size), exported as CSV, and
the constructs themselves as multi-FASTA for ordering or handing on.

### Limits

- Seamless assembly leaves two circular parts alone, since there is no
  fixed end between them, and searches overlaps only up to the kit's
  maximum.
- Gateway matches the att cores only, so a site whose core carries more
  than two mismatches is not found.
- TOPO relies on the CCCTT motif; a vector whose topoisomerase site is
  elsewhere needs the insertion point chosen by hand.
- The ligase fidelity score is a model of the published matrix, not the
  matrix itself, and a set it calls clean is a prediction, not a
  measurement.

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

### Plates of clones

A plate of clones, each sequenced with two or more reads, is assembled in one
run: one assembly with a contig per clone, every clone verified at once.

**Grouping by name.** The clone is written into each read's name, with what
tells its reads apart after it (`A03.1` and `A03.2`, `pX12_M13F` and
`pX12_M13R`, `Achl_ACHLO006-09_1_F` and `Achl_ACHLO006-09_2_R`). A name
is split at a separator (underscore, hyphen, full stop or space) and the
clone is its first n parts, or all but its last n, as Geneious's "Assemble
by name" takes a delimiter and a part. The grouping is suggested from the
names: every separator and choice of up to four parts is tried, and each
read in a clone of two or more counts, up to four per clone, the shape of a
plate read from both ends (or with a primer walk). One clone holding every
read, or clones of one read each, score little. A name with too few parts is
a clone of its own rather than a guess. The Assemble dialog shows each
read's clone in its reads table as the grouping is changed, and marks clones
left with a single read.

**Several references.** Mapping, all reads of a clone go to one reference,
the one they match best: a clone is one construct, and letting each read
choose would split a clone whose reads cover different parts of
near-identical designs. Each read is seeded on both strands against every
reference (k-mers of 12, as in mapping) and its best diagonal's votes are
summed per reference. A read across the junction of a shared vector and its
insert lines up on one diagonal only in the construct it came from, so the
insert decides. When other references come within a fifth of the best
one's votes, as point mutants of one design do, the clone is mapped to each
of them and the one its reads agree with best is kept (a matching base
counts one, a mismatch or a gap costs two): seeds cannot tell designs a base
or two apart, an alignment can. A clone with no seed on any reference is
listed with the reads not placed. Without grouping, each read goes to its
own best reference and the reads of each reference make one contig, as
Geneious maps to several references. De novo, each clone is assembled on
its own, so reads of two clones are never joined however alike they are.
The dialog ticks the open sequences (up to 200 kb) that at least one of the
first 24 reads seeds well on (20 votes, about 30 matching bases), and the
first open sequence when none matches.

**The reference goes with the contig.** A contig keeps a copy of its
reference's features when it is mapped, so its feature track, variants and
verification still work after the reference is closed; while the sequence
is open its own features are used, since they may have been edited.

**Verifying the plate.** The assembly's overview lists the clones with the
clone verification verdict (`assembly/verify.ts`, as for one contig): verified when every
feature checked is covered from end to end and the reads' consensus matches
the design there, differences found, or not fully covered; with the share
of the construct covered, the fewest reads over a checked feature, and the
differences with their protein changes. One set of settings serves the whole
plate and is kept with the assembly: the reads needed over a base, whether
both strands are needed, and which feature types are checked. Types rather
than single features, since clones may be mapped to different constructs;
primer sites and miscellaneous features are left out by default, as when one
contig is verified (a primer site is where a read starts, rarely what the
clone is checked for). A construct with no feature left to check is checked
whole. The table filters by verdict and exports a PDF report (counts, a row
per clone, every difference, how it was checked), a CSV summary with a row
per clone, and the consensus sequences of every clone, or of the verified
ones, as FASTA. A row opens its contig, where the verification of that one
clone shows the detail.

### Trimmed ends in a contig

A read goes into an assembly as trimmed, and the contig keeps its own copy
of the bases inside the trim. The rest of the read is still in its trace,
so the contig shows it: each row's trimmed-off bases are drawn faded beyond
its ends, as Geneious shows soft-trimmed regions, with a tick at each trim
edge. They are found from the read itself (the row's first and last called
bases locate it in the read, edits included), so they are there for any
contig whose reads are still in the session. They are placed one base a
column outward from the row, skipping columns where the reference has a gap
(another read's insertion); where they truly align is only known once the
read takes them in. The view keeps a margin before the first column and
after the last for the ends of the outermost reads, which are the ends most
worth extending.

- **Extend the read to here** (right-click a faded base) places the read
  again with the trim moved to that base: its row is taken out, the read
  with its new trim is aligned to the contig's backbone and laid out in the
  columns already there (with new columns where it inserts bases), and the
  row goes back where it was in the list. The backbone is the reference,
  aligned to end to end as in mapping, so bases that do not belong lower the
  read's identity, and below the assembly's lowest identity the change is
  refused with the figure reached. De novo it is the contig's consensus,
  and the read must line up with it to one of its ends or the consensus's,
  since an end that matches nothing would otherwise be laid out as an
  overhang in the middle of the contig. **Use the whole read** does the same
  with nothing trimmed.
- **Trim the read before / after this base** (right-click a base of the
  read) needs no alignment: the bases past the cut are dropped and the rest
  keep their columns and their edits; columns no row needs any more go.

Each is an undo step of the contig, and every other row stays exactly as it
was. Placing a read again lays its bases out afresh, so its own edits in the
contig are dropped (the message says so, and Undo puts them back). Only the
contig changes: the read's own trim stays as it is, as with every edit in a
contig, so running the assembly again starts from the reads' own trims.

### Trimming reads

A read's ends are trimmed before it is assembled: by error probability
(Mott's algorithm with a limit of 0.05, as Geneious and phred do), by a
quality cut-off, or kept as they are; then by fixed cuts, primers and vector
sequence. A read without qualities (a FASTA read, or a trace saved without
them) cannot be trimmed by quality, so it keeps its longest stretch with at
most a set number of ambiguous calls (N and the other IUPAC codes; 2 by
default), as Geneious's "Maximum ambiguities" does. Its noisy ends, where
the base caller gives up and writes N, go; a clean read keeps everything.

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

### Quality report

The read set page has a second page, the **Quality report**, which gives
FastQC's modules under FastQC's names, in FastQC's order and with its
default pass, warn and fail thresholds, laid out as FastQC's report is (a
Summary list of the modules with their marks, then each module with its
plot). Anyone who reads FastQC reports can read it without learning a new
one. It is computed by SeqNexus, not by FastQC: FastQC is a Java program,
which cannot run in a page, least of all one opened from disk. Each module
was reimplemented from FastQC's documented behaviour and its source (FastQC
is GPL 3 or later, compatible with SeqNexus's AGPL), so that its numbers and
marks agree with FastQC's; where SeqNexus departs from it, this section says
so.

Like FastQC, which reports each file on its own, the report is made per
mate, with an R1/R2 switch. It is gathered beside the other figures while the
reads are imported or trimmed, in one pass, and stored beside the reads (it
is kept when the reads are discarded). On a short-read benchmark of 400,000
reads of 150 bases the report adds about 0.9 s to an import of about 7 s.

| Module | What is computed | Warn | Fail |
|---|---|---|---|
| Basic Statistics | reads, bases, length range, GC among A/C/G/T calls, encoding | never | never |
| Per base sequence quality | quartiles, 10th and 90th percentiles and mean of the scores at each position | lower quartile < 10 or median < 25 anywhere | < 5 or < 20 |
| Per tile sequence quality | mean quality of each tile at each position, less the mean of the tile means there | any tile more than 5 units off | more than 10 |
| Per sequence quality scores | reads by mean score, as a whole number (integer division, as FastQC does) | most common mean ≤ 27 | ≤ 20 |
| Per base sequence content | share of A, C, G and T among the calls at each position (N left out) | A and T, or G and C, differ by > 10 points anywhere | > 20 |
| Per sequence GC content | reads by GC percentage, with a fitted normal distribution | deviation > 15% of reads | > 30% |
| Per base N content | share of N calls at each position | > 5% anywhere | > 20% |
| Sequence Length Distribution | reads by length | reads not all one length | any read empty |
| Sequence Duplication Levels | share of reads at each duplication level, and the share left after deduplication | < 70% left | < 50% left |
| Overrepresented sequences | sequences over 0.1% of the reads, with their likely source | any listed | any over 1% |
| Adapter Content | cumulative share of reads containing each adapter's first 12 bases, by position | > 5% anywhere | > 10% |

FastQC's K-mer Content module is left out, as FastQC itself has left it out
by default since version 0.11.6.

How the modules follow FastQC:

- **Quality** is read as Phred+33, as FastQC reads it unless told otherwise.
  When the lowest score in the file is Q31 or more, Basic Statistics notes
  that the file may be old Phred+64 (Illumina pipeline 1.3 to 1.7).
- **Tiles** are read from the read name: field 5 of a name with 7 or more
  colon-separated fields (Casava 1.8 and later), field 3 of one with 5 or 6
  (older names). A name that breaks the pattern, or more than 2,500 tiles,
  turns the module off, as in FastQC. Like FastQC, the module looks at every
  read of the first 10,000 and one in ten after that. The heatmap colours the
  deviation on a diverging scale (warm below the average, cool above), full
  colour at 10 units, FastQC's fail limit.
- **GC per read** uses FastQC's model: a read with `g` G or C calls out of
  `n` bases is spread over the whole percentages its count could round to,
  each weighted by how many counts claim that percentage, so short reads do
  not leave comb-like gaps; reads are cut to whole hundreds of bases above
  100 and whole thousands above 1,000 first. The theoretical curve is a
  normal distribution centred on the mode (averaged over the neighbouring
  bins within 10% of the modal count, unless that run reaches 0 or 100%)
  with the spread of the reads around it; the deviation is the summed
  difference between the two, as a percentage of the reads.
- **Duplication** compares reads by their first 50 bases (whole reads when
  shorter), as FastQC 0.11 and later do: identity over a whole long read is
  broken by sequencing errors. Only the first 100,000 distinct sequences are
  tracked; after that, reads are only counted against them. The count of
  sequences at each duplication level is then corrected for the ones missed:
  divided by the chance that a sequence seen that many times in the whole
  file would have turned up among the reads read before tracking stopped
  (FastQC's correction). The levels are binned as FastQC bins them (1 to 9,
  then over 10, 50, 100, 500, 1k, 5k and 10k).
- **Overrepresented sequences** come from the same tracked sequences. Each is
  matched against FastQC's contaminant list (Illumina, Nextera, SOLiD and
  other kit oligos): a match is a stretch of more than 20 bases with at most
  one mismatch on either strand, or, for a sequence of 8 to 19 bases, an
  exact substring; the longest match wins, and is written as FastQC writes it
  ("TruSeq Adapter, Index 1 (100% over 49bp)"). Only contaminants sharing a
  10-base seed with the sequence are searched in full (any such match
  contains one), which keeps amplicon libraries with hundreds of
  overrepresented sequences quick.
- **Adapters** are FastQC's six probes (Illumina Universal, Illumina Small
  RNA 3' and 5', Nextera, polyA, polyG). Each read counts once per probe, at
  the probe's first exact match, and the count is cumulative from there to
  the end of the read, so the curve shows the share of reads that have run
  into the adapter by each position. The probes are found with a rolling
  2-bit code of the last 12 bases rather than six string searches per read,
  which halved the time the whole report takes.

Where SeqNexus departs from FastQC:

- **Positions are not grouped.** FastQC groups positions into ranges past
  base 9 so its fixed-size images stay legible; the report draws every
  position (up to 1,000) and shows the value at the pointer.
- **Adapter counts include every read.** FastQC extends its position counts
  as it meets longer reads, so a position only counts the reads after the
  first read long enough to reach it; the report counts each read's first
  match position and accumulates at the end.
- **Long reads** (Nanopore, PacBio) get only the modules about whole reads:
  basic statistics, read quality, GC, length. Position along a read of
  thousands of bases says little, no two long reads start alike by chance,
  and the probes are for Illumina libraries; the others are shown as not run,
  with the reason. FastQC's thresholds, set for Illumina, still apply to the
  modules that run, so long reads warn on length and often fail read quality.
- **Read quality has two figures.** The module uses FastQC's whole-number
  mean of the scores so that its mark matches FastQC's; the Summary page's
  read quality is the mean from error probabilities (above), which is the
  more accurate measure and reads lower.

**Expected flags.** FastQC's thresholds assume a random library of short
reads, whole-genome DNA on Illumina, and many libraries break that by
design. The report has a **Library** setting (whole genome, amplicons,
RNA-seq, small RNA, bisulfite, other). The marks stay FastQC's, so the
report still reads as FastQC's would, but a warning or failure that the
library type or the technology explains is shown faded, with the reason
under the module's title, and is left out of the mark beside the page's name
and the one-line summary on the Summary page:

| | Expected warnings and failures |
|---|---|
| Amplicons | per base content (every read starts at a primer), GC (a few sequences, each its own GC), duplication, overrepresented sequences |
| RNA-seq | per base content (random hexamer priming biases the first dozen bases), GC, duplication and overrepresented sequences (highly expressed transcripts) |
| Small RNA | per base content, GC, length (reads differ once the adapter is cut), duplication, overrepresented sequences, adapters (the RNAs are shorter than the reads) |
| Bisulfite | per base content (unmethylated C read as T), GC |
| Long reads | length (always varies), read quality (FastQC's Q27 and Q20 are Illumina limits; the Summary page's verdict uses limits for the technology), GC |
| Trimmed or filtered read sets | length |

A whole-genome library (or none set) explains nothing: every flag counts.

**Export.** The report exports as:

- a self-contained **HTML** page laid out as FastQC's report (Summary list,
  then the modules with their plots, both mates for a pair), with the
  charts as inline SVG;
- a **PDF** of the same on A4 pages, the charts as vectors (drawn with the
  app's own PDF writer from the same SVG);
- **FastQC data files** (`fastqc_data.txt`, one per mate) in FastQC 0.12's
  format: the module names, marks and tables FastQC writes, so that MultiQC
  can put SeqNexus results beside FastQC results from other samples. The
  first line names SeqNexus, not FastQC: MultiQC only takes a version from a
  `##FastQC` (or `##Falco`) line and reads the modules whatever the first line
  says, so the file loads without claiming to be FastQC's. Modules not run
  are left out, as FastQC leaves out the modules it does not run. A test
  reads the file back with a port of MultiQC's FastQC parser.

The exported page and PDF are fixed output in the light theme's colours on
white, whatever theme the app is in.

Colours: base content uses the base colour tokens; the other multi-line
charts use a categorical palette (`--series-1` to `--series-6`, checked for
colour-blind separation of neighbouring series in light and dark themes),
and every chart has a table view.

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

---

## NGS Mapping and Assembly

A read set is mapped to a reference, or assembled de novo and the reads
mapped back to the contigs; either way the result is an assembly (see
[Assemblies and contigs](#assemblies-and-contigs)) that holds the mapping,
and everything below (viewing, variants, samples, figures, SAM and BAM)
works on that.

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
  the feature's start (its end on the reverse strand) moved on by its
  `/codon_start`, with the genetic code its `/transl_table` names (the
  standard code when it names none), so a variant can be read against the
  codon it falls in.
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
  contig view), by mapping quality, or by pair. By mapping quality, as
  Geneious offers: MAPQ is -10 log10 of the chance the read belongs
  elsewhere, so reads are split into 0 (another place fits as well, a
  repeat), 1 to 19 (a 1% chance or more of the wrong place), 20 and up, and
  255 (none given, as some aligners write). By pair, as IGV colours insert size and pair
  orientation: mates facing each other at the expected distance are plain;
  further apart than expected (a deletion between the mates in the sample),
  closer (an insertion), facing the wrong way or on the same strand (an
  inversion or rearrangement), with the mate on another reference, or with the
  mate unmapped (outlined) each have their own colour. The expected distance
  is the 0.5th to 99.5th percentile of the proper pairs' fragment lengths, as
  IGV computes it. On a circular reference, distances and orientation are
  taken the short way round the origin, so pairs across it are not flagged.
  Mismatches are faded by base quality, faint at Q5 and below and full from
  Q20 (IGV's shading), and reads of mapping quality 0 are drawn faint
  (except when coloured by mapping quality, which marks them already).
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

- **Coding changes** are read with the coding feature's own genetic code
  (its `/transl_table`, the standard code when it names none) and from its
  `/codon_start`. With the standard code a mitochondrial gene's TGA reads as
  a stop, so a harmless change to it was reported as nonsense; vertebrate
  mitochondria (table 2) and invertebrate ones (table 5, the COI barcode
  gene) read it as tryptophan. The first codon of a CDS that starts whole
  counts as methionine when it is one of its code's start codons (GTG, TTG
  and others in bacteria, table 11), so a change from one start to another
  is synonymous and a change to anything else is a lost start. Without a
  `/transl_table` only ATG is taken as the start. Spliced features are read
  as their whole span, not by exon.
- **Transitions and transversions:** a single-base change between two
  purines (A, G) or two pyrimidines (C, T) is a transition, between the
  kinds a transversion. Transitions are about twice as common in nature, so
  a call set's ratio far from that suggests sequencing errors. The hover
  card and the CSV say which, with the share of reads showing the
  reference.

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
table opens the view there with the soft-clipped bases shown. "Add to the
reference" adds each junction as a `variation` feature of one base, the
last one the reads align to, its note saying what it suggests, how many
reads support it on which strands, and its clipped bases (Geneious
annotates its junctions the same way). `variation`, as for saved variants,
so the variant caller and clone verification leave them out.

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
4x, or PDF (vector, one page at the figure's size; see [Figures and
reports](#figures-and-reports)). Tracks: ruler, coverage (optionally by
strand), variants with their coding changes where there is room, the
reference's bases when they are wide enough to tell apart, and the reads in
the view's colours, order and downsampling (up to a chosen number of rows).
It is drawn on white with print colours whatever the app's theme, with
colours as hex plus fill-opacity, which vector editors read reliably,
rather than rgba(). Reads are drawn for stretches of 20 kb or less, and
where the view has them loaded; wider, the figure is coverage and variants.

The report page saves as a PDF too (Export > Report as PDF): the figures,
the references table, the coverage, fragment length and mapping quality
charts, and how the mapping was made.

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

**Coverage** exports as bedGraph (Export > Coverage as bedGraph on the report
page), for IGV, the UCSC browser, bedtools or a spreadsheet: the stored
per-base depth (aligned bases of every primary and supplementary alignment,
deletions not counted, the figure the coverage track draws), one line per
run of bases at the same depth, 0-based and half-open, zero-depth runs
included, as `bedtools genomecov -bga` writes it. Runs keep the file small
where depth is flat; where it changes at nearly every base, as across a
genome at depth, it is about one line per base, built in parts so it is
never one string.

---

## Fetching from NCBI and UniProt

Import by Accession (in the File group) downloads a record straight into the
session: NCBI Nucleotide and NCBI Protein (as GenPept) through the Entrez
E-utilities, and UniProtKB through its REST service. The source is guessed
from the shape of the accession as it is typed and can be overridden: RefSeq
proteins (NP_, XP_, WP_, YP_, AP_), GenBank proteins (three letters and five
or seven digits) and PDB chains (1ABC_A) read as proteins; everything else
is taken for a nucleotide.

An NCBI record's length and title are fetched first from its summary,
without downloading it, because typing a chromosome accession would
otherwise pull hundreds of megabytes: a record over 10 Mb is confirmed
before it is downloaded, and an accession NCBI does not know is reported as
such. The GenBank or GenPept text then goes through the same reader as a
file, so the gene and source conventions under
[Annotations](#annotations) apply. A UniProt entry arrives as JSON with its
features in one request; whether it is reviewed (Swiss-Prot) or automatic
(TrEMBL) is noted, and its cross-references to PDB and AlphaFold are kept
in the document's metadata for the structure viewer (see
[3D structure](#3d-structure)).

Addgene and SnapGene were offered as sources too, but neither site lets
another website download its files (no CORS headers), so those buttons
failed every time; the dialog now says how to get their files in instead.
Genome links listed by an imported Geneious file open this dialog with the
accession filled in (see [Geneious files](#geneious-files)).

---

## File Format Support

| Format | Read | Write | Notes |
|--------|------|-------|-------|
| GenBank (.gb, .gbk) | Yes | Yes | Streaming parser for large files (>1 MB). Handles multi-record files. |
| GenPept (.gp, .gpt) | Yes | Yes | Protein records in GenBank's layout ("aa" on the LOCUS line). See [Proteins](#proteins). |
| FASTA (.fasta, .fa, .faa) | Yes | Yes | Multi-sequence support. Each record is sorted into DNA or protein by its letters; a .faa file is all protein. |
| SnapGene (.dna) | Yes | Yes | Binary TLV format. Handles sequence, features, primers, topology, methylation. |
| Geneious (.geneious) | Yes | - | A Geneious folder export: every sequence, protein and sequence list in it, with features and primers, and its oligos into the primer library. See [Geneious files](#geneious-files). |
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

### Geneious files

A `.geneious` file is an export of one Geneious folder. It is a ZIP holding
one XML file, the document list, and for read sets and assemblies binary
side files (`fileData.N`) in Geneious's own formats. The document list is a
flat series of `<geneiousDocument class="...">` elements, one per document,
and the name of the folder.

Each document is read on its own, by its class, and opened as what it is:

- **Sequences** (GenBank downloads, sequences made in Geneious, Sanger
  reads, consensus sequences) open as sequences, a document whose molecule
  type is AA as a protein. Each keeps its own name (the one it was renamed
  to in Geneious, when it was), description, topology and features.
- **Sequence lists** open as their member sequences.
- **Alignments** open as alignment items, nucleotide or protein as Geneious
  marks them. A Sanger contig (reads assembled in Geneious) opens as an
  alignment of its reads, a read that went in reverse-complemented marked
  so, and a contig built against a reference has that row as the
  alignment's reference. A tree built in Geneious keeps the alignment it was
  built from, and that alignment is opened under the tree's name; the tree
  itself is not drawn, which the notice says.
- **Sanger reads** open as chromatograms. Geneious keeps the original .ab1
  file whole inside its chromatogram document (base64 in `<rawdata>`), so
  the read is parsed by the same AB1 reader as a file opened directly. A
  read is two documents in Geneious: that file, and the sequence made from
  it, which carries the name the read was given, its trim and a reference to
  the file's URN. The two are joined by that reference: the chromatogram
  takes the read's name and its Geneious trim (the "trimmed" annotations at
  its ends), and the sequence is not opened again beside it. A read trimmed
  nowhere in Geneious is quality trimmed as any imported read is.
- **Structures** open as their proteins with the 3D view, as a PDB file
  does: Geneious keeps the PDB text in the document, and it goes through the
  same structure reader. A structure with no protein chain (a small
  molecule) is reported.
- **Oligos** go to the primer library, with their role (primer or probe)
  and description.
- **Enzyme sets** are saved as enzyme sets of the Restriction Analysis panel
  (see [Saved enzyme sets](#saved-enzyme-sets)). Geneious lists each enzyme
  with its REBASE record; the name is matched to the database, and enzymes
  it does not know are named in the notice and left out. A set already
  saved with the same name and enzymes is not saved twice.
- **Genome links** (a genome Geneious lists by its NCBI accession and length
  without the sequence, which can be a whole chromosome) are not
  downloaded. The notice offers the list, and each link opens the Fetch
  dialog with its accession filled in; that dialog asks before downloading a
  record of more than 10 Mb.
- Everything opened from one file is filed in one explorer folder named
  after the Geneious folder, and one notice says what was opened and what
  was not.

How the content is read, and why:

- **Each document is parsed separately.** The XML is cut at the top-level
  document boundaries by a string scan and each document goes through the
  XML parser on its own. Searching the whole file for the first sequence
  element, as an earlier reader did, takes one document's sequence, another
  field's label as its name, and every document's features at once; a
  large export also never becomes one DOM.
- **Residues** are in `<charSequence>`, or in `<INSDSeq_sequence>` for some
  GenBank downloads. `<sequence_residues>` is a 500-letter preview and is
  used only when it is the whole sequence; a document with only the preview
  is reported, not opened short. Geneious writes residues in alternating
  case, which carries no meaning, so they are uppercased. RNA keeps its U,
  as a FASTA import does.
- **Features are stored twice**: in `<sequenceAnnotations>`, the current
  state, and in the override properties of the GenBank record, the state at
  download. The current copy is read; the download copy only for a record
  that has no other. A feature added in Geneious after download is in the
  first and not the second.
- **Intervals** are 1-based and inclusive, listed 5' to 3' along the
  feature as GenBank lists the parts of a join, so they go through the same
  location resolver as GenBank and SnapGene: a feature across the origin of
  a circular sequence is wrapped, one with gaps keeps its exons.
- **Feature names**: Geneious names a feature from a GenBank record
  "<name> <type>" ("bla CDS", "lacZalpha misc", "CAP protein binding site
  protein bind"), and by its type alone when the record gives no name ("rep
  origin"). The type is taken off when what is left is the feature's own
  name from its qualifiers (label, gene, standard_name, product,
  region_name, note, as the GenBank reader names features) or another of its
  qualifier values, and a name that is only the type becomes that GenBank
  name. A feature then reads as a GenBank import of the same record names
  it. A name typed in Geneious, which no qualifier backs, is kept, and so is
  a number after the type ("MAPK10 exon 10").
- **Feature types**: Geneious renames some GenBank keys (polylinker for
  misc_feature) and keeps the key in an `NCBI Feature Key` qualifier, which
  wins; that qualifier is itself mapped, since Geneious sometimes keeps its
  own name there (helix for SecStr). Geneious names that are not feature keys are mapped: promoter
  variants to promoter, origin of replication to rep_origin, att sites to
  protein_bind, helix, strand and turn to SecStr, a Bond to a disulfide.
  Geneious bookkeeping qualifiers (hidden flags, annotation group ids, the
  join type) are dropped, and spaces in qualifier names become underscores
  so the feature can be written to GenBank.
- **Primers**: a primer annotated in Geneious records its whole oligo, tail
  included, in a `Sequence` qualifier. Such a feature becomes a primer on
  the sequence, as the GenBank and SnapGene readers keep primers. A
  primer_bind feature without one (a retrovirus's primer binding site, a
  vector's sequencing primer sites from its GenBank record) stays a
  feature.

- **Alignment rows** are gapped sequences, but Geneious does not write their
  leading and trailing gaps: it keeps them as counts (`gapPrefixLength`,
  `gapSuffixLength`) on the row's `<charSequence>`, and they are put back
  as gaps so every row is the alignment's width. Annotations on alignment
  rows are not carried over: an alignment item holds rows, not features.

Not opened, and reported by kind: trees with no alignment in the file,
chromatogram documents whose file does not read, structures with no protein
chain, enzyme sets with no enzymes, genome links (Geneious stores only the
NCBI accession and length of a genome it lists; a genome it never
downloaded is a run of `?`), NGS read sets and assemblies (their reads are in
Geneious's binary side files, partly as Java serialization), and documents
of any other class. History records and assembly reports are skipped
silently.

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
- **Printing through the browser** gives no control over page breaks, so a
  line and its features can split across pages, and the user has to go
  through the print dialog every time.
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

The PDF uses four of the standard 14 fonts (Helvetica, Helvetica-Bold,
Courier, Courier-Bold), which every reader provides, so nothing is embedded. Their glyph
widths are fixed by the Adobe font metrics, which lets the export measure
labels exactly without a canvas; the painter is handed these metrics, so
label fitting and enzyme label tiers are computed for the glyphs that will
print. Monospaced text prints in Courier, the rest in Helvetica, each in its
bold from weight 600.

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

### Figures and reports

The figures of alignments, traces and mappings are built once, as SVG, for
the SVG and PNG exports. Their PDF is made from that same SVG
(`pdf/svg-pdf.ts`): it is parsed and painted onto `PdfCanvas`, one page at
the figure's own size (a CSS pixel is 0.75 pt), so the PDF places in a
layout program at the size it was made and cannot drift from the SVG. The
translator covers what the figure builders write: rectangles, paths (move,
line, cubic and quadratic curves, close), lines, circles, polygons, text
with a position per glyph, groups with transforms and clip paths, and a
style sheet of type, class and descendant selectors. Styles cascade as a
browser does: a presentation attribute loses to any style rule, rules rank
by specificity and then order, and inherited properties pass to children.

Rejected alternatives:
- **Drawing each figure a second time** through a canvas painter, as the
  sequence export does, would give the PDF its own code for every track,
  and the PDF and SVG of one figure could disagree.
- **The browser's print dialog** sized the figure to the paper rather than
  to itself, needed a pop-up window, and left the file name and page
  setup to the user each time.

Reports (the report of an NGS mapping) are laid out down A4 pages by
`pdf/report-pdf.ts`: figure tiles, tables that break between rows and
repeat their header, histograms drawn as vector bars on the same axis steps
as the screen, and terms with their explanations. Both use the figures'
print colours on white, whatever the app's theme.

---

## References

- Kyte J, Doolittle RF (1982) "A simple method for displaying the hydropathic
  character of a protein." *J Mol Biol* 157:105-132.

- Taylor WR (1997) "Residual colours: a proposal for aminochromography."
  *Protein Engineering* 10:743-746.

- Thompson JD, Gibson TJ, Plewniak F, Jeanmougin F, Higgins DG (1997) "The
  CLUSTAL_X windows interface: flexible strategies for multiple sequence
  alignment aided by quality analysis tools." *Nucleic Acids Res*
  25:4876-4882.

- Waterhouse AM, Procter JB, Martin DMA, Clamp M, Barton GJ (2009) "Jalview
  Version 2: a multiple sequence alignment editor and analysis workbench."
  *Bioinformatics* 25:1189-1191. (The Zappo residue colours.)

- Pace CN, Vajdos F, Fee L, Grimsley G, Gray T (1995) "How to measure and
  predict the molar absorption coefficient of a protein." *Protein Science*
  4:2411-2423. (The extinction coefficient at 280 nm.)

- Bjellqvist B, Hughes GJ, Pasquali C, Paquet N, Ravier F, Sanchez JC,
  Frutiger S, Hochstrasser D (1993) "The focusing positions of polypeptides
  in immobilized pH gradients can be predicted from their amino acid
  sequences." *Electrophoresis* 14:1023-1031. (The ExPASy pKa set.)

- Grimsley GR, Scholtz JM, Pace CN (2009) "A summary of the measured pK
  values of the ionizable groups in folded proteins." *Protein Science*
  18:247-251.

- Rice P, Longden I, Bleasby A (2000) "EMBOSS: The European Molecular
  Biology Open Software Suite." *Trends in Genetics* 16:276-277. (The
  default pKa set, from the `iep` program.)

- Guruprasad K, Reddy BVB, Pandit MW (1990) "Correlation between stability
  of a protein and its dipeptide composition: a novel approach for predicting
  in vivo stability of a protein from its primary sequence." *Protein
  Engineering* 4:155-161. (The instability index.)

- Ikai A (1980) "Thermostability and aliphatic index of globular proteins."
  *J Biochem* 88:1895-1898.

- Bae S, Kweon J, Kim HS, Kim JS (2014) "Microhomology-based choice of Cas9
  nuclease target sites." *Nature Methods* 11:705-706. (The out-of-frame score
  and the pattern weighting.)

- Jinek M, Chylinski K, Fonfara I, Hauer M, Doudna JA, Charpentier E (2012) "A
  programmable dual-RNA-guided DNA endonuclease in adaptive bacterial
  immunity." *Science* 337:816-821. (SpCas9 and its blunt cut three bases from
  the PAM.)

- Zetsche B, Gootenberg JS, Abudayyeh OO, Slaymaker IM, Makarova KS,
  Essletzbichler P, Volz SE, Joung J, van der Oost J, Regev A, Koonin EV,
  Zhang F (2015) "Cpf1 is a single RNA-guided endonuclease of a class 2 CRISPR-
  Cas system." *Cell* 163:759-771. (The 5' PAM and the staggered cut.)

- Ran FA, Cong L, Yan WX, Scott DA, Gootenberg JS, Kriz AJ, Zetsche B, Shalem
  O, Wu X, Makarova KS, Koonin EV, Sharp PA, Zhang F (2015) "In vivo genome
  editing using Staphylococcus aureus Cas9." *Nature* 520:186-191. (SaCas9 and
  its NNGRRT PAM.)

- Hsu PD, Scott DA, Weinstein JA, Ran FA, Konermann S, Agarwala V, Li Y, Fine
  EJ, Wu X, Shalem O, Cradick TJ, Marraffini LA, Bao G, Zhang F (2013) "DNA
  targeting specificity of RNA-guided Cas9 nucleases." *Nature Biotechnology*
  31:827-832. (That a mismatch costs most next to the PAM, and the shape of
  the aggregate specificity score.)

- Bae S, Park J, Kim JS (2014) "Cas-OFFinder: a fast and versatile algorithm
  that searches for potential off-target sites of Cas9 RNA-guided
  endonucleases." *Bioinformatics* 30:1473-1475. (Searching with mismatches
  and with unpaired bases on either side.)

- Brinkman EK, Chen T, Amendola M, van Steensel B (2014) "Easy quantitative
  assessment of genome editing by sequence trace decomposition." *Nucleic
  Acids Res* 42:e168. (Taking an edited chromatogram apart against its
  control, which the trace route follows.)

- Lawson CL, Hanson RJ (1974) *Solving Least Squares Problems*.
  Prentice-Hall. (The active-set method the decomposition fits with.)

- Clement K, Rees H, Canver MC, Gehrke JM, Farouni R, Hsu JY, Cole MA, Liu DR,
  Joung JK, Bauer DE, Pinello L (2019) "CRISPResso2 provides accurate and
  rapid genome editing sequence analysis." *Nature Biotechnology* 37:224-226.
  (Counting alleles in a window around the cut, which the read route follows.)

- Doench JG, Fusi N, Sullender M, Hegde M, Vaimberg EW, Donovan KF, Smith I,
  Tothova Z, Wilen C, Orchard R, Virgin HW, Listgarten J, Root DE (2016)
  "Optimized sgRNA design to maximize activity and minimize off-target effects
  of CRISPR-Cas9." *Nature Biotechnology* 34:184-191. (The fitted activity and
  mismatch models this app does not ship, and the shape a data file would
  take.)

- Gasteiger E, Hoogland C, Gattiker A, Duvaud S, Wilkins MR, Appel RD,
  Bairoch A (2005) "Protein identification and analysis tools on the ExPASy
  server." In: Walker JM (ed) *The Proteomics Protocols Handbook*, Humana
  Press, 571-607. (ProtParam, which the properties are checked against.)

- Hopp TP, Woods KR (1981) "Prediction of protein antigenic determinants
  from amino acid sequences." *Proc Natl Acad Sci USA* 78:3824-3828.

- Eisenberg D, Schwarz E, Komaromy M, Wall R (1984) "Analysis of membrane
  and surface protein sequences with the hydrophobic moment plot." *J Mol
  Biol* 179:125-142. (The consensus hydrophobicity scale.)

- Vihinen M, Torkkila E, Riikonen P (1994) "Accuracy of protein flexibility
  predictions." *Proteins* 19:141-149.

- Sigrist CJA, de Castro E, Cerutti L, Cuche BA, Hulo N, Bridge A, Bougueleret
  L, Xenarios I (2013) "New and continuing developments at PROSITE."
  *Nucleic Acids Res* 41:D344-D347. (The pattern notation and the PS
  patterns in the motif library.)

- Dingwall C, Laskey RA (1991) "Nuclear targeting sequences: a consensus?"
  *Trends Biochem Sci* 16:478-481. (The bipartite nuclear localization
  signal.)

- Robinson NE, Robinson AB (2001) "Molecular clocks." *Proc Natl Acad Sci
  USA* 98:944-949. (Deamidation rates by sequence context.)

- The UniProt Consortium (2023) "UniProt: the Universal Protein
  Knowledgebase in 2023." *Nucleic Acids Res* 51:D523-D531.

- Rego N, Koes D (2015) "3Dmol.js: molecular visualization with WebGL."
  *Bioinformatics* 31:1322-1324. (The structure viewer.)

- Jumper J, Evans R, Pritzel A, et al. (2021) "Highly accurate protein
  structure prediction with AlphaFold." *Nature* 596:583-589.

- Varadi M, Anyango S, Deshpande M, et al. (2022) "AlphaFold Protein
  Structure Database: massively expanding the structural coverage of
  protein-sequence space with high-accuracy models." *Nucleic Acids Res*
  50:D439-D444. (The models and their pLDDT bands.)

- Burley SK, Bhikadiya C, Bi C, et al. (2021) "RCSB Protein Data Bank:
  powerful new tools for exploring 3D structures of biological
  macromolecules for basic and applied research and education in
  fundamental biology, biomedicine, biotechnology, bioengineering and
  energy sciences." *Nucleic Acids Res* 49:D437-D451.

- Chou PY, Fasman GD (1978) "Prediction of the secondary structure of
  proteins from their amino acid sequence." *Adv Enzymol Relat Areas Mol
  Biol* 47:45-148. (The propensities and the nucleation rule.)

- Gasteiger E, Gattiker A, Hoogland C, Ivanyi I, Appel RD, Bairoch A (2003)
  "ExPASy: the proteomics server for in-depth protein knowledge and
  analysis." *Nucleic Acids Res* 31:3784-3788. (PeptideCutter's cleavage
  rules.)

- Shapiro AL, Viñuela E, Maizel JV (1967) "Molecular weight estimation of
  polypeptide chains by electrophoresis in SDS-polyacrylamide gels."
  *Biochem Biophys Res Commun* 28:815-820. (Mobility linear in log mass.)

- Laemmli UK (1970) "Cleavage of structural proteins during the assembly of
  the head of bacteriophage T4." *Nature* 227:680-685. (The discontinuous
  SDS-PAGE system the gel models.)

- den Dunnen JT, Dalgleish R, Maglott DR, Hart RK, Greenblatt MS,
  McGowan-Jordan J, Roux AF, Smith T, Antonarakis SE, Taschner PEM (2016)
  "HGVS recommendations for the description of sequence variants: 2016
  update." *Hum Mutat* 37:564-569. (The variant names.)

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

- SnapGene Support. "Insert a Restriction Fragment into a Plasmid."
  support.snapgene.com (accessed 2026-10-09). The model for the cloning
  workspace's per-part maps, click-to-cut sites and ends strip.

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

- Biomatters. "Assembly and Mapping" and "Analysis of Assemblies and
  Alignments", *Geneious Prime User Manual*.
  https://manual.geneious.com/en/latest/AssemblyMapping.html (assembling by
  name, mapping to several references, trimming reads without qualities by
  their ambiguities, mapping-quality colouring, junction annotations).

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
  Source code, default limits, adapter and contaminant lists (GPL 3 or
  later): https://github.com/s-andrews/FastQC

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

- Gibson DG, Young L, Chuang RY, Venter JC, Hutchison CA, Smith HO (2009)
  "Enzymatic assembly of DNA molecules up to several hundred kilobases."
  *Nat Methods* 6:343-345.

- Li MZ, Elledge SJ (2007) "Harnessing homologous recombination in vitro to
  generate recombinant DNA via SLIC." *Nat Methods* 4:251-256.

- Engler C, Kandzia R, Marillonnet S (2008) "A one pot, one step, precision
  cloning method with high throughput capability." *PLoS ONE* 3:e3647.

- Potapov V, Ong JL, Kucera RB, et al. (2018) "Comprehensive profiling of
  four base overhang ligation fidelity by T4 DNA ligase and application to
  DNA assembly." *ACS Synth Biol* 7:2665-2674.

- Pryor JM, Potapov V, Kucera RB, Bilotti K, Cantor EJ, Lohman GJS (2020)
  "Enabling one-pot Golden Gate assemblies of unprecedented complexity
  using data-optimized assembly design." *PLoS ONE* 15:e0238592.

- Hartley JL, Temple GF, Brasch MA (2000) "DNA cloning using in vitro
  site-specific recombination." *Genome Res* 10:1788-1795.

- Shuman S (1994) "Novel approach to molecular cloning and polynucleotide
  synthesis using vaccinia DNA topoisomerase." *J Biol Chem*
  269:32678-32684.

- Clark JM (1988) "Novel non-templated nucleotide addition reactions
  catalyzed by procaryotic and eucaryotic DNA polymerases." *Nucleic Acids
  Res* 16:9677-9686. (The 3' A overhang TOPO-TA relies on.)

- Marinus MG, Løbner-Olesen A (2014) "DNA methylation." *EcoSal Plus* 6(1).
  (Dam and Dcm.)

- Stellwagen NC (2009) "Electrophoresis of DNA in agarose gels,
  polyacrylamide gels and in free solution." *Electrophoresis* 30
  Suppl 1:S188-S195. (The sigmoid in log size and the reptation limit the
  gel model follows.)

- Ferguson KA (1964) "Starch-gel electrophoresis: application to the
  classification of pituitary proteins and polypeptides." *Metabolism*
  13:985-1002. (Log mass against distance on SDS-PAGE.)

- Katoh K, Standley DM (2013) "MAFFT multiple sequence alignment software
  version 7: improvements in performance and usability." *Mol Biol Evol*
  30:772-780.

- Edgar RC (2022) "Muscle5: high-accuracy alignment ensembles enable
  unbiased assessments of sequence homology and phylogeny." *Nat Commun*
  13:6968.

- Lassmann T (2020) "Kalign 3: multiple sequence alignment of large data
  sets." *Bioinformatics* 36:1928-1929.

- Gotoh O (1982) "An improved algorithm for matching biological
  sequences." *J Mol Biol* 162:705-708. (Affine gaps in the profile
  aligner.)

- Altschul SF, Gish W, Miller W, Myers EW, Lipman DJ (1990) "Basic local
  alignment search tool." *J Mol Biol* 215:403-410.

- NCBI. "BLAST URL API."
  https://blast.ncbi.nlm.nih.gov/doc/blast-help/urlapi.html

- NCBI. "Entrez Programming Utilities Help."
  https://www.ncbi.nlm.nih.gov/books/NBK25499/

- Thermo Fisher Scientific. "Gateway Technology" manual (att site
  sequences).

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

Third-party code shipped with the editor: 3Dmol.js (BSD-3-Clause, which
includes code from GLmol, Three.js and jQuery), published beside app.html
with its license as `3Dmol-<version>.LICENSE.txt`; the source copy and its
provenance are in `app/vendor/3dmol/`.
