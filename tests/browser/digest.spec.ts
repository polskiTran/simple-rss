import type { Page } from '@playwright/test'
import {
  addFeed,
  claim,
  expect,
  expectNoBoxPastTheSideEdge,
  expectNoHorizontalOverflow,
  goTo,
  test,
  UNBROKEN_TITLE,
  type Installation,
} from './installation.js'

async function claimAndSubscribe(page: Page, installation: Installation, feedUrl: string, title: string) {
  await claim(page, installation.url)
  await addFeed(page, feedUrl)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
}

async function openDigest(page: Page, installation: Installation): Promise<void> {
  await claimAndSubscribe(page, installation, installation.feedUrl, 'Field Notes')
  await goTo(page, 'Digest')
}

async function openLongDigest(page: Page, installation: Installation): Promise<void> {
  await claimAndSubscribe(page, installation, installation.longFeedUrl, 'Long Meadow')
  await goTo(page, 'Digest')
}

function daysAgo(count: number): string {
  return new Date(Date.now() - count * 86_400_000).toISOString().slice(0, 10)
}

function groundColour(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor)
}

const today = (page: Page) => page.getByRole('heading', { level: 2, name: 'Today' })
const title = (page: Page, name: string) => page.getByRole('main').getByRole('link', { name, exact: true })
const scrolled = (page: Page) => page.evaluate(() => window.scrollY)

test.describe('the Digest', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('heads today’s Feed Items by the day the server names', async ({ page, installation }) => {
    await openDigest(page, installation)

    await expect(today(page)).toBeVisible()
    await expect(page.getByRole('region', { name: 'Today' }).getByRole('link', { name: 'First light' })).toBeVisible()
  })

  test('lets the User pin dark on a light device, surviving a reload', async ({ page, installation }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await openDigest(page, installation)
    const light = await groundColour(page)

    await goTo(page, 'Settings')
    await page.getByRole('button', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
    const dark = await groundColour(page)
    expect(dark).not.toBe(light)

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    expect(await groundColour(page)).toBe(dark)

    await page.getByRole('button', { name: 'System' }).click()
    await expect(page.locator('html')).not.toHaveAttribute('data-appearance', /.*/)
    expect(await groundColour(page)).toBe(light)
  })

  test('follows a dark device when nothing is pinned', async ({ page, installation }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await openDigest(page, installation)
    const light = await groundColour(page)

    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => groundColour(page)).not.toBe(light)
    await expect(today(page)).toBeVisible()
  })

  test('changing the installation timezone recasts the same stored instant', async ({ page, installation }) => {
    await openDigest(page, installation)
    await page.getByRole('main').getByRole('link', { name: 'Field Notes' }).click()
    await expect(page.locator('main').getByText('07:15')).toBeVisible()
    const feed = page.url()

    await goTo(page, 'Settings')
    await page.getByLabel('Timezone').selectOption('Pacific/Midway')
    await page.goto(feed)

    await expect(page.locator('main').getByText('20:15')).toBeVisible()
    await expect(page.locator('main')).not.toContainText('07:15')
  })

  test('pages whole days up to fifty Feed Items, and Show older days goes on from the next day', async ({
    page,
    installation,
  }) => {
    await openLongDigest(page, installation)

    const days = page.locator('main .x-day')
    await expect(days).toHaveCount(50)
    const more = page.getByRole('button', { name: 'Show older days' })
    await more.click()
    await expect(days).toHaveCount(55)
    await expect(more).toBeHidden()
  })

  test('never lets Tab hide a focused control under the legend', async ({ page, installation }) => {
    await openLongDigest(page, installation)
    await page.setViewportSize({ width: 1280, height: 400 })
    await today(page).click()

    for (let stop = 0; stop < 30; stop++) {
      await page.keyboard.press('Tab')
      const hidden = await page.evaluate(() => {
        const focused = document.activeElement?.getBoundingClientRect()
        const legend = document.querySelector('.x-legend')?.getBoundingClientRect()
        return focused !== undefined && legend !== undefined && focused.top >= legend.top
      })
      expect(hidden, `stop ${stop}`).toBe(false)
    }
  })

  test('comes back from a Feed Item to the same entry and place, announced', async ({ page, installation }) => {
    await openLongDigest(page, installation)
    const deep = title(page, 'Meadow note 30')
    await deep.evaluate((link) => link.scrollIntoView({ block: 'center' }))
    const left = await scrolled(page)
    expect(left).toBeGreaterThan(0)

    await page.route('**/api/digest/days', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600))
      await route.continue()
    })
    await deep.click()
    await expect(page.getByRole('heading', { level: 1, name: 'Meadow note 30' })).toBeFocused()
    await expect(page).toHaveTitle('Meadow note 30 — simple')
    const entries = await page.evaluate(() => history.length)
    await page.locator('.x-back').click()

    await expect(page).toHaveURL(/\/digest$/)
    await expect(page).toHaveTitle('Digest — simple')
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
    await page.waitForResponse('**/api/digest/days')
    await expect(page.getByRole('button', { name: /^\w+day \d+ \w+$/ })).toBeVisible()
    await expect.poll(() => scrolled(page)).toBe(left)
    expect(await page.evaluate(() => history.length)).toBe(entries)

    await page.goBack()
    await expect(page).not.toHaveURL(/\/reader\//)
  })

  test('comes back to a Feed Item older days brought, with every day above it', async ({ page, installation }) => {
    await openLongDigest(page, installation)
    await page.getByRole('button', { name: 'Show older days' }).click()
    const older = title(page, 'Meadow note 53')
    await older.evaluate((link) => link.scrollIntoView({ block: 'center' }))
    const left = await scrolled(page)

    await older.click()
    await expect(page.getByRole('heading', { level: 1, name: 'Meadow note 53' })).toBeFocused()
    await page.locator('.x-back').click()

    await expect(page.locator('main .x-day')).toHaveCount(55)
    await expect.poll(() => scrolled(page)).toBe(left)
    await expect(older).toBeInViewport()
  })

  test('comes back past every Next to the place it left', async ({ page, installation }) => {
    await openLongDigest(page, installation)
    await page.getByRole('button', { name: 'Show older days' }).click()
    const older = title(page, 'Meadow note 52')
    await older.evaluate((link) => link.scrollIntoView({ block: 'center' }))
    const left = await scrolled(page)

    await older.click()
    await expect(page.getByRole('heading', { level: 1, name: 'Meadow note 52' })).toBeFocused()
    const entries = await page.evaluate(() => history.length)
    await page.locator('.x-reader-next').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Meadow note 53' })).toBeVisible()
    await expect.poll(() => scrolled(page)).toBe(0)
    expect(await page.evaluate(() => history.length)).toBe(entries)
    await page.locator('.x-back').click()

    await expect(page.locator('main .x-day')).toHaveCount(55)
    await expect.poll(() => scrolled(page)).toBe(left)
    expect(await page.evaluate(() => history.length)).toBe(entries)
  })

  test('names a network loss plainly and recovers on Retry', async ({ page, installation }) => {
    await claimAndSubscribe(page, installation, installation.feedUrl, 'Field Notes')

    await page.context().setOffline(true)
    await goTo(page, 'Digest')
    await expect(page.getByText(/The Digest can’t be reached\./)).toBeVisible()

    await page.context().setOffline(false)
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(today(page)).toBeVisible()
  })

  test('starts from a day in the address, and goes back to today from the calendar', async ({ page, installation }) => {
    await openDigest(page, installation)
    await expect(today(page)).toBeVisible()

    await page.goto(`${installation.url}/digest?from=${daysAgo(1)}`)
    await expect(page.getByText('Nothing on or before this day.')).toBeVisible()

    await page.getByRole('button', { name: /^\w+day \d+ \w+$/ }).click()
    await page.getByRole('group', { name: 'Days' }).locator('[data-today]').click()
    await expect(today(page)).toBeVisible()
    await expect(page).toHaveURL(/\/digest$/)
  })
})

