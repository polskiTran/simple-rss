import 'react'

declare module 'react' {
  interface CSSProperties {
    readonly '--column'?: number
    readonly '--glint-step'?: number
  }
}
