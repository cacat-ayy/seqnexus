/**
 * The app's "Save as" name prompt, for exports far from App in the tree.
 *
 * Most exports get the prompt as an `onExportPrompt` prop from App. A
 * figure saved from deep inside a workspace (the cloning maps) would need
 * it threaded through every component on the way, so App registers its
 * prompt here once and those exports ask for it. Without a registered
 * prompt (tests, a component rendered alone) the default name is used.
 */

export type ExportPrompt = (defaultName: string, onConfirm: (name: string) => void) => void

let registered: ExportPrompt | null = null

export function registerExportPrompt(prompt: ExportPrompt | null): void {
  registered = prompt
}

/** Ask for a file name, then run `onConfirm` with it. */
export function promptFileName(defaultName: string, onConfirm: (name: string) => void): void {
  if (registered) registered(defaultName, onConfirm)
  else onConfirm(defaultName)
}
