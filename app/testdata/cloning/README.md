# Cloning test files

Sixteen GenBank files, one set per cloning method, for trying the cloning
workspace out. Open the files you need (File > Open, or drag them in), then
start a design with New > Cloning design and add each one as a part.

Every set has been run through the app's own engines: each gives the intended
circular construct.

## Restriction and ligation

| File | Part |
|------|------|
| `pUC19.gb` | vector |
| `restriction-insert-EGFP.gb` | insert |

Enzymes: EcoRI and HindIII. Both cut the pUC19 MCS once and neither cuts
inside EGFP, so the insert goes in one way round. Click the two sites on each
part's map.

## Golden Gate

| File | Part |
|------|------|
| `goldengate-destination-vector.gb` | vector |
| `goldengate-part1-promoter.gb` | insert |
| `goldengate-part2-mCherry.gb` | insert |
| `goldengate-part3-terminator.gb` | insert |

Enzyme: BsaI. The fusion sites are the MoClo level 1 set: the vector gives
CGCT and GGAG, the promoter GGAG to AATG, the CDS AATG to GCTT, the
terminator GCTT to CGCT. The AATG site is the start codon of mCherry. The
backbone carries a spectinomycin marker and a p15A origin, neither of which
has a BsaI site of its own, the way a domesticated vector would be.

## Seamless assembly (HiFi, Gibson, In-Fusion, SLIC)

Two parts:

| File | Part |
|------|------|
| `pUC19.gb` | vector |
| `hifi-insert-mCherry.gb` | insert |

Three parts, to see the order and orientation worked out:

| File | Part |
|------|------|
| `pUC19.gb` | vector |
| `hifi-3frag-A-EGFP.gb` | insert |
| `hifi-3frag-B-terminator.gb` | insert |

The arms are 30 bp. pUC19 goes in circular and is opened where the arms land,
just after its XbaI site; the two fragments share a 30 bp stretch of their
own. Any of the four kits assembles these.

## Gateway

LR, an entry clone into a destination vector:

| File | Part |
|------|------|
| `gateway-pENTR-EGFP.gb` | insert |
| `gateway-pDEST.gb` | vector |

BP, an attB PCR product into a donor vector:

| File | Part |
|------|------|
| `gateway-attB-PCR-mCherry.gb` | insert |
| `gateway-pDONR.gb` | vector |

The att cores are the app's own attL1/attL2, attR1/attR2, attB1/attB2 and
attP1/attP2 sequences, so they are found exactly. Both vectors carry ccdB and
a chloramphenicol marker between their sites, which is what leaves with the
byproduct.

## TOPO

| File | Part | Variant |
|------|------|---------|
| `topo-vector-pCR.gb` | vector | all three |
| `topo-insert-TA-EGFP.gb` | insert | TA and Blunt |
| `topo-insert-directional-EGFP.gb` | insert | Directional |

The vector has one CCCTT topoisomerase site, inside its MCS, with CACC beside
it for the directional insert's clamp to pair with. The TA and blunt insert
goes in either way round, so two products are reported; the directional one
only goes in forwards.

## Where the sequences come from

The genes, promoters, terminators, markers and origins are from the app's own
feature library, so the parts and the products auto-annotate. pUC19 is the
app's demo sequence (GenBank L09137.2). The spacers between parts are
pseudo-random filler, generated clear of the sites each file depends on.
