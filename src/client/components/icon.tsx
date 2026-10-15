import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  ArrowUpToLine,
  Bookmark,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  Library,
  MessageCircle,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Settings,
  X,
} from 'lucide-react'

const GLYPHS = {
  'arrow-left': ArrowLeft,
  bookmark: Bookmark,
  calendar: Calendar,
  chat: MessageCircle,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  download: ArrowDownToLine,
  external: ArrowUpRight,
  eye: Eye,
  'eye-off': EyeOff,
  library: Library,
  pencil: Pencil,
  plus: Plus,
  refresh: RotateCw,
  search: Search,
  settings: Settings,
  upload: ArrowUpToLine,
  x: X,
} as const

export type IconName = keyof typeof GLYPHS

export function Icon({ name, filled = false }: { readonly name: IconName; readonly filled?: boolean }) {
  const Glyph = GLYPHS[name]
  return (
    <Glyph
      className="icon"
      size={16}
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
      focusable="false"
    />
  )
}
