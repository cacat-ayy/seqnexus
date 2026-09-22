/**
 * Main-thread API for the annotation list matcher.
 */

import type {
  ReferenceAnnotation,
  AnnotateListRequest,
  AnnotationMatch,
} from './annotate-list.worker'

export type { ReferenceAnnotation, AnnotateListRequest, AnnotationMatch }

let _nextId = 0

export function matchToAnnotationData(match: AnnotationMatch) {
  const id = `ref_${++_nextId}`
  return {
    id,
    name: `${match.refName} (${match.similarity}%)`,
    type: match.refType,
    start: match.start,
    end: match.end,
    strand: match.strand as 1 | -1,
    color: match.color ?? '#20c997',
  }
}

export function annotateFromList(
  documentBases: string,
  references: ReferenceAnnotation[],
  minSimilarity: number,
  bestMatchOnly: boolean,
): Promise<AnnotationMatch[]> {
  const request: AnnotateListRequest = {
    documentBases,
    references,
    minSimilarity,
    bestMatchOnly,
  }

  return new Promise((resolve, reject) => {
    let worker: Worker

    try {
      worker = new Worker(
        new URL('./annotate-list.worker.ts', import.meta.url),
        { type: 'module' },
      )
    } catch {
      worker = createInlineWorker()
    }

    worker.onmessage = (e: MessageEvent<{ matches: AnnotationMatch[] }>) => {
      resolve(e.data.matches)
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
var COMPLEMENT={A:"T",T:"A",G:"C",C:"G",a:"t",t:"a",g:"c",c:"g",N:"N",n:"n"};
function reverseComplement(s){var r=new Array(s.length);for(var i=0;i<s.length;i++)r[s.length-1-i]=COMPLEMENT[s[i]]||"N";return r.join("")}
function percentIdentity(a,b,minP){var len=a.length,maxM=Math.floor(len*(1-minP/100)),mis=0,mat=0;for(var i=0;i<len;i++){if(a[i]===b[i])mat++;else if(++mis>maxM)return -1}return(mat/len)*100}
function buildKmerIndex(s,k){var idx=new Map();for(var i=0;i<=s.length-k;i++){var km=s.slice(i,i+k);if(!idx.has(km))idx.set(km,[]);idx.get(km).push(i)}return idx}
function buildRefKP(s,k){var m=new Map();for(var i=0;i<=s.length-k;i++){var km=s.slice(i,i+k);if(!m.has(km))m.set(km,[]);m.get(km).push(i)}return m}
function findCandidates(docLen,refLen,rkp,idx,k,minSim){
  if(refLen<k){var p=[];for(var i=0;i<=docLen-refLen;i++)p.push(i);return p}
  var hits=new Map();
  for(var e of rkp){var km=e[0],rps=e[1],dp=idx.get(km);if(!dp)continue;for(var rj of rps)for(var d of dp){var cs=d-rj;if(cs<0||cs+refLen>docLen)continue;hits.set(cs,(hits.get(cs)||0)+1)}}
  var total=refLen-k+1,minH=Math.max(1,Math.floor(total*(minSim/100)*0.5)),cands=[];
  for(var e of hits)if(e[1]>=minH)cands.push(e[0]);return cands}
function searchRef(doc,ref,idx,k,minSim,best){
  var ru=ref.sequence.toUpperCase(),rl=ru.length;if(!rl||rl>doc.length)return[];
  var rc=reverseComplement(ru),matches=[],fkp=buildRefKP(ru,k),rkp=buildRefKP(rc,k);
  var fc=findCandidates(doc.length,rl,fkp,idx,k,minSim);
  for(var p of fc){var ds=doc.slice(p,p+rl),sim=percentIdentity(ru,ds,minSim);if(sim>=minSim)matches.push({refName:ref.name,refType:ref.type,start:p,end:p+rl,strand:1,similarity:Math.round(sim*10)/10,color:ref.color})}
  var rc2=findCandidates(doc.length,rl,rkp,idx,k,minSim);
  for(var p of rc2){var ds=doc.slice(p,p+rl),sim=percentIdentity(rc,ds,minSim);if(sim>=minSim)matches.push({refName:ref.name,refType:ref.type,start:p,end:p+rl,strand:-1,similarity:Math.round(sim*10)/10,color:ref.color})}
  if(best&&matches.length>1){matches.sort(function(a,b){return a.start-b.start});var b2=[],cur=matches[0];for(var i=1;i<matches.length;i++){var m=matches[i],os=Math.max(cur.start,m.start),oe=Math.min(cur.end,m.end),ol=Math.max(0,oe-os),ml=Math.min(cur.end-cur.start,m.end-m.start);if(ol>=ml*0.75){if(m.similarity>cur.similarity)cur=m}else{b2.push(cur);cur=m}}b2.push(cur);return b2}
  return matches}
self.onmessage=function(e){
  var d=e.data,doc=d.documentBases.toUpperCase(),k=doc.length>100000?10:doc.length>10000?8:6;
  var idx=buildKmerIndex(doc,k),all=[];
  for(var r of d.references){var m=searchRef(doc,r,idx,k,d.minSimilarity,d.bestMatchOnly);all.push.apply(all,m)}
  all.sort(function(a,b){return a.start-b.start});
  self.postMessage({matches:all})};
`
  const blob = new Blob([code], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  const worker = new Worker(url)
  URL.revokeObjectURL(url)
  return worker
}