async function asFirehose(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === '/api/feeds',
    async (route) => {
      const response = await route.fetch()
      const list = await response.json()
      for (const feed of list.subscriptions) feed.cadence = feed.cadence.map(() => 5)
      await route.fulfill({ response, json: list })
    },
  )
  await page.route(
    (url) => url.pathname === '/api/digest',
    async (route) => {
      const response = await route.fetch()
      const digest = await response.json()
      const [group] = digest.groups
      const [item] = group?.items ?? []
      if (group && item) {
        group.items = Array.from({ length: 40 }, (_, index) => ({
          ...item,
          feedItemId: item.feedItemId + index,
          title: `Ledger entry ${index + 1}`,
        }))
      }
      await route.fulfill({ response, json: digest })
    },
  )
}

test.describe('a Firehose Feed’s day', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('folds into one row, unfolds, and comes back from a Feed Item still unfolded', async ({
    page,
    installation,
  }) => {
    await asFirehose(page)
    await openDigest(page, installation)

    const fold = page.getByRole('button', { name: '40 Feed Items from Field Notes' })
    await expect(title(page, 'Ledger entry 2')).toHaveCount(0)
    await fold.click()
    await expect(title(page, 'Ledger entry 40')).toBeVisible()

    await title(page, 'Ledger entry 1').click()
    await expect(page.getByRole('heading', { level: 1, name: 'First light' })).toBeFocused()
    await page.locator('.x-back').click()

    await expect(page.getByRole('button', { name: 'Fold 40 Feed Items from Field Notes' })).toBeVisible()
    await expect(title(page, 'Ledger entry 40')).toBeVisible()
  })

  test('unfolds and folds without moving its head or the rows past it', async ({ page, installation }) => {
    await asFirehose(page)
    await openDigest(page, installation)
    const fold = page.locator('.x-fold')
    const place = () =>
      fold.evaluate(async (box) => {
        await Promise.all(document.getAnimations().map((animation) => animation.finished))
        const head = box.firstElementChild?.getBoundingClientRect()
        return { head: head?.top, headHeight: head?.height, next: box.nextElementSibling?.getBoundingClientRect().top }
      })

    const folded = await place()
    await page.getByRole('button', { name: '40 Feed Items from Field Notes' }).click()
    const unfolded = await place()
    await page.getByRole('button', { name: 'Fold 40 Feed Items from Field Notes' }).click()
    await expect(title(page, 'Ledger entry 40')).toHaveCount(0)

    expect({ head: unfolded.head, headHeight: unfolded.headHeight }).toEqual({
      head: folded.head,
      headHeight: folded.headHeight,
    })
    expect(await place()).toEqual(folded)
  })

  test('underlines a title in an unfolded card when it takes keyboard focus', async ({ page, installation }) => {
    await page.addInitScript(() => localStorage.setItem('digest-layout', 'columns'))
    await asFirehose(page)
    await openDigest(page, installation)
    await page.getByRole('button', { name: '40 Feed Items from Field Notes' }).click()

    const entry = title(page, 'Ledger entry 2')
    await title(page, 'Ledger entry 1').focus()
    await page.keyboard.press('Tab')

    await expect(entry).toBeFocused()
    await expect(entry).toHaveCSS('text-decoration-line', 'underline')
  })

  for (const layout of ['columns', 'wall']) {
    test(`unfolds and folds a ${layout} card in place, frame by frame`, async ({ page, installation }) => {
      await page.addInitScript((chosen) => localStorage.setItem('digest-layout', chosen), layout)
      await asFirehose(page)
      await openDigest(page, installation)
      const toggle = page.getByRole('button', { name: /40 Feed Items from Field Notes/ })
      const card = page.locator('.x-card', { has: toggle })
      const toggleAt = (progress: number) =>
        card.evaluate(async (box, at) => {
          box.querySelector('button')?.click()
          const playing = document.getAnimations()
          for (const animation of playing) {
            animation.pause()
            animation.currentTime = Number(animation.effect?.getTiming().duration) * at
          }
          const { left, top, height } = box.getBoundingClientRect()
          for (const animation of playing) animation.play()
          await Promise.all(playing.map((animation) => animation.finished))
          return { left, top, height }
        }, progress)
      const folded = await card.evaluate((box) => {
        const { left, top, height } = box.getBoundingClientRect()
        return { left, top, height }
      })

      const unfolding = await toggleAt(0.5)
      await expect(page.getByRole('button', { name: 'Fold 40 Feed Items from Field Notes' })).toBeVisible()
      const folding = await toggleAt(0.999)
      await expect(title(page, 'Ledger entry 40')).toHaveCount(0)

      expect({ left: unfolding.left, top: unfolding.top }).toEqual({ left: folded.left, top: folded.top })
      expect(folding.height).toBeCloseTo(folded.height, 0)
    })
  }
})

