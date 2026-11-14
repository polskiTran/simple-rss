import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom's Blob predates `text()`, which every browser the client targets has.
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

// jsdom lays nothing out, so its `scrollTo` only reports itself unimplemented
// and it has no `scrollIntoView` at all.
window.scrollTo = () => {}
Element.prototype.scrollIntoView = () => {}

// jsdom has no PointerEvent; Base UI's radio passes a press on to its hidden
// input as one, and a MouseEvent carries everything that press needs.
if (!('PointerEvent' in window)) Object.defineProperty(window, 'PointerEvent', { value: MouseEvent })

// jsdom has no Web Animations or media queries. The DOM the client's motion
// animates is already final, so an animation that has finished without playing
// and a query that never matches stand in.
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
