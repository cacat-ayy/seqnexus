# Spec: Chromatogram View Visual Overhaul (Both Modes)

## Problem

The chromatogram trace viewer looks and behaves significantly different from the standard SequenceView in both horizontal and wrapped modes. Key issues:

1. **Uneven base spacing** — Bases are positioned at their actual chromatogram peak locations, causing irregular gaps between letters. SequenceView uses a uniform grid.
2. **Click-to-select base** — Clicking a base highlights it with a colored rectangle (`selectedBase`). SequenceView places a thin caret line instead.
3. **Base labels above traces** — Quality bars + base labels + margin sit above the trace curves, pushing traces down and creating a top-heavy layout with excessive whitespace.
4. **Selection rendering** — Selection is drawn as individual 12px-wide rectangles per base with gaps between them. SequenceView draws a continuous filled rectangle spanning the full selection range.
5. **Row height (wrapped only)** — Fixed at 160px, taller than necessary.

## Requirements

### 1. Uniform base grid with stretched traces (both modes)

**Wrapped mode:**
- Compute `cellWidth = traceWidth / basesInRow`.
- Each base is centered at `margin + (i - baseStart + 0.5) * cellWidth`.
- Trace curves are stretched via piecewise linear interpolation so each peak aligns with its grid position.

**Horizontal mode:**
- Compute `cellWidth` from the zoom level (e.g. `avgBaseSpacing * zoom` or a fixed per-base width derived from zoom).
- Each base is positioned at `sampleToX(peakLocations[firstVisibleBase]) + (i - firstVisibleBase) * cellWidth`.
- Trace curves are stretched the same way — piecewise linear mapping from sample-space to uniform grid-space.
- Total canvas width = `data.bases.length * cellWidth` (scrollable).

### 2. Click behavior matches SequenceView (both modes)
- **Outside edit mode:** clicking a base places a **caret** (thin 2px vertical line at the left edge of the base cell). No colored highlight rectangle.
- **In edit mode:** keep the current `selectedBase` highlight rectangle for editing.

### 3. Base letters below traces (both modes)
- Move the base letter row **below** the trace curves.
- Layout order per row (top to bottom):
  - Quality bars
  - Trace curves
  - Base letters

### 4. Quality bar height
- **Wrapped mode:** reduce from 40px to **20px**.
- **Horizontal mode:** keep at **40px**.

### 5. Row height (wrapped only)
- Change `ROW_HEIGHT` from 160px to **130px**.
- Adjust `rowTraceH` accordingly.

### 6. Continuous selection highlight (both modes)
- Draw selection as a **single continuous rectangle** from the left edge of the first selected base cell to the right edge of the last selected base cell.
- Use `rgba(59, 130, 246, 0.25)` (same as SequenceView).
- Draw selection edge handles as thin vertical lines at the boundaries (matching SequenceView style).

## Acceptance Criteria

- [ ] Bases are evenly spaced on a uniform grid in both modes
- [ ] Trace curves are stretched so peaks align with grid positions in both modes
- [ ] Clicking a base outside edit mode shows a thin caret, not a highlight rectangle
- [ ] Clicking a base in edit mode still shows the highlight rectangle
- [ ] Base letters appear below the trace curves in both modes
- [ ] Quality bars are 20px in wrapped mode, 40px in horizontal mode
- [ ] Wrapped row height is 130px
- [ ] Selection is a continuous rectangle in both modes
- [ ] Selection handles match SequenceView style
- [ ] Minimap, trim handles, search highlights, edit markers, and insert gap rendering still work
- [ ] Scrolling and zoom in horizontal mode still work correctly with the new grid

## Implementation Steps

1. **Add wrapped-mode constants** — Introduce `WRAPPED_QUALITY_BAR_HEIGHT = 20` and update `ROW_HEIGHT` to 130. Keep `QUALITY_BAR_HEIGHT = 40` for horizontal mode.
2. **Reorder row layout in `drawWrapped`** — Change vertical order to `[qualBars, traces, baseLabels]`. Update `qualBarY`, `traceTop`, `baseLabelY` calculations.
3. **Reorder layout in `drawHorizontal`** — Same reorder: `[qualBars, traces, baseLabels]`. Update `qualBarY`, `traceTop`, `baseLabelY`.
4. **Implement uniform grid in `drawWrapped`** — Compute `cellWidth = traceWidth / rowBaseCount`. Position bases at grid centers. Build piecewise linear sample-to-grid mapping for trace stretching.
5. **Implement uniform grid in `drawHorizontal`** — Compute `cellWidth` from zoom. Replace `sampleToX(peakLocation)` with grid-based positioning. Build same piecewise linear mapping for traces. Update total canvas width to `bases.length * cellWidth`.
6. **Update selection rendering (both modes)** — Replace per-base rectangles with single `fillRect` from first cell left edge to last cell right edge. Update handle positions to use cell edges.
7. **Update click/caret behavior (both modes)** — In non-edit mode, render thin caret line instead of `selectedBase` highlight. Keep highlight for edit mode only.
8. **Update coordinate helpers** — Update `wrappedMouseToBase`, `wrappedBaseToXY`, and horizontal `mouseToBase` to use uniform grid. Update `scrollToBase` for new grid.
9. **Update scroll/zoom** — Ensure horizontal scrolling and ctrl+scroll zoom work with the new grid-based canvas width. Update `clampScroll`, `effectiveTraceLength`, and scroll position calculations.
10. **Verify dependent features** — Test trim handles, search highlights, edit markers, mixed base markers, insert gap rendering, minimap, and position labels with the new layout in both modes.
11. **Build and copy to app.html**.
