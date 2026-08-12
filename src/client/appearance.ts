/**
 * Appearance is per device, so it lives in this browser, not on the server
 * (unlike the installation timezone, which every device shares). `system` is
 * the default and stores nothing; `prefers-color-scheme` keeps deciding.
 */

export type Appearance = 'system' | 'light' | 'dark'

export const APPEARANCE_OPTIONS: readonly Appearance[] = ['system', 'light', 'dark']

const STORAGE_KEY = 'appearance'

export function storedAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function chooseAppearance(appearance: Appearance): void {
  applyAppearance(appearance)
  try {
    if (appearance === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, appearance)
  } catch {
    // A browser that refuses storage still gets the appearance for this visit.
  }
}

// The stylesheet's pinned-appearance rules key on `data-appearance`; `system`
// removes the pin.
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement
  if (appearance === 'system') delete root.dataset['appearance']
  else root.dataset['appearance'] = appearance
}
