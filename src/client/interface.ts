import { storedChoice } from './stored-choice.js'

export const INTERFACE = storedChoice('interface', ['v2', 'experimental'])

export const INTERFACE_LABELS = { v2: 'v2', experimental: 'Experimental' } as const satisfies Record<
  (typeof INTERFACE.options)[number],
  string
>
