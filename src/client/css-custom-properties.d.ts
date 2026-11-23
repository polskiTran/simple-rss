import 'react'

declare module 'react' {
  interface CSSProperties {
    readonly '--column'?: number
    readonly '--glint-step'?: number
    readonly '--x'?: string
    readonly '--y'?: string
    readonly '--scale'?: number
    readonly '--from-x'?: string
    readonly '--from-y'?: string
    readonly '--strength'?: string
  }
}
