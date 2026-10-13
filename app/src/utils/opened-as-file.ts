/**
 * Whether the page was opened from disk (file://), and what to tell the user
 * when a tool cannot run because of it. Opened that way, Chrome refuses module
 * workers and lets the page fetch nothing from wasm/, so fastp, minimap2 and
 * the MAFFT, MUSCLE and Kalign aligners cannot load.
 */

/** True when the page was opened from disk, where the WebAssembly tools cannot be loaded. */
export function openedAsFile(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'file:'
}

export const NEEDS_WEB = (tool: string) => `${tool} cannot run while SeqNexus is opened as a file (file://): the browser does not let such a page load the program. Start serve.bat in the SeqNexus folder and open http://localhost:8080/app.html, or open SeqNexus from its web address.`
