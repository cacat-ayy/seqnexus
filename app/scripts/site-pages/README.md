# Guide page generator

The site has a guide page per search a reader might make (`plasmid-map.html`,
`primer-design.html`, `crispr-guide-design.html` and the rest, listed in
`specs.json`). They share the masthead, footer, icons and theme script with
the rest of the site, so they are generated rather than hand-copied: one
hand-edited copy of that chrome drifts from the others within a release.

`plasmid-map.html` is the template. Its head metadata, page head, article body
and closing band are replaced; everything else is taken as it stands. So a
change to the masthead or footer is made in `plasmid-map.html` (or through
`footers.mjs`) and then re-generated into the others.

## Files

| File | What |
|------|------|
| `specs.json` | One entry per page: file name, title, descriptions, the screenshot it opens with, breadcrumb, anchor on `features.html`, h1, lede, closing line |
| `bodies/*.html` | The article body of each page, the part that is actually written rather than generated |
| `mkpages.mjs` | Builds each page from the template, the spec and the body |
| `footers.mjs` | Rewrites the Product and Guides columns of the footer on **every** page of the site, so a new guide appears in all of them |
| `featurelinks.mjs` | Adds the "read the guide" link at the end of the matching `features.html` section. Idempotent |

`snapgene-alternative.html`, `plasmid-map.html` and `primer-design.html` were
written before the generator and are not in `specs.json`; `footers.mjs` and
`featurelinks.mjs` still cover them.

## Running

From the repo root, since every path is relative to the web root:

```bash
sh .claude/skills/check/node.sh app/scripts/site-pages/mkpages.mjs app/scripts/site-pages
sh .claude/skills/check/node.sh app/scripts/site-pages/footers.mjs
sh .claude/skills/check/node.sh app/scripts/site-pages/featurelinks.mjs
```

## Adding a page

1. Write `bodies/<name>-body.html`: the content between `<article class="doc">`
   and `</article>`. Use `.doc-table` for tables, `.doc-where` for the "where to
   find it" box and `.doc-related` for the links at the end. Give it a Limits
   section and a References section; the point of these pages is that they say
   more than the features page does, drawn from the matching README section.
2. Add its entry to `specs.json`.
3. Add it to the `GUIDES` list in `footers.mjs` and to `LINKS` in
   `featurelinks.mjs`.
4. Run the three commands above, then add the page to `sitemap.xml`.
5. Check it in one light and one dark theme, and at phone width.

The screenshots the pages use are the ones in `assets/features/`, with the
`-720` and `-1080` variants in the `srcset`; see that folder's README.
