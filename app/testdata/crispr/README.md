# CRISPR oracle fixtures

Built by `app/scripts/crispr-oracle/oracle.py` and read by
`app/src/crispr/oracle.test.ts`. Rebuild them with:

    python scripts/crispr-oracle/oracle.py --out testdata/crispr

| File | What it holds |
|------|---------------|
| `offtarget-bruteforce.json` | Generated sequences and every site an exhaustive sweep finds in them, per nuclease geometry, topology and mismatch budget |
| `bae-microhomology.json` | Windows around a cut with the microhomology and out-of-frame scores from the reference implementation |
| `guideseq-validated.json` | The off-target sites Tsai et al. 2015 measured by GUIDE-seq for EMX1, VEGFA site 3 and HEK293 site 4, with each site's CFD and MIT hit score |
| `cfd-tables.json` | The CFD mismatch and PAM activity tables of Doench et al. 2016, supplementary table 19 |
| `mit-weights.json` | The per-position weight vector of Hsu et al. 2013 |

The last three are published measurements, reproduced here so the tests
compare against the authors' own numbers rather than a transcription of
them. The script downloads them from the CRISPOR distribution and from the
CRISPOR paper's data repository, and caches the raw files outside the repo.
Both papers are in the README's References section.
