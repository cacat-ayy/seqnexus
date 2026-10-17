"""Independent oracles for the CRISPR module, and the fixtures built from them.

Nothing here imports the app. Every model is written from its paper or from
the reference implementation named beside it, so a disagreement with the app
is evidence rather than a shared mistake:

  off-target search   an exhaustive sweep over every position and strand,
                      with no early exit and no regex, derived from the
                      protospacer geometry alone (Cas-OFFinder, Bae 2014,
                      does the same job with a bitmask)
  MIT specificity     Hsu et al. 2013 Nat Biotechnol 31:827, as implemented
                      by calcHitScore and calcMitGuideScore in CRISPOR
                      (Concordet and Haeussler 2018), copied term for term
  CFD                 Doench et al. 2016 Nat Biotechnol 34:184, supplementary
                      table 19, through the authors' own cfd-score-calculator
                      and their two pickled tables
  microhomology       Bae et al. 2014 Nat Methods 11:705, as implemented by
                      calcMicroHomolScore in CRISPOR

Run it from the app directory:

    python scripts/crispr-oracle/oracle.py --out testdata/crispr

It writes the fixtures the tests in src/crispr/oracle.test.ts read. The CFD
tables and the GUIDE-seq table are downloaded once into the script's own
cache directory; pass --tables DIR to point at copies you already have.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import pickle
import random
import sys
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Sequence basics
# ---------------------------------------------------------------------------

COMPLEMENT = {"A": "T", "C": "G", "G": "C", "T": "A", "N": "N"}

IUPAC = {
    "A": "A", "C": "C", "G": "G", "T": "T",
    "R": "AG", "Y": "CT", "S": "CG", "W": "AT", "K": "GT", "M": "AC",
    "B": "CGT", "D": "AGT", "H": "ACT", "V": "ACG", "N": "ACGT",
}


def revcomp(seq: str) -> str:
    return "".join(COMPLEMENT[b] for b in reversed(seq))


def pam_matches(pattern: str, text: str) -> bool:
    if len(pattern) != len(text):
        return False
    return all(t in IUPAC[p] for p, t in zip(pattern, text))


# ---------------------------------------------------------------------------
# Oracle 1: exhaustive off-target search
# ---------------------------------------------------------------------------
#
# The geometry is derived here rather than borrowed. With the protospacer
# written 5' to 3' on its own strand, and the PAM on the side the nuclease
# wants, the four arrangements place the protospacer in sense coordinates as:
#
#   strand +1, 3' PAM   PAM at [p, p+pl)   protospacer at [p-sl, p)
#   strand -1, 3' PAM   PAM at [p, p+pl)   protospacer at [p+pl, p+pl+sl)
#   strand +1, 5' PAM   PAM at [p, p+pl)   protospacer at [p+pl, p+pl+sl)
#   strand -1, 5' PAM   PAM at [p, p+pl)   protospacer at [p-sl, p)
#
# On strand -1 both the PAM and the protospacer read as the reverse
# complement of those sense slices.


def _slice(seq: str, start: int, count: int, circular: bool) -> str | None:
    n = len(seq)
    if circular:
        if count > n:
            return None
        start %= n
        if start + count <= n:
            return seq[start:start + count]
        return seq[start:] + seq[:start + count - n]
    if start < 0 or start + count > n:
        return None
    return seq[start:start + count]


def brute_force_sites(
    seq: str,
    spacer: str,
    pam: str,
    pam_side: str,
    circular: bool,
    max_mismatches: int,
) -> list[dict]:
    """Every site with at most max_mismatches, found by looking everywhere."""
    seq = seq.upper()
    spacer = spacer.upper()
    n = len(seq)
    sl, pl = len(spacer), len(pam)
    out: list[dict] = []
    three_prime = pam_side == "threePrime"

    for p in range(n if circular else n - pl + 1):
        sense_pam = _slice(seq, p, pl, circular)
        if sense_pam is None or not all(b in COMPLEMENT for b in sense_pam):
            continue
        for strand in (1, -1):
            read_pam = sense_pam if strand == 1 else revcomp(sense_pam)
            if not pam_matches(pam, read_pam):
                continue
            # Which side of the PAM the protospacer sits on, in sense coords.
            before = (strand == 1) == three_prime
            proto_start = p - sl if before else p + pl
            sense_proto = _slice(seq, proto_start, sl, circular)
            if sense_proto is None or not all(b in "ACGT" for b in sense_proto):
                continue
            read_proto = sense_proto if strand == 1 else revcomp(sense_proto)
            positions = [i for i in range(sl) if spacer[i] != read_proto[i]]
            if len(positions) > max_mismatches:
                continue
            out.append({
                "start": proto_start % n if circular else proto_start,
                "strand": strand,
                "protospacer": read_proto,
                "pam": read_pam,
                "mismatches": len(positions),
                "mismatchPositions": positions,
            })
    out.sort(key=lambda h: (h["start"], h["strand"]))
    return out


def brute_force_best_alignments(
    seq: str,
    spacer: str,
    pam: str,
    pam_side: str,
    circular: bool,
    max_mismatches: int,
) -> list[dict]:
    """The best account of each place the nuclease can sit, bulges allowed.

    A DNA bulge widens the window by one (an extra base in the target), an RNA
    bulge narrows it by one (an extra base in the guide), and the gap position
    is enumerated. A gap at either edge of a window is not an unpaired base:
    it is the plain comparison one position along, so only interior gaps
    count.

    One PAM is one place the nuclease can sit, so the three windows are three
    accounts of the same place and only one is reported: the one needing the
    fewest changes, counting an unpaired base as one change, with the plain
    window preferred when the count ties.
    """
    seq = seq.upper()
    spacer = spacer.upper()
    n = len(seq)
    sl, pl = len(spacer), len(pam)
    three_prime = pam_side == "threePrime"
    out: list[dict] = []

    for p in range(n if circular else n - pl + 1):
        sense_pam = _slice(seq, p, pl, circular)
        if sense_pam is None or not all(b in COMPLEMENT for b in sense_pam):
            continue
        for strand in (1, -1):
            read_pam = sense_pam if strand == 1 else revcomp(sense_pam)
            if not pam_matches(pam, read_pam):
                continue
            before = (strand == 1) == three_prime
            best: tuple[int, int, str, int, int] | None = None
            for rank, (kind, width) in enumerate((("plain", sl), ("dna", sl + 1), ("rna", sl - 1))):
                start = p - width if before else p + pl
                sense = _slice(seq, start, width, circular)
                if sense is None or not all(b in "ACGT" for b in sense):
                    continue
                window = sense if strand == 1 else revcomp(sense)
                fewest = None
                if kind == "plain":
                    mm = sum(1 for i in range(sl) if spacer[i] != window[i])
                    fewest = mm if mm <= max_mismatches else None
                else:
                    gaps = width if kind == "dna" else sl
                    for g in range(1, gaps - 1):
                        if kind == "dna":
                            cand, query = window[:g] + window[g + 1:], spacer
                        else:
                            cand, query = window, spacer[:g] + spacer[g + 1:]
                        if len(cand) != len(query):
                            continue
                        mm = sum(1 for i in range(len(query)) if query[i] != cand[i])
                        if mm <= max_mismatches and (fewest is None or mm < fewest):
                            fewest = mm
                if fewest is None:
                    continue
                edits = fewest + (0 if kind == "plain" else 1)
                if best is None or edits < best[0]:
                    best = (edits, rank, kind, fewest, start % n if circular else start)
            if best is not None:
                out.append({
                    "start": best[4],
                    "strand": strand,
                    "kind": best[2],
                    "mismatches": best[3],
                })
    out.sort(key=lambda h: (h["start"], h["strand"], h["kind"]))
    return out


# ---------------------------------------------------------------------------
# Oracle 2: MIT specificity, Hsu et al. 2013
# ---------------------------------------------------------------------------

# Matrix M of Hsu et al. 2013, position 1 at the 5' end of a 20mer. Copied
# from hitScoreM in CRISPOR's crispor.py, which cites crispr.mit.edu/about.
HIT_SCORE_M = [
    0, 0, 0.014, 0, 0, 0.395, 0.317, 0, 0.389, 0.079,
    0.445, 0.508, 0.613, 0.851, 0.732, 0.828, 0.615, 0.804, 0.685, 0.583,
]


def mit_hit_score(wt: str, off: str) -> float:
    """One site's score, 0 to 100. A term-for-term copy of calcHitScore."""
    assert len(wt) == len(off)
    matrix_start, max_dist = 0, 19
    if len(wt) > 20:
        wt, off = wt[-20:], off[-20:]
    elif len(wt) == 19:
        wt, off = "A" + wt, "A" + off
    elif len(wt) < 19:
        matrix_start = 20 - len(wt)
        max_dist = len(wt) - 1

    dists: list[int] = []
    mm_count = 0
    last = None
    score1 = 1.0
    for pos in range(matrix_start, len(wt)):
        if wt[pos] != off[pos]:
            mm_count += 1
            if last is not None:
                dists.append(pos - last)
            score1 *= 1 - HIT_SCORE_M[pos]
            last = pos
    if mm_count < 2:
        score2 = 1.0
    else:
        avg = sum(dists) / len(dists)
        score2 = 1.0 / (((max_dist - avg) / float(max_dist)) * 4 + 1)
    score3 = 1.0 if mm_count == 0 else 1.0 / (mm_count ** 2)
    return score1 * score2 * score3 * 100


