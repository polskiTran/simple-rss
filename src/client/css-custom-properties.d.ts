import 'react'

declare module 'react' {
  /** The custom properties components set through `style`. */
  interface CSSProperties {
    readonly '--column'?: number
    readonly '--glint-step'?: number
  }
}