test.describe('the Digest on a phone', () => {
  test.use({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true })

  test('keeps its rows inside the screen', async ({ page, installation }) => {
    await openDigest(page, installation)

    await expect(today(page)).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('focuses the search line at a size iOS does not zoom', async ({ page, installation }) => {
    await openDigest(page, installation)

    const search = page.getByRole('searchbox', { name: 'Search your reading' })
    await search.tap()
    await expect(search).toBeFocused()
    expect(
      await search.evaluate((input) => Number.parseFloat(getComputedStyle(input).fontSize)),
    ).toBeGreaterThanOrEqual(16)
  })

  test('reads from an earlier day without overflowing the screen', async ({ page, installation }) => {
    await openLongDigest(page, installation)

    await page.goto(`${installation.url}/digest?from=${daysAgo(1)}`)
    await expect(
      page
        .getByRole('main')
        .getByRole('link', { name: /^Meadow note/ })
        .first(),
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('an unbroken title on the narrowest phone', () => {
  test.use({ viewport: { width: 320, height: 700 } })

  test('wraps inside the screen on the Digest and the Feed', async ({ page, installation }) => {
    await claimAndSubscribe(page, installation, installation.addressFeedUrl, 'Address Ledger')
    await goTo(page, 'Digest')

    await expect(title(page, UNBROKEN_TITLE)).toBeVisible()
    await expectNoBoxPastTheSideEdge(page)

    await page.getByRole('main').getByRole('link', { name: 'Address Ledger' }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Address Ledger' })).toBeVisible()
    await expect(title(page, UNBROKEN_TITLE)).toBeVisible()
    await expectNoBoxPastTheSideEdge(page)
  })
})
