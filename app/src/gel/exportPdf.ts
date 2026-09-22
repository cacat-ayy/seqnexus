/**
 * Minimal PDF export for the virtual gel.
 *
 * Generates a single-page PDF containing the gel canvas image and a lane
 * summary table below it. No external dependencies - builds the PDF binary
 * directly from the spec.
 */

interface LaneRow {
  lane: number
  type: string
  source: string
  enzymes: string
  fragCount: number
  fragments: string
}

/**
 * Build a PDF blob from a gel canvas and lane table data.
 *
 * Uses a print-window approach for reliability across browsers - the
 * alternative (raw PDF binary) is fragile for image embedding without
 * a library.
 */
export function exportGelPdf(canvas: HTMLCanvasElement, rows: LaneRow[], gelPct: number): void {
  const imgDataUrl = canvas.toDataURL('image/png')

  // Compute aspect ratio for the image
  const imgW = 720 // points
  const imgH = Math.round((canvas.height / canvas.width) * imgW)

  const html = `<!DOCTYPE html>
<html>
<head>
<title>Virtual Gel Export</title>
<style>
  @page { size: A4 landscape; margin: 20mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 10px; color: #222; margin: 0; padding: 20px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .meta { font-size: 10px; color: #666; margin-bottom: 12px; }
  .gel-img { display: block; max-width: 100%; height: auto; border: 1px solid #ccc; border-radius: 4px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 10px; }
  th { background: #f5f5f5; text-align: left; padding: 4px 8px; border: 1px solid #ddd; font-weight: 600; font-size: 9px; text-transform: uppercase; letter-spacing: 0.03em; }
  td { padding: 4px 8px; border: 1px solid #ddd; vertical-align: top; }
  tr:nth-child(even) { background: #fafafa; }
  .lane-num { font-weight: 700; text-align: center; }
  .frags { font-family: monospace; font-size: 9px; word-break: break-all; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>Virtual Gel Electrophoresis</h1>
  <div class="meta">Gel: ${gelPct}% agarose &middot; ${rows.length} lanes &middot; ${new Date().toLocaleDateString()}</div>
  <img class="gel-img" src="${imgDataUrl}" width="${imgW}" height="${imgH}" />
  <table>
    <thead>
      <tr><th>Lane</th><th>Type</th><th>Source</th><th>Enzymes</th><th>#</th><th>Fragments (bp)</th></tr>
    </thead>
    <tbody>
      ${rows.map(r => `<tr>
        <td class="lane-num">${r.lane}</td>
        <td>${r.type}</td>
        <td>${esc(r.source)}</td>
        <td>${esc(r.enzymes)}</td>
        <td style="text-align:center">${r.fragCount}</td>
        <td class="frags">${esc(r.fragments)}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); window.close(); }, 400);
    };
  </script>
</body>
</html>`

  const w = window.open('', '_blank')
  if (!w) {
    alert('Please allow popups to export PDF.')
    return
  }
  w.document.write(html)
  w.document.close()
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
