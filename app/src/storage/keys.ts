/**
 * Every localStorage key the app writes, in one place. The values are the
 * keys as they have always been spelled: changing one would orphan what a
 * browser already holds under it.
 */
export const STORAGE_KEYS = {
  session: 'seqnexus_session',
  sessionCorrupt: 'seqnexus_session_corrupt',
  backup: 'seqnexus:backup',
  displaySettings: 'seqnexus:display-settings',
  explorerSettings: 'seqnexus:explorer-settings',
  splitFraction: 'seqnexus_split_fraction',
  featureSidebarWidth: 'seqnexus_feature_sidebar_width',
  featureSidebarTab: 'seqnexus_feature_sidebar_tab',
  /** Followed by the kind of view whose minimap is collapsed. */
  minimapCollapsedPrefix: 'seqnexus_minimap_collapsed_',
  blastSettings: 'seqnexus:blast-settings',
  blastHistory: 'seqnexus:blast-history',
  primerTask: 'seqnexus:primer-task',
  crisprTask: 'seqnexus:crispr-task',
  primerDesign: 'seqnexus:primer-design',
  gelRecentEnzymes: 'seqnexus_gel_recent_enzymes',
  trimSettings: 'seqnexus_trim_settings',
  traceView: 'seqnexus_trace_view',
} as const
