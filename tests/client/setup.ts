import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

if (!('text' in Blob.prototype)) {
  Object.defineProperty(Blob.prototype, 'text', {
    value(this: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsText(this)
      })
    },
  })
}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

window.scrollTo = () => {}
Element.prototype.scrollIntoView = () => {}

if (!('PointerEvent' in window)) Object.defineProperty(window, 'PointerEvent', { value: MouseEvent })

const played: Pick<Animation, 'finished' | 'cancel'> = {
  get finished() {
    // SAFETY: the client awaits this and reads nothing from it.
    return Promise.resolve(played as Animation)
  },
  cancel() {},
}
// SAFETY: the client only awaits `finished` and calls `cancel`.
Element.prototype.animate = () => played as Animation
window.matchMedia = (query) => ({ matches: false, media: query }) as MediaQueryList
window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
