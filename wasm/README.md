# WebAssembly tools

These are the [biowasm](https://biowasm.com) WebAssembly builds of three multiple
sequence aligners and a FASTQ preprocessor, kept here so SeqNexus loads them from
its own origin instead of a CDN. They run in Web Workers, one job at a time; see
`app/src/msa/engines/` and `app/src/workers/readset.worker.ts`.

| Tool | Version | Files | Licence | Source |
|------|---------|-------|---------|--------|
| MAFFT | 7.520 | `mafft/7.520/tbfast.{js,wasm}` | BSD | https://mafft.cbrc.jp/alignment/software/ |
| MUSCLE | 5 (biowasm `5.1.0`) | `muscle/5.1.0/muscle.{js,wasm}` | GPL-3.0 | https://github.com/rcedgar/muscle |
| Kalign | 3.3.1 | `kalign/3.3.1/kalign.{js,wasm}` | GPL-3.0 | https://github.com/TimoLassmann/kalign |
| fastp | 0.20.1 | `fastp/0.20.1/fastp.{js,wasm,data}` | MIT | https://github.com/OpenGene/fastp |
| minimap2 | 2.22 | `minimap2/2.22/minimap2.{js,wasm,data}` | MIT | https://github.com/lh3/minimap2 |

fastp.data and minimap2.data are the tools' own test files, which the builds preload; they are handed
to the glue as is (see `dataPackage` in `app/src/msa/engines/emscripten.ts`).

Downloaded unchanged from `https://biowasm.com/cdn/v3/<tool>/<version>/<program>.{js,wasm}`
(biowasm build scripts: https://github.com/biowasm/biowasm, MIT).

MAFFT's strategies (L-INS-i, G-INS-i, E-INS-i) are run by calling `tbfast`
with the arguments the `mafft` script would pass; see `mafftArgs` in
`app/src/msa/engines/catalog.ts`.

Citations:

- Katoh K, Standley DM (2013) MAFFT multiple sequence alignment software version 7. *Mol Biol Evol* 30:772-780.
- Edgar RC (2022) Muscle5: high-accuracy alignment ensembles enable unbiased assessments of sequence homology and phylogeny. *Nat Commun* 13:6968.
- Chen S, Zhou Y, Chen Y, Gu J (2018) fastp: an ultra-fast all-in-one FASTQ preprocessor. *Bioinformatics* 34:i884-i890.
- Li H (2018) Minimap2: pairwise alignment for nucleotide sequences. *Bioinformatics* 34:3094-3100.
- Lassmann T (2020) Kalign 3: multiple sequence alignment of large datasets. *Bioinformatics* 36:1928-1929.
