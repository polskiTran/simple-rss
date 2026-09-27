/**
 * Every glyph the interface draws, on one 24px grid with a 1.5 stroke, so
 * icons read as one set at the 16px they are shown at. Decorative: the control
 * that holds an icon carries the name.
 */
const PATHS = {
  'arrow-left': 'M19 12H5M11 18l-6-6 6-6',
  bookmark: 'M6.5 3.5h11v17L12 16.5l-5.5 4z',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-up': 'M6 15l6-6 6 6',
  download: 'M12 4v11M7 10.5l5 5 5-5M5 20h14',
  external: 'M7 17L17 7M8.5 7H17v8.5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  'eye-off':
    'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 4l16 16',
  pencil: 'M15.5 4.5l4 4L8 20H4v-4z',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20',
  upload: 'M12 20V9M7 13.5l5-5 5 5M5 4h14',
  x: 'M6 6l12 12M18 6L6 18',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, filled = false }: { readonly name: IconName; readonly filled?: boolean }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
