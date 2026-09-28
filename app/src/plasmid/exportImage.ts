/**
 * Turning a PlasmidScene into a file.
 *
 * Both paths render the scene at fit scale and ignore whatever zoom the user
 * has on screen, so an exported figure is never silently cropped to the
 * viewport they happened to be looking at.
 */

import type { PlasmidScene } from './scene'
import { renderSceneToCanvas } from './renderCanvas'
import { renderSceneToSvg } from './renderSvg'

/** 3x gives roughly 300 dpi for a figure placed at about 2.5 inches wide. */
export const DEFAULT_PNG_SCALE = 3

export function plasmidToPng(scene: PlasmidScene, scale = DEFAULT_PNG_SCALE): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(scene.size * scale)
  canvas.height = Math.round(scene.size * scale)

  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Could not create a drawing context'))
  ctx.scale(scale, scale)
  renderSceneToCanvas(ctx, scene)

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('The browser could not encode the image'))
    }, 'image/png')
  })
}

export function plasmidToSvgBlob(scene: PlasmidScene): Blob {
  return new Blob([renderSceneToSvg(scene)], { type: 'image/svg+xml;charset=utf-8' })
}
