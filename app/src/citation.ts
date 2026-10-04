/**
 * The version of this copy: the date it was built. Results such as Tm values,
 * alignments and cloning products can change between builds, so a citation
 * names the build that produced them.
 */
export const BUILD_DATE = __BUILD_DATE__

const TITLE = 'SeqNexus: a browser-based molecular biology sequence editor'
const SITE_URL = 'https://seqnexus.app'

/** How to cite SeqNexus (APA 7 for software): shown in About and next to figure exports. */
export const CITATION_TEXT =
  `Acatay, C. (${BUILD_DATE.slice(0, 4)}). ${TITLE} (Version ${BUILD_DATE}) [Computer software]. ${SITE_URL}`

/** The same citation for reference managers and LaTeX. */
export const CITATION_BIBTEX = `@misc{acatay_seqnexus,
  author = {Acatay, Christopher},
  title = {{SeqNexus}: a browser-based molecular biology sequence editor},
  year = {${BUILD_DATE.slice(0, 4)}},
  note = {Version ${BUILD_DATE}},
  url = {${SITE_URL}}
}`
