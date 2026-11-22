import { describe, expect, it } from 'vitest'
import { applyReaderMarkdownPolicy } from '../../../src/server/markdown/markdown-policy.js'

const FIGURE = '![a figure](/images/figure.png)'
const BASE_URL = 'https://publisher.example/writing/'

describe('applyReaderMarkdownPolicy image destinations', () => {
  it('keeps the absolute destination when images are preserved', () => {
    expect(applyReaderMarkdownPolicy(FIGURE, { baseUrl: BASE_URL, images: 'preserve' })).toBe(
      '![a figure](https://publisher.example/images/figure.png)',
    )
  })

  it('replaces the destination with the signed one when images are signed', () => {
    const markdown = applyReaderMarkdownPolicy(FIGURE, {
      baseUrl: BASE_URL,
      images: { sign: (url) => `/reader/images?url=${encodeURIComponent(url)}` },
    })

    expect(markdown).toBe('![a figure](/reader/images?url=https%3A%2F%2Fpublisher.example%2Fimages%2Ffigure.png)')
  })
})
