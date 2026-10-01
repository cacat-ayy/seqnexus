# Alignment engines (WebAssembly)

These are the [biowasm](https://biowasm.com) WebAssembly builds of three multiple
sequence aligners, kept here so SeqNexus loads them from its own origin
instead of a CDN. They run in a Web Worker, one job at a time; see
`app/src/msa/engines/`.

| Tool | Version | Files | Licence | Source |
|------|---------|-------|---------|--------|
| MAFFT | 7.520 | `mafft/7.520/tbfast.{js,wasm}` | BSD | https://mafft.cbrc.jp/alignment/software/ |
| MUSCLE | 5 (biowasm `5.1.0`) | `muscle/5.1.0/muscle.{js,wasm}` | GPL-3.0 | https://github.com/rcedgar/muscle |
| Kalign | 3.3.1 | `kalign/3.3.1/kalign.{js,wasm}` | GPL-3.0 | https://github.com/TimoLassmann/kalign |

Downloaded unchanged from `https://biowasm.com/cdn/v3/<tool>/<version>/<program>.{js,wasm}`
(biowasm build scripts: https://github.com/biowasm/biowasm, MIT).

MAFFT's strategies (L-INS-i, G-INS-i, E-INS-i) are run by calling `tbfast`
with the arguments the `mafft` script would pass; see `mafftArgs` in
`app/src/msa/engines/catalog.ts`.

Citations:

- Katoh K, Standley DM (2013) MAFFT multiple sequence alignment software version 7. *Mol Biol Evol* 30:772–780.
- Edgar RC (2022) Muscle5: high-accuracy alignment ensembles enable unbiased assessments of sequence homology and phylogeny. *Nat Commun* 13:6968.
- Lassmann T (2020) Kalign 3: multiple sequence alignment of large datasets. *Bioinformatics* 36:1928–1929.
