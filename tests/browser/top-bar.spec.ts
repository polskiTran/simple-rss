import { claim, expect, expectNoBoxPastTheSideEdge, test } from './installation.js'

test.describe('the top bar', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('takes focus in the order it shows its controls, left to right', async ({ page, installation }) => {
    await claim(page, installation.url)
    await page.locator('body').click({ position: { x: 1, y: 700 } })

    const stops: { name: string; x: number }[] = []
    for (let stop = 0; stop < 5; stop++) {
      await page.keyboard.press('Tab')
      stops.push(
        await page.evaluate(() => {
          const focused = document.activeElement
          if (!(focused instanceof HTMLElement)) return { name: '', x: Number.NaN }
          return {
            name: focused.getAttribute('aria-label') ?? focused.textContent ?? '',
            x: focused.getBoundingClientRect().x,
          }
        }),
      )
    }

    expect(stops.map((stop) => stop.name)).toEqual(['Digest', 'Library', 'Feeds', 'Search your reading', 'Settings'])
    const xs = stops.map((stop) => stop.x)
    expect(xs).toEqual([...xs].sort((left, right) => left - right))
  })
})

test.describe('the top bar on the narrowest phone', () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true })

  test('keeps the places, Settings and the search line inside the screen', async ({ page, installation }) => {
    await claim(page, installation.url)

    const bar = page.getByRole('banner')
    for (const name of ['Digest', 'Library', 'Feeds', 'Settings']) {
      await expect(bar.getByRole('link', { name, exact: true })).toBeInViewport({ ratio: 1 })
    }
    await expect(bar.getByRole('searchbox')).toBeInViewport()
    await expectNoBoxPastTheSideEdge(page)
  })
})
