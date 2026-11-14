import { afterEach, describe, expect, it, vi } from 'vitest'
import { playDayChange } from '../../src/client/motion.js'

describe('the Digest motion', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style')
    vi.restoreAllMocks()
  })

  it.each([
    ['240ms', 240],
    ['.24s', 240],
  ])('plays for the length a duration token gives as %s', (token, milliseconds) => {
    document.documentElement.style.setProperty('--duration-sheet-enter', token)
    const list = document.createElement('div')
    const animate = vi.spyOn(list, 'animate')

    playDayChange(list, 'older')

    expect(animate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: milliseconds }))
  })
})
