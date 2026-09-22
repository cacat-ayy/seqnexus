import '@testing-library/jest-dom'

// Polyfill ResizeObserver for jsdom
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver
}

// Stub HTMLCanvasElement.getContext for jsdom
if (typeof HTMLCanvasElement !== 'undefined') {
  const noop = () => {}
  HTMLCanvasElement.prototype.getContext = (() => {
    return {
      fillRect: noop, clearRect: noop, strokeRect: noop,
      fillText: noop, strokeText: noop, measureText: () => ({ width: 0 }),
      beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
      arc: noop, arcTo: noop, rect: noop, clip: noop,
      stroke: noop, fill: noop, save: noop, restore: noop,
      scale: noop, translate: noop, rotate: noop, setTransform: noop,
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      createPattern: noop,
      drawImage: noop, putImageData: noop,
      getImageData: () => ({ data: new Uint8ClampedArray(0) }),
      createImageData: () => ({ data: new Uint8ClampedArray(0) }),
      canvas: { width: 0, height: 0 },
      globalAlpha: 1, globalCompositeOperation: 'source-over',
      fillStyle: '', strokeStyle: '', lineWidth: 1,
      font: '', textAlign: 'left', textBaseline: 'top',
    }
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
}
