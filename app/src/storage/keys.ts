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
  /** Toolbar on top or left, features panel on the right or at the bottom. */
  layout: 'seqnexus:layout',
  splitFraction: 'seqnexus_split_fraction',
  featureSidebarWidth: 'seqnexus_feature_sidebar_width',
  /** The features panel's height when it sits along the bottom. */
  featurePanelHeight: 'seqnexus:feature-panel-height',
  featureSidebarTab: 'seqnexus_feature_sidebar_tab',
  /** The feature list grouped by type or sorted by position. */
  featureSidebarView: 'seqnexus:feature-sidebar-view',
  /** Followed by the kind of view whose minimap is collapsed. */
  minimapCollapsedPrefix: 'seqnexus_minimap_collapsed_',
  blastSettings: 'seqnexus:blast-settings',
  /** The BLAST drawer's height, as it was last dragged to. */
  blastDrawerHeight: 'seqnexus:blast-drawer-height',
  primerTask: 'seqnexus:primer-task',
  crisprTask: 'seqnexus:crispr-task',
  primerDesign: 'seqnexus:primer-design',
  gelRecentEnzymes: 'seqnexus_gel_recent_enzymes',
  trimSettings: 'seqnexus_trim_settings',
  traceView: 'seqnexus_trace_view',
} as const
