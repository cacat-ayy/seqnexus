/** GenBank feature types for annotation type dropdowns. */
export const FEATURE_TYPES = [
  'CDS', 'gene', 'promoter', 'terminator', 'rep_origin',
  'misc_feature', 'misc_binding', 'primer_bind', 'regulatory',
  'sig_peptide', 'transit_peptide', 'mat_peptide',
  'mRNA', 'rRNA', 'tRNA', 'ncRNA',
  'intron', 'exon', "5'UTR", "3'UTR",
  'enhancer', 'silencer', 'TATA_signal',
  'polyA_signal', 'LTR', 'repeat_region',
  'mobile_element', 'STS', 'variation',
]

/** Color palette for annotation color pickers.
 *  Includes all TYPE_COLORS defaults so every auto-assigned color is selectable. */
export const PRESET_COLORS = [
  // blues
  '#4dabf7', '#339af0',
  // cyans / teals
  '#66d9e8', '#3bc9db', '#22b8cf', '#15aabf', '#20c997',
  // greens / limes
  '#51cf66', '#74b816', '#94d82d', '#a9e34b',
  // yellows / ambers
  '#ffd43b', '#fab005', '#f59f00',
  // oranges
  '#ffa94d', '#ff922b', '#fd7e14', '#f76707', '#e8590c',
  // reds / pinks
  '#ff6b6b', '#f06595', '#e64980', '#d6336c', '#c2255c',
  // purples
  '#da77f2', '#cc5de8', '#845ef7', '#7950f2',
  // grays
  '#dee2e6', '#ced4da', '#adb5bd', '#868e96',
]