def mit_guide_score(hit_sum: float) -> float:
    """The aggregate, as calcMitGuideScore has it: 100 / (100 + sum)."""
    return 100.0 * (100.0 / (100.0 + hit_sum))


# ---------------------------------------------------------------------------
# Oracle 3: CFD, Doench et al. 2016
# ---------------------------------------------------------------------------

CFD_URLS = {
    "mismatch_score.pkl": "https://raw.githubusercontent.com/maximilianh/"
                          "crisporWebsite/master/CFD_Scoring/mismatch_score.pkl",
    "pam_scores.pkl": "https://raw.githubusercontent.com/maximilianh/"
                      "crisporWebsite/master/CFD_Scoring/pam_scores.pkl",
}
GUIDESEQ_URL = ("https://raw.githubusercontent.com/maximilianh/crisporPaper/"
                "master/offtargets.tsv")


class _NoGlobals(pickle.Unpickler):
    """The tables are plain dicts, so no class ever needs to be built."""

    def find_class(self, module, name):
        raise pickle.UnpicklingError("refused global %s.%s" % (module, name))


def fetch(cache: Path, name: str, url: str) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / name
    if not path.exists():
        with urllib.request.urlopen(url, timeout=60) as fh:
            path.write_bytes(fh.read())
    return path


