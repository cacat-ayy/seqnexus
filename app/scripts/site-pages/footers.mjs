// Rewrites the Product column of the site footer on every page into two columns,
// Product and Guides, so every page links to every guide page. Run from the repo root.
import { readFileSync, writeFileSync } from 'node:fs'

const PAGES = [
  'index.html', 'features.html', 'plasmid-map.html', 'primer-design.html',
  'snapgene-alternative.html', 'virtual-gel.html', 'crispr-guide-design.html',
  'sanger-sequencing.html', 'codon-optimization.html', 'ngs-read-mapping.html',
  'sequence-alignment.html',
]

const GUIDES = [
  ['plasmid-map.html', 'Plasmid map'],
  ['primer-design.html', 'Primer design'],
  ['crispr-guide-design.html', 'CRISPR guides'],
  ['codon-optimization.html', 'Codon optimization'],
  ['virtual-gel.html', 'Virtual gel'],
  ['sequence-alignment.html', 'Alignment'],
  ['sanger-sequencing.html', 'Sanger'],
  ['ngs-read-mapping.html', 'NGS mapping'],
  ['snapgene-alternative.html', 'SnapGene alternative'],
]

const product = `      <nav class="foot-col" aria-label="Product">
        <p class="label">Product</p>
        <a href="app.html">Editor</a>
        <a href="/">Overview</a>
        <a href="features.html">Features</a>
        <a href="/#formats">Formats</a>
      </nav>
      <nav class="foot-col" aria-label="Guides">
        <p class="label">Guides</p>
${GUIDES.map(([href, text]) => `        <a href="${href}">${text}</a>`).join('\n')}
      </nav>
`

for (const page of PAGES) {
  let html = readFileSync(page, 'utf8')
  const start = html.indexOf('      <nav class="foot-col" aria-label="Product">')
  if (start < 0) throw new Error('no Product column in ' + page)
  const end = html.indexOf('      <nav class="foot-col" aria-label="Project">', start)
  if (end < 0) throw new Error('no Project column in ' + page)
  html = html.slice(0, start) + product + html.slice(end)
  writeFileSync(page, html)
  console.log('footer', page)
}
