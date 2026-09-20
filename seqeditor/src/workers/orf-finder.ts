/**
 * Main-thread API for the ORF finder Web Worker.
 */

import type { ORFResult, ORFRequest } from './orf-finder.worker'

export type { ORFResult, ORFRequest }

export interface ORFOptions {
  minCodons: number
  maxCodons: number       // 0 = no limit
  startCodons: string[]   // e.g. ['ATG'] or ['ATG', 'GTG', 'TTG']
  allowInterior: boolean
  topology?: 'linear' | 'circular'
}

export const DEFAULT_ORF_OPTIONS: ORFOptions = {
  minCodons: 100,
  maxCodons: 0,
  startCodons: ['ATG'],
  allowInterior: true,
}

// Color palette for ORF annotations by frame
export const ORF_COLORS: Record<string, string> = {
  '1_0': '#4dabf7',
  '1_1': '#69db7c',
  '1_2': '#ffd43b',
  '-1_0': '#ff8787',
  '-1_1': '#da77f2',
  '-1_2': '#ffa94d',
}

export function orfColor(strand: 1 | -1, frame: number): string {
  return ORF_COLORS[`${strand}_${frame}`] ?? '#adb5bd'
}

/**
 * Run the ORF finder in a Web Worker.
 */
export function findORFs(bases: string, options: ORFOptions = DEFAULT_ORF_OPTIONS): Promise<ORFResult[]> {
  const request: ORFRequest = {
    bases,
    minCodons: options.minCodons,
    maxCodons: options.maxCodons,
    startCodons: options.startCodons,
    allowInterior: options.allowInterior,
    topology: options.topology,
  }

  return new Promise((resolve, reject) => {
    let worker: Worker

    try {
      worker = new Worker(
        new URL('./orf-finder.worker.ts', import.meta.url),
        { type: 'module' },
      )
    } catch {
      worker = createInlineWorker()
    }

    worker.onmessage = (e: MessageEvent<{ orfs: ORFResult[] }>) => {
      resolve(e.data.orfs)
      worker.terminate()
    }

    worker.onerror = (err) => {
      reject(err)
      worker.terminate()
    }

    worker.postMessage(request)
  })
}

function createInlineWorker(): Worker {
  const code = `
var STOP_CODONS = new Set(["TAA", "TAG", "TGA"]);
var COMPLEMENT = { A:"T",T:"A",G:"C",C:"G",a:"t",t:"a",g:"c",c:"g",N:"N",n:"n",R:"Y",Y:"R",S:"S",W:"W",K:"M",M:"K",B:"V",V:"B",D:"H",H:"D" };

function reverseComplement(seq) {
  var len = seq.length, result = new Array(len);
  for (var i = 0; i < len; i++) result[len - 1 - i] = COMPLEMENT[seq[i]] || "N";
  return result.join("");
}

function findORFs(seq, strand, minCodons, maxCodons, startCodonSet, seqLength, circular) {
  var orfs = [];
  var wrapLen = circular ? Math.min(seqLength - 1, maxCodons > 0 ? maxCodons * 3 : seqLength - 1) : 0;
  var scanSeq = (circular ? seq + seq.slice(0, wrapLen) : seq).toUpperCase();
  var seen = new Set();
  for (var frame = 0; frame < 3; frame++) {
    var orfStart = -1;
    for (var i = frame; i + 2 < scanSeq.length; i += 3) {
      var codon = scanSeq[i] + scanSeq[i+1] + scanSeq[i+2];
      if (startCodonSet.has(codon) && orfStart === -1) { orfStart = i; }
      else if (STOP_CODONS.has(codon) && orfStart !== -1) {
        var orfEnd = i + 3, codons = (orfEnd - orfStart) / 3;
        if (codons >= minCodons && (maxCodons === 0 || codons <= maxCodons)) {
          var s, e;
          if (strand === 1) {
            s = orfStart % seqLength;
            e = orfEnd % seqLength;
            if (orfEnd > seqLength && e === 0) e = seqLength;
          } else {
            s = seqLength - (orfEnd % seqLength || seqLength);
            e = seqLength - (orfStart % seqLength);
          }
          var key = s + "_" + e + "_" + strand + "_" + frame;
          if (!seen.has(key)) {
            seen.add(key);
            orfs.push({ start: s, end: e, strand: strand, frame: frame, codons: codons });
          }
        }
        orfStart = -1;
      }
    }
  }
  return orfs;
}

function filterInterior(orfs) {
  var sorted = orfs.slice().sort(function(a,b){ return a.start - b.start || b.end - a.end; });
  var result = [], maxEnd = { "1": -1, "-1": -1 };
  for (var i = 0; i < sorted.length; i++) {
    var orf = sorted[i], key = String(orf.strand);
    if (orf.end <= maxEnd[key]) continue;
    maxEnd[key] = Math.max(maxEnd[key], orf.end);
    result.push(orf);
  }
  return result;
}

self.onmessage = function(e) {
  var d = e.data, bases = d.bases, seqLength = bases.length;
  var circular = d.topology === "circular";
  var startCodonSet = new Set(d.startCodons.map(function(c){ return c.toUpperCase(); }));
  var fwd = findORFs(bases, 1, d.minCodons, d.maxCodons, startCodonSet, seqLength, circular);
  var rc = reverseComplement(bases);
  var rev = findORFs(rc, -1, d.minCodons, d.maxCodons, startCodonSet, seqLength, circular);
  var orfs = fwd.concat(rev);
  var dedup = new Set();
  orfs = orfs.filter(function(orf) {
    var key = orf.start + "_" + orf.end + "_" + orf.strand + "_" + orf.frame;
    if (dedup.has(key)) return false;
    dedup.add(key);
    return true;
  });
  if (!d.allowInterior) orfs = filterInterior(orfs);
  orfs.sort(function(a,b){ return a.start - b.start; });
  self.postMessage({ orfs: orfs });
};
`
  const blob = new Blob([code], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  const worker = new Worker(url)
  URL.revokeObjectURL(url)
  return worker
}