def load_cfd_tables(cache: Path) -> tuple[dict, dict]:
    tables = []
    for name in ("mismatch_score.pkl", "pam_scores.pkl"):
        raw = fetch(cache, name, CFD_URLS[name]).read_bytes()
        tables.append(_NoGlobals(io.BytesIO(raw), encoding="latin1").load())
    return tables[0], tables[1]


def cfd_score(wt23: str, off23: str, mm_scores: dict, pam_scores: dict) -> float:
    """CFD of a 23mer against a 23mer, as calc_cfd in the authors' script.

    The spacer is compared base by base as RNA against the off-target read as
    DNA, and the product is multiplied by the activity of the last two PAM
    bases. A PAM the table scores zero is not cut at all.
    """
    wt = wt23[:20].upper().replace("T", "U")
    sg = off23[:20].upper().replace("T", "U")
    pam = off23[-2:].upper()
    score = 1.0
    for i, base in enumerate(sg):
        if wt[i] == base:
            continue
        key = "r" + wt[i] + ":d" + revcomp(base.replace("U", "T")) + "," + str(i + 1)
        score *= mm_scores[key]
    return score * pam_scores[pam]


# ---------------------------------------------------------------------------
# Oracle 4: microhomology, Bae et al. 2014
# ---------------------------------------------------------------------------


