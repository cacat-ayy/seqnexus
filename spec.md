# Sequencing Read-to-Reference Alignment

## Problem

Users have sequencing reads (AB1/SCF chromatograms) and reference sequences open in the editor but no way to align them against each other within the app. They need to verify sequencing results against a known reference, see where the basecaller disagrees, inspect the chromatogram at each mismatch, and correct either the read or the reference.

## Requirements

### 1. Initiating a Read-to-Reference Alignment

Three entry points, all leading to the same flow:

1. **Right-click context menu** on a sequencing read in the file explorer: "Align to Reference..." opens a picker listing open sequence tabs.
2. **Button in chromatogram toolbar**: "Align to Reference" button. Opens the same reference picker.
3. **Existing alignment modal**: When one entry is a sequencing read and the other is a sequence tab, the result is stored as a `ReadAlignment` (not a generic `SavedAlignment`) and opens in the enhanced read-alignment view instead of the standard alignment grid.

The reference picker is a small modal/popover listing open sequence tabs by name. Selecting one runs a pairwise alignment (NW global by default, since reads typically cover a subregion and the user expects to see the full mapping; but offer a local/global toggle).

### 2. Read Alignment as a Store Entity

New interface alongside `SavedAlignment`:

```ts
interface ReadAlignment {
  id: string                    // "readalign_N"
  name: string                  // auto: "{readName} → {refName}"
  readId: string                // reference to SequencingRead.id
  tabId: string                 // reference to the sequence tab
  result: AlignmentResult       // the pairwise alignment result
  createdAt: number
  zoomLevel: number
  showChromatogram: boolean     // whether the chromatogram panel is visible
}
```

- Persisted like `SavedAlignment` (metadata in localStorage, result in IndexedDB).
- Appears in the file explorer in a dedicated "Read Alignments" section (or mixed into the Alignments section with a distinct icon, e.g. `GitCompareArrows`).
- Supports rename and delete via context menu.

### 3. View Layout

When a `ReadAlignment` is active, the center panel shows:

**Top: Alignment grid** (reuse `AlignmentPanel` or a variant)
- Two rows: reference sequence and read sequence.
- Mismatch columns highlighted with a distinct background color (e.g. red-tinted).
- All existing alignment features work: zoom, wrap, conservation coloring, export.

**Bottom: Chromatogram panel** (toggleable via a toolbar button)
- The full `ChromatogramView` for the aligned read, displayed below the alignment grid.
- Scroll position is synced: scrolling the alignment grid scrolls the chromatogram to the corresponding position, and vice versa.
- The chromatogram shows the reference base above each peak position so the user can visually compare.
- Toggle button in the alignment toolbar to show/hide the chromatogram panel.
- Default: `showChromatogram: true` (visible on first open).

The split between alignment grid and chromatogram should use a reasonable default (e.g. 40% grid / 60% chromatogram) but does not need to be user-resizable in v1.

### 4. Mismatch Summary and Navigation

**Summary bar** between the alignment grid header and the grid body (or in the header itself):
- Shows: "X mismatches, Y gaps" (count of positions where read ≠ reference, excluding gap-vs-gap).
- Shows: "Position Z of X" when navigating mismatches.

**Navigation buttons** in the alignment toolbar:
- "Previous mismatch" (←) and "Next mismatch" (→) buttons.
- Keyboard shortcuts: `[` for previous, `]` for next.
- Clicking navigates to the next/previous mismatch column:
  - Scrolls the alignment grid to center the mismatch.
  - If the chromatogram is visible, scrolls it to the corresponding base position.
  - Highlights the active mismatch column distinctly (e.g. thicker border or pulsing highlight).

### 5. Mismatch Resolution

Clicking a mismatch cell in the alignment grid opens a tooltip/popover with:

- The reference base and the read's called base, displayed prominently.
- The Phred quality score of the read's base at that position.
- Two action buttons:
  - **"Accept read (T)"** — edits the reference sequence tab to match the read's base at this position. The label shows the actual read base.
  - **"Accept reference (A)"** — applies a `BaseEdit` (substitute) to the sequencing read to match the reference. The label shows the actual reference base.
- After accepting, the mismatch count updates and navigation advances to the next mismatch.

Both edits are undoable:
- Reference edits use the sequence tab's existing undo system.
- Read edits use the sequencing read's existing `BaseEdit` undo system.

