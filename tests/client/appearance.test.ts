import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAppearance, chooseAppearance, storedAppearance } from '../../src/client/appearance.js'

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.appearance
  Reflect.deleteProperty(document, 'startViewTransition')
})

describe('per-device appearance', () => {
  it('rests on system: no stored choice, no pin on the document', () => {
    expect(storedAppearance()).toBe('system')
    applyAppearance(storedAppearance())
    expect(document.documentElement.dataset.appearance).toBeUndefined()
  })

  it('pins a chosen scheme on the document and remembers it for this device', () => {
    chooseAppearance('dark')

    expect(document.documentElement.dataset.appearance).toBe('dark')
    expect(storedAppearance()).toBe('dark')
  })

  it('hands the change to a view transition where the browser has one', () => {
    const startViewTransition = vi.fn((update: () => void) => update())
    Object.assign(document, { startViewTransition })

    chooseAppearance('dark')

    expect(startViewTransition).toHaveBeenCalledOnce()
    expect(document.documentElement.dataset.appearance).toBe('dark')
  })

  it('returns to system by forgetting the choice rather than storing a third state', () => {
    chooseAppearance('dark')
    chooseAppearance('system')

    expect(document.documentElement.dataset.appearance).toBeUndefined()
    expect(localStorage.getItem('appearance')).toBeNull()
    expect(storedAppearance()).toBe('system')
  })

  it('treats anything unexpected in storage as system', () => {
    localStorage.setItem('appearance', 'sepia')
    expect(storedAppearance()).toBe('system')
  })
})