def bae_microhomology(seq: str, left: int, length_weight: float = 20.0) -> tuple[float, float]:
    """Microhomology and out-of-frame scores, as calcMicroHomolScore.

    `left` is the cut position inside `seq`. Every pair of identical stretches
    with the left copy wholly before the cut and the right copy wholly after
    it is enumerated down from the longest, a pair contained in a longer one
    is dropped, and each survivor contributes

        100 * exp(-deletion / 20) * (length + GC count)

    to the in-frame or the out-of-frame sum by deletion length modulo three.
    """
    seq = seq.upper()
    seq_len = len(seq)
    right = seq_len - left

    rows = []
    for k in reversed(range(2, left)):
        for j in range(left, left + right - k + 1):
            for i in range(0, left - k + 1):
                if seq[i:i + k] == seq[j:j + k]:
                    rows.append((seq[i:i + k], i, i + k, j, j + k, j - i))
    if not rows:
        return 0.0, 0.0

    sum_3 = 0.0
    sum_not_3 = 0.0
    for idx in range(len(rows)):
        scrap, _, left_end, right_start, _, length = rows[idx]
        contained = False
        for prev in range(idx):
            _, _, left_end_ref, right_start_ref, _, _ = rows[prev]
            if left_end_ref >= left_end and right_start_ref <= right_start:
                contained = True
                break
        if contained:
            continue
        weight = 100 * (1 / math.exp(length / length_weight)) * (
            len(scrap) + scrap.count("G") + scrap.count("C"))
        if length % 3 == 0:
            sum_3 += weight
        else:
            sum_not_3 += weight

    total = sum_3 + sum_not_3
    if total == 0:
        return 0.0, 0.0
    return total, sum_not_3 * 100.0 / total


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

# Only the geometry the search needs, so the fixture does not depend on the
# app's own nuclease records.
NUCLEASES = {
    "spcas9": {"pam": "NGG", "pamSide": "threePrime", "spacerLength": 20},
    "spcas9-ng": {"pam": "NG", "pamSide": "threePrime", "spacerLength": 20},
    "sacas9": {"pam": "NNGRRT", "pamSide": "threePrime", "spacerLength": 21},
    "ascas12a": {"pam": "TTTV", "pamSide": "fivePrime", "spacerLength": 23},
    "nmecas9": {"pam": "NNNNGATT", "pamSide": "threePrime", "spacerLength": 24},
}


def random_sequence(rng: random.Random, n: int, gc: float = 0.5) -> str:
    weights = [(1 - gc) / 2, gc / 2, gc / 2, (1 - gc) / 2]
    return "".join(rng.choices("ACGT", weights=weights, k=n))


def mutate(rng: random.Random, seq: str, changes: int) -> str:
    out = list(seq)
    for pos in rng.sample(range(len(seq)), changes):
        out[pos] = rng.choice([b for b in "ACGT" if b != out[pos]])
    return "".join(out)


def plant(seq: str, at: int, insert: str) -> str:
    """Overwrite, so planting never moves anything already planted."""
    return seq[:at] + insert + seq[at + len(insert):]


