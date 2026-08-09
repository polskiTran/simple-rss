/**
 * Light or dark, per device. Unlike the installation timezone — one calendar
 * shared by every device — appearance follows the eyes and the room, so a
 * phone can read dark in bed while the laptop stays light at a desk. The
 * choice therefore lives in this browser, not on the server.
 *
 * `system` is the default and stores nothing: the stylesheet's
 * `prefers-color-scheme` rules keep deciding, exactly as before the Owner
 * ever opened Settings.
 */

export type Appearance = 'system' | 'light' | 'dark'

export const APPEARANCE_OPTIONS: readonly Appearance[] = ['system', 'light', 'dark']

const STORAGE_KEY = 'appearance'

/** What this device chose, or `system` when it never chose. */
export function storedAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

/** Applies a choice to the document and remembers it on this device. */
export function chooseAppearance(appearance: Appearance): void {
  applyAppearance(appearance)
  try {
    if (appearance === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, appearance)
  } catch {
    // A browser that refuses storage still gets the appearance for this visit.
  }
}

/**
 * Pins the scheme through `data-appearance` on the document element, which the
 * stylesheet's pinned-appearance rules key on. `system` removes the pin.
 */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement
  if (appearance === 'system') delete root.dataset['appearance']
  else root.dataset['appearance'] = appearance
}
