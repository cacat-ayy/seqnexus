// Adds a "read the guide" link at the end of each features.html section that has
// a guide page of its own. Run from the repo root. Idempotent.
import { readFileSync, writeFileSync } from 'node:fs'

const LINKS = {
  gel: ['virtual-gel.html', 'How the gel is simulated: the migration model, bands, ladders and the digest designer'],
  crispr: ['crispr-guide-design.html', 'How guides are scored, searched for off-targets and designed for a goal'],
  sanger: ['sanger-sequencing.html', 'How traces are trimmed, assembled and verified by the plate'],
  codon: ['codon-optimization.html', 'How codons are chosen: usage tables, constraints and the algorithm'],
  mapping: ['ngs-read-mapping.html', 'How reads are mapped, variants called and contigs assembled'],
  alignment: ['sequence-alignment.html', 'The alignment engines, the viewer and the pairwise algorithms'],
}

let html = readFileSync('features.html', 'utf8')
let added = 0

for (const [anchor, [href, text]] of Object.entries(LINKS)) {
  const start = html.indexOf(`<article class="feat" id="${anchor}">`)
  if (start < 0) throw new Error('no section ' + anchor)
  const next = html.indexOf('</article>', start)
  if (next < 0) throw new Error('unterminated section ' + anchor)
  if (html.slice(start, next).includes(href)) continue  // already linked

  // The link goes after the section's last </ul> (its detail list), before </article>.
  const lastUl = html.lastIndexOf('          </ul>\n', next)
  if (lastUl < start) throw new Error('no detail list in ' + anchor)
  const at = lastUl + '          </ul>\n'.length
  html = html.slice(0, at)
    + `          <p class="more"><a class="link" href="${href}">${text} &rarr;</a></p>\n`
    + html.slice(at)
  added++
}

writeFileSync('features.html', html)
console.log('added', added, 'guide links')