def build_offtarget_cases(rng: random.Random) -> list[dict]:
    """Cases that cover the corners the app has to get right.

    Each case plants a handful of near copies of one spacer in a random
    background, then asks for every site the geometry allows. The planted
    copies are not the answer: the answer is whatever the exhaustive sweep
    finds, which includes the ones the background threw up by chance.
    """
    cases: list[dict] = []

    def add(name: str, nuclease: str, seq: str, spacer: str, circular: bool, max_mm: int):
        spec = NUCLEASES[nuclease]
        hits = brute_force_sites(seq, spacer, spec["pam"], spec["pamSide"], circular, max_mm)
        bulges = brute_force_best_alignments(
            seq, spacer, spec["pam"], spec["pamSide"], circular, max_mm)
        cases.append({
            "name": name,
            "nuclease": nuclease,
            "topology": "circular" if circular else "linear",
            "sequence": seq,
            "spacer": spacer,
            "maxMismatches": max_mm,
            "hits": hits,
            "bestAlignments": bulges,
        })

    # Plain linear backgrounds, every nuclease, so PAM-first and long PAMs
    # are covered as well as SpCas9.
    for nuclease, spec in NUCLEASES.items():
        sl = spec["spacerLength"]
        for trial in range(3):
            seq = random_sequence(rng, 900, gc=[0.35, 0.5, 0.65][trial])
            spacer = random_sequence(rng, sl)
            # A perfect site on each strand, plus near copies.
            pam = {"NGG": "AGG", "NG": "AG", "NNGRRT": "CAGAGT",
                   "TTTV": "TTTA", "NNNNGATT": "CCCCGATT"}[spec["pam"]]
            if spec["pamSide"] == "threePrime":
                site = spacer + pam
                rc_site = revcomp(site)
                seq = plant(seq, 100, site)
                seq = plant(seq, 300, rc_site)
                seq = plant(seq, 500, mutate(rng, spacer, 2) + pam)
                seq = plant(seq, 700, revcomp(mutate(rng, spacer, 4) + pam))
            else:
                site = pam + spacer
                seq = plant(seq, 100, site)
                seq = plant(seq, 300, revcomp(site))
                seq = plant(seq, 500, pam + mutate(rng, spacer, 2))
                seq = plant(seq, 700, revcomp(pam + mutate(rng, spacer, 4)))
            add("%s linear %d" % (nuclease, trial), nuclease, seq, spacer, False, 4)

    # Circular, with sites planted across the origin: the protospacer, the
    # PAM, and the join between them each straddle it in turn.
    for nuclease in ("spcas9", "ascas12a"):
        spec = NUCLEASES[nuclease]
        sl = spec["spacerLength"]
        pam = "AGG" if spec["pamSide"] == "threePrime" else "TTTA"
        for offset in range(1, len(pam) + sl):
            seq = random_sequence(rng, 400)
            spacer = random_sequence(rng, sl)
            site = spacer + pam if spec["pamSide"] == "threePrime" else pam + spacer
            # Put the site so that `offset` of its bases fall before the
            # origin and the rest after it.
            seq = plant(seq, len(seq) - offset, site[:offset])
            seq = plant(seq, 0, site[offset:])
            add("%s origin +%d" % (nuclease, offset), nuclease, seq, spacer, True, 3)
            # The same site on the other strand.
            seq2 = random_sequence(rng, 400)
            rc = revcomp(site)
            seq2 = plant(seq2, len(seq2) - offset, rc[:offset])
            seq2 = plant(seq2, 0, rc[offset:])
            add("%s origin -%d" % (nuclease, offset), nuclease, seq2, spacer, True, 3)

    # A short circle, where the search window is a large part of the molecule.
    seq = random_sequence(rng, 60)
    spacer = random_sequence(rng, 20)
    seq = plant(seq, 50, (spacer + "AGG")[:10])
    seq = plant(seq, 0, (spacer + "AGG")[10:])
    add("spcas9 short circle", "spcas9", seq, spacer, True, 3)

    # Ambiguous bases, which the app refuses to score and so must not report.
    seq = random_sequence(rng, 400)
    spacer = random_sequence(rng, 20)
    seq = plant(seq, 100, spacer + "AGG")
    seq = plant(seq, 200, spacer[:5] + "N" + spacer[6:] + "AGG")
    seq = plant(seq, 300, spacer + "NGG")
    add("spcas9 ambiguous", "spcas9", seq, spacer, False, 3)

    # Overlapping PAMs, where one position serves two sites.
    seq = random_sequence(rng, 300)
    spacer = random_sequence(rng, 20)
    seq = plant(seq, 100, spacer + "GGGGG")
    add("spcas9 overlapping pams", "spcas9", seq, spacer, False, 3)

    # A homopolymer background, the worst case for a banded search.
    seq = "A" * 200 + random_sequence(rng, 100) + "T" * 200
    spacer = "A" * 20
    add("spcas9 homopolymer", "spcas9", seq, spacer, False, 3)

    # Low complexity, where a spacer has somewhere to bind every few bases.
    # These are the cases that produce hundreds of sites rather than a
    # handful, so they are the ones that catch a search giving up early.
    spacer = "AG" * 10
    add("spcas9-ng dinucleotide", "spcas9-ng", "AG" * 300, spacer, False, 3)
    add("spcas9-ng dinucleotide circular", "spcas9-ng", "AG" * 150, spacer, True, 3)
    spacer = random_sequence(rng, 20)
    add("spcas9 tandem", "spcas9", (spacer + "TGG") * 20, spacer, False, 4)
    add("spcas9 tandem circular", "spcas9", (spacer + "TGG") * 20, spacer, True, 4)
    seq = random_sequence(rng, 600, gc=0.5)
    for at in range(0, 560, 23):
        seq = plant(seq, at, mutate(rng, spacer, rng.randint(1, 6)) + "AGG")
    add("spcas9 crowded budget 6", "spcas9", seq, spacer, False, 6)
    add("spcas9 crowded budget 6 circular", "spcas9", seq, spacer, True, 6)

    # Spacer lengths other than the nuclease's default, which the panel
    # offers and which change where the PAM-proximal end is.
    for sl in (18, 19, 21):
        seq = random_sequence(rng, 500)
        spacer = random_sequence(rng, sl)
        seq = plant(seq, 100, spacer + "CGG")
        seq = plant(seq, 250, revcomp(mutate(rng, spacer, 2) + "AGG"))
        add("spcas9 spacer %d" % sl, "spcas9", seq, spacer, False, 3)

    # Every mismatch budget from 0 to the app's ceiling, on one sequence.
    seq = random_sequence(rng, 1200)
    spacer = random_sequence(rng, 20)
    for at, changes in ((100, 0), (250, 1), (400, 2), (550, 3), (700, 4), (850, 5), (1000, 6)):
        seq = plant(seq, at, mutate(rng, spacer, changes) + "TGG")
    for budget in range(0, 7):
        add("spcas9 budget %d" % budget, "spcas9", seq, spacer, False, budget)

    return cases


