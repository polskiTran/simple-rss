import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useResource } from '../../src/client/use-resource.js'

function Reading({ load }: { load: (signal: AbortSignal) => Promise<string> }) {
  const [state] = useResource(load, [])
  return <p>{state.kind === 'loaded' ? state.value : state.kind}</p>
}

describe('a view left before its read answers', () => {
  it('cancels the request rather than letting it complete ignored', async () => {
    let carried: AbortSignal | undefined
    const hangs = (signal: AbortSignal) => {
      carried = signal
      return new Promise<string>(() => {})
    }

    const { unmount } = render(<Reading load={hangs} />)
    await screen.findByText('loading')
    expect(carried?.aborted).toBe(false)

    unmount()

    expect(carried?.aborted).toBe(true)
  })
})
