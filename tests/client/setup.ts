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