def build_guideseq_fixture(cache: Path, mm_scores: dict, pam_scores: dict) -> dict:
    """The three GUIDE-seq guides the audit names, with both published scores.

    Tsai et al. 2015 Nat Biotechnol 33:187 measured where these guides really
    cut. The table is the one the CRISPOR paper assembled from the authors'
    supplementary table 2; `score` is the share of GUIDE-seq reads at that
    site, which is the thing a specificity model is trying to predict.
    """
    path = fetch(cache, "offtargets.tsv", GUIDESEQ_URL)
    wanted = {
        "Tsai_EMX1": "EMX1",
        "Tsai_VEGFA_site3": "VEGFA site 3",
        "Tsai_HEK293_sgRNA4": "HEK293 site 4",
    }
    guides: dict[str, dict] = {}
    for line in path.read_text().splitlines():
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 4 or parts[0] not in wanted:
            continue
        name, seq, score, kind = parts[0], parts[1].upper(), float(parts[2]), parts[3]
        entry = guides.setdefault(wanted[name], {"onTarget": None, "sites": []})
        if kind == "on-target":
            entry["onTarget"] = seq
        else:
            entry["sites"].append({"seq": seq, "guideSeqShare": score})
    for name, entry in guides.items():
        wt = entry["onTarget"]
        assert wt and len(wt) == 23, name
        for site in entry["sites"]:
            off = site["seq"]
            site["mismatches"] = sum(1 for a, b in zip(wt[:20], off[:20]) if a != b)
            site["pam"] = off[20:]
            site["cfd"] = cfd_score(wt, off, mm_scores, pam_scores)
            site["mitHitScore"] = mit_hit_score(wt[:20], off[:20])
        entry["sites"].sort(key=lambda s: -s["guideSeqShare"])
        entry["mitGuideScore"] = mit_guide_score(
            sum(s["mitHitScore"] for s in entry["sites"]))
    return guides


