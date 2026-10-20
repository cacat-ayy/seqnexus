// Builds the guide pages from plasmid-map.html as the template, so the masthead,
// footer, icons and theme script stay identical across every page of the site.
// Run from the repo root:
//   sh .claude/skills/check/node.sh <this file> <dir holding specs.json and the bodies>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const specs = JSON.parse(readFileSync(join(dir, 'specs.json'), 'utf8'))
const template = readFileSync('plasmid-map.html', 'utf8')

const cut = (s, from, to) => {
  const a = s.indexOf(from)
  if (a < 0) throw new Error('not found: ' + from)
  const b = s.indexOf(to, a)
  if (b < 0) throw new Error('end not found: ' + to)
  return [a, b + to.length]
}

for (const spec of specs) {
  // Everything from the icons down is shared chrome; the head above it is per page.
  const chrome = template.slice(template.indexOf('<link rel="icon"'))

  const head = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${spec.title}</title>
<meta name="description" content="${spec.description}">
<meta name="author" content="Christopher Acatay">
<meta name="theme-color" content="#0b5f58">
<meta name="robots" content="max-image-preview:large">
<link rel="canonical" href="https://seqnexus.app/${spec.file}">

<meta property="og:type" content="article">
<meta property="og:url" content="https://seqnexus.app/${spec.file}">
<meta property="og:title" content="${spec.ogTitle}">
<meta property="og:description" content="${spec.ogDescription}">
<meta property="og:image" content="https://seqnexus.app/assets/features/${spec.shot}.png">
<meta property="og:image:width" content="1440">
<meta property="og:image:height" content="900">
<meta property="og:image:alt" content="${spec.shotAlt}">
<meta property="og:site_name" content="SeqNexus">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${spec.ogTitle}">
<meta name="twitter:description" content="${spec.ogDescription}">
<meta name="twitter:image" content="https://seqnexus.app/assets/features/${spec.shot}.png">

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "TechArticle",
      "headline": "${spec.ogTitle}",
      "url": "https://seqnexus.app/${spec.file}",
      "description": "${spec.articleDescription}",
      "image": "https://seqnexus.app/assets/features/${spec.shot}.png",
      "datePublished": "2026-10-20",
      "dateModified": "2026-10-20",
      "author": { "@type": "Person", "name": "Christopher Acatay", "url": "https://github.com/cacat-ayy" },
      "about": { "@type": "SoftwareApplication", "name": "SeqNexus", "url": "https://seqnexus.app/app.html" },
      "isPartOf": { "@type": "WebSite", "name": "SeqNexus", "url": "https://seqnexus.app/" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "SeqNexus", "item": "https://seqnexus.app/" },
        { "@type": "ListItem", "position": 2, "name": "Features", "item": "https://seqnexus.app/features.html" },
        { "@type": "ListItem", "position": 3, "name": "${spec.crumb}", "item": "https://seqnexus.app/${spec.file}" }
      ]
    }
  ]
}
</script>

`

  let out = head + chrome

  let [a, b] = cut(out, '  <section class="page-head">', '  </section>')
  out = out.slice(0, a) + `  <section class="page-head">
    <div class="wrap">
      <p class="label"><a class="back" href="features.html#${spec.anchor}">&larr; Features</a></p>
      <h1 style="margin-top:14px">${spec.h1}</h1>
      <p class="lede">${spec.lede}</p>
      <div class="hero-actions">
        <a class="btn" href="app.html">Open the editor &rarr;</a>
      </div>
    </div>
  </section>` + out.slice(b)

  ;[a, b] = cut(out, '    <article class="doc">', '    </article>')
  const body = readFileSync(join(dir, "bodies", spec.bodyFile), 'utf8').replace(/\s+$/, '')
  out = out.slice(0, a) + '    <article class="doc">\n\n' + body + '\n\n    </article>' + out.slice(b)

  ;[a, b] = cut(out, '  <section class="closing">', '  </section>')
  out = out.slice(0, a) + `  <section class="closing">
    <div class="wrap">
      <p class="label">Get started</p>
      <h2 style="margin-top:14px">${spec.closing}</h2>
      <p>No installation, no account. Your sequences are stored on your own device and never uploaded.</p>
      <div class="hero-actions">
        <a class="btn" href="app.html">Open the editor &rarr;</a>
        <a class="btn btn-ghost" href="features.html">See every feature</a>
      </div>
    </div>
  </section>` + out.slice(b)

  writeFileSync(spec.file, out)
  console.log('wrote', spec.file, Math.round(out.length / 1024) + ' KB')
}
