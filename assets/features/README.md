# Feature screenshots

The landing page (index.html) and the features page (features.html) look for
their screenshots here. A missing file shows a labelled placeholder with the
expected name, so the pages work before every image exists.

Naming: `<name>.png` for the light theme and `<name>-dark.png` for the dark
theme. The dark file is optional; if it is missing the light one is shown in
both themes. Make them at the same size (1440 x 900 or 2880 x 1800 for a crisp
2x image) so the frames line up down the page.

| File | Page | Shows |
|------|------|-------|
| editor.png | features | pEGFP-C1 in the sequence view: features, translation, the EGFP CDS selected |
| map.png | features | pEGFP-C1 map with features and single cutters (default layout) |
| map-ring.png | features | the same map in the sites-outside layout |
| annotation.png | features | the Annotate dialog proposing parts for pEGFP-C1, feature panel behind |
| find.png | features | find panel: Kozak search with one mismatch, hit in context |
| proteins.png | features | GFP (UniProt P42212) split view: variant lollipop map over the sequence |
| proteins-3d.png | features | AlphaFold model of GFP beside the sequence, properties popover open |
| primers.png | features | primer design workbench |
| codon.png | features | codon optimization dialog |
| crispr.png | both | guide designer with scored guides on the sequence |
| cloning.png | both | cloning workspace with maps and the reaction strip |
| enzymes.png | features | restriction enzyme dialog, single cutters of pEGFP-C1 |
| enzymes-sites.png | features | the same sites drawn in the sequence view |
| gel.png | features | pEGFP-C1 digests on a virtual gel beside a ladder, fragment table of the selected lane |
| alignment.png | features | multiple alignment with conservation |
| blast.png | features | an imported NCBI result for the EGFP CDS of pEGFP-C1: hit map and table |
| sanger.png | features | two traces of a pEGFP-C1 clone on the plasmid, a missense in EGFP called (traces made by screenshots/mktraces.mjs) |
| ngs.png | features | read set quality report |
| mapping.png | both | read mapping with coverage and variants |
| formats.png | features | Import by Accession dialog over an explorer with GenBank, FASTA and AB1 files |
| formats-export.png | features | the export dialog with its format cards |
| figures.png | features | the Export PDF dialog with its page preview |

All of them are the 1440 x 900 app window captured at a 5/3 device scale
(2400 x 1500) with the explorer hidden, so the frames line up down the page.
The scripts that take them are in `.claude/skills/drive-app/screenshots/`
(see that skill's SKILL.md); they build each view from `app/testdata`, the
skill's generated Sanger, FASTQ and alignment files, and a pEGFP-C1 record.

The landing page hero is not a screenshot: it is an inline SVG in index.html
drawn from the pDONR221 sequence.