def build_bae_fixture(rng: random.Random) -> list[dict]:
    """Windows around a cut, with the reference microhomology numbers.

    The reference takes a window and a cut inside it, so the fixture carries
    both: 60 bases with the cut at 30 is what CRISPOR feeds the model, and the
    wider 80 with the cut at 40 is what the app's own default window is.
    """
    cases = []
    for trial in range(12):
        seq = random_sequence(rng, 120, gc=[0.3, 0.5, 0.7][trial % 3])
        if trial % 4 == 1:
            # Plant a microhomology either side of the cut.
            mh = random_sequence(rng, 6)
            seq = plant(seq, 54, mh)
            seq = plant(seq, 66, mh)
        if trial % 4 == 2:
            mh = random_sequence(rng, 4)
            seq = plant(seq, 57, mh)
            seq = plant(seq, 60, mh)
        for window in (30, 40):
            sub = seq[60 - window:60 + window]
            total, oof = bae_microhomology(sub, window)
            cases.append({
                "name": "trial %d window %d" % (trial, window),
                "sequence": sub,
                "cut": window,
                "window": window,
                "microhomologyScore": total,
                "outOfFrame": oof,
            })
    return cases


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="testdata/crispr", help="where the fixtures go")
    ap.add_argument("--tables", default=None, help="directory holding the downloads")
    ap.add_argument("--seed", type=int, default=20261017)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cache = Path(args.tables) if args.tables else Path(__file__).resolve().parent / "cache"

    mm_scores, pam_scores = load_cfd_tables(cache)
    print("CFD tables: %d mismatch entries, %d PAM entries"
          % (len(mm_scores), len(pam_scores)))

    rng = random.Random(args.seed)
    cases = build_offtarget_cases(rng)
    hit_total = sum(len(c["hits"]) for c in cases)
    (out / "offtarget-bruteforce.json").write_text(json.dumps(
        {"seed": args.seed, "nucleases": NUCLEASES, "cases": cases}, indent=1))
    print("off-target: %d cases, %d sites" % (len(cases), hit_total))

    guides = build_guideseq_fixture(cache, mm_scores, pam_scores)
    (out / "guideseq-validated.json").write_text(json.dumps(guides, indent=1))
    for name, entry in guides.items():
        print("%s: %d validated off-targets, MIT guide score %.1f"
              % (name, len(entry["sites"]), entry["mitGuideScore"]))

    bae = build_bae_fixture(random.Random(args.seed + 1))
    (out / "bae-microhomology.json").write_text(json.dumps(bae, indent=1))
    print("microhomology: %d windows" % len(bae))

    # The two published tables, written out so the tests can read them without
    # unpickling anything.
    (out / "cfd-tables.json").write_text(json.dumps(
        {"mismatch": mm_scores, "pam": pam_scores}, sort_keys=True, indent=1))
    (out / "mit-weights.json").write_text(json.dumps({"hitScoreM": HIT_SCORE_M}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