### 6. Alignment Recomputation

When the user edits bases (either via mismatch resolution or in the chromatogram editing mode), the alignment result becomes stale.

- Show a "Realign" button in the toolbar that re-runs the alignment with the updated bases.
- The mismatch count and highlights update after realignment.
- Do NOT auto-realign on every edit (too expensive for large sequences).

### 7. Entry Points — Detailed Flow

**Context menu on read in file explorer:**
1. Right-click read → "Align to Reference..."
2. Small modal opens listing open sequence tabs (name + length).
3. User selects a tab → alignment runs (with progress indicator).
4. Result stored as `ReadAlignment`, becomes active in center panel.

**Chromatogram toolbar button:**
1. User is viewing a chromatogram.
2. Clicks "Align to Reference" button in toolbar.
3. Same reference picker modal opens.
4. Same flow as above.

**Existing alignment modal:**
1. User opens alignment modal, adds a sequencing read and a sequence tab.
2. Runs alignment.
3. System detects one source is a read → stores as `ReadAlignment` instead of `SavedAlignment`.
4. Opens in the enhanced read-alignment view.

## Acceptance Criteria

- [ ] User can align a sequencing read to any open sequence tab via three entry points.
- [ ] Read alignment appears in the file explorer and persists across sessions.
- [ ] Alignment grid shows reference and read with mismatches highlighted.
- [ ] Chromatogram panel is visible below the grid, scroll-synced, and toggleable.
- [ ] Mismatch count is displayed in the toolbar/header.
- [ ] Next/previous mismatch buttons navigate both grid and chromatogram.
- [ ] Clicking a mismatch shows a tooltip with quality score and accept-read / accept-reference buttons.
- [ ] Accepting a read base edits the reference tab; accepting a reference base edits the read.
- [ ] Both edit types are undoable.
- [ ] A "Realign" button re-runs the alignment after edits.
- [ ] Zoom, wrap, and export work as in the standard alignment view.

## Implementation Steps

1. **Add `ReadAlignment` interface to store** — new entity type with `readId`, `tabId`, `showChromatogram`, and CRUD actions (`addReadAlignment`, `removeReadAlignment`, `renameReadAlignment`, `setActiveReadAlignment`, `toggleReadAlignmentChromatogram`).

2. **Add persistence for `ReadAlignment`** — metadata in localStorage, result data in IndexedDB. Follow the `SavedAlignment` pattern. Update `restoreSession`.

3. **Add reference picker modal** — small modal listing open sequence tabs. Used by all three entry points. Returns the selected tab ID.

4. **Wire entry point: context menu on read** — add "Align to Reference..." to the file explorer context menu when right-clicking a sequencing read. Opens reference picker, runs alignment, stores result.

5. **Wire entry point: chromatogram toolbar** — add "Align to Reference" button to `ChromatogramView` toolbar. Opens reference picker, same flow.

6. **Wire entry point: alignment modal** — detect when one entry is a sequencing read and the other is a tab. Store result as `ReadAlignment` instead of `SavedAlignment`.

7. **Add `ReadAlignment` to file explorer** — show in alignments section with a distinct icon. Click to activate, context menu for rename/delete.

8. **Create `ReadAlignmentView` component** — center panel view when a `ReadAlignment` is active. Contains:
   - Alignment grid (top) — reuse/adapt `AlignmentPanel` for two-sequence display with mismatch highlighting.
   - Chromatogram panel (bottom) — embedded `ChromatogramView` with scroll sync.
   - Toggle button for chromatogram visibility.

9. **Implement mismatch computation and summary** — derive mismatch positions from the alignment result. Display count in toolbar. Track current mismatch index.

10. **Implement mismatch navigation** — prev/next buttons and keyboard shortcuts. Scroll both grid and chromatogram to the target position.

11. **Implement mismatch resolution tooltip** — click a mismatch cell to show tooltip with quality score, reference base, read base, and accept buttons. Wire "Accept read" to edit the reference tab and "Accept reference" to edit the read via `BaseEdit`.

12. **Implement "Realign" button** — re-runs alignment with current (edited) bases from both the read and the reference tab. Updates the stored `ReadAlignment.result`.

13. **Wire center panel priority** — add `activeReadAlignmentId` check between chromatogram and alignment in the priority chain.

14. **Build and verify** — full build, test all entry points, mismatch navigation, editing, persistence.
