import type { Locator, Page } from '@playwright/test'
import {
  addFeed,
  expect,
  expectNoBoxPastTheSideEdge,
  expectNoHorizontalOverflow,
  LEDGER_LONG_TITLE,
  UNBROKEN_TITLE,
  USER_PASSWORD,
  SETUP_SECRET,
  test,
  type Installation,
} from './installation.js'

const TODAY_ONE = /^Today .+ 1$/

async function claimAndSubscribe(page: Page, installation: Installation, feedUrl: string, title: string) {
  await page.goto(installation.url)
  await page.getByLabel('Setup secret').fill(SETUP_SECRET)
  await page.getByLabel('Password', { exact: true }).fill(USER_PASSWORD)
  await page.getByLabel('Confirm password').fill(USER_PASSWORD)
  await page.getByRole('button', { name: 'Claim installation' }).click()
  await page.getByRole('link', { name: 'Feeds', exact: true }).click()
  await addFeed(page, feedUrl)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

async function subscribe(page: Page, installation: Installation): Promise<void> {
  await claimAndSubscribe(page, installation, installation.feedUrl, 'Field Notes')
}

async function openDigest(page: Page, installation: Installation): Promise<void> {
  await subscribe(page, installation)
  await page.getByRole('link', { name: 'Digest', exact: true }).click()
}

/** The day `count` days before today, in the suite's pinned UTC. */
function daysAgo(count: number): string {
  return new Date(Date.now() - count * 86_400_000).toISOString().slice(0, 10)
}

function groundColour(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor)
}

test.describe('the Digest presentation', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('counts today in its heading from the server', async ({ page, installation }) => {
    await openDigest(page, installation)

    await expect(page.getByRole('heading', { name: TODAY_ONE })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'First light' })).toBeVisible()
  })

  test('sets the date on the line and in the style of every other screen’s title', async ({ page, installation }) => {
    const titleLine = () =>
      page.evaluate(() => {
        const title = document.querySelector('.page-title:not(.visually-hidden)')
        const words = [...(title?.childNodes ?? [])].find(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        )
        const range = document.createRange()
        if (words) range.selectNode(words)
        const { fontSize, fontWeight } = getComputedStyle(title as Element)
        return { top: range.getBoundingClientRect().top, fontSize, fontWeight }
      })

    await openDigest(page, installation)
    await expect(page.getByRole('heading', { name: TODAY_ONE })).toBeVisible()
    const date = await titleLine()

    await page.getByRole('link', { name: 'Feeds', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: /^Feeds/ })).toBeVisible()
    expect(await titleLine()).toEqual(date)
  })

  test('lets the User pin dark on a light device, surviving a reload', async ({ page, installation }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await subscribe(page, installation)
    const light = await groundColour(page)

    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
    const dark = await groundColour(page)
    expect(dark).not.toBe(light)

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    expect(await groundColour(page)).toBe(dark)

    await page.getByRole('link', { name: 'Settings', exact: true }).click()
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
    await expect(page.getByRole('heading', { name: TODAY_ONE })).toBeVisible()
  })

  test('changing the installation timezone recasts the same stored instant', async ({ page, installation }) => {
    await openDigest(page, installation)
    await page.locator('main').getByRole('link', { name: 'Field Notes' }).click()
    await expect(page.locator('main').getByText('07:15')).toBeVisible()
    const feed = page.url()

    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('combobox', { name: 'Installation timezone' }).selectOption('Pacific/Midway')
    await page.goto(feed)

    await expect(page.locator('main').getByText('20:15')).toBeVisible()
    await expect(page.locator('main')).not.toContainText('07:15')
  })

  test('pages whole days up to fifty items, and Show more goes on from the next day', async ({
    page,
    installation,
  }) => {
    await claimAndSubscribe(page, installation, installation.longFeedUrl, 'Long Meadow')
    await page.getByRole('link', { name: 'Digest', exact: true }).click()

    await expect(page.locator('main .feed-day')).toHaveCount(50)
    const more = page.getByRole('button', { name: 'Show more' })
    await expect(more).toBeVisible()

    await more.click()
    await expect(page.locator('main .feed-day')).toHaveCount(55)
    await expect(more).toBeHidden()
  })

  test('comes back from an article to the same entry and place, announced', async ({ page, installation }) => {
    await claimAndSubscribe(page, installation, installation.longFeedUrl, 'Long Meadow')
    await page.getByRole('link', { name: 'Digest', exact: true }).click()
    const deep = page.getByRole('link', { name: 'Meadow note 30', exact: true })
    await deep.scrollIntoViewIfNeeded()
    const left = await page.evaluate(() => window.scrollY)
    expect(left).toBeGreaterThan(0)

    await deep.click()
    await expect(page.getByRole('heading', { level: 1, name: 'Meadow note 30' })).toBeFocused()
    await expect(page).toHaveTitle('Meadow note 30 — simple')
    const entries = await page.evaluate(() => history.length)
    await page.getByRole('link', { name: 'Back to Digest' }).click()

    await expect(page).toHaveURL(/\/digest$/)
    await expect(page).toHaveTitle('Digest — simple')
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(left)
    expect(await page.evaluate(() => history.length)).toBe(entries)

    await page.goBack()
    await expect(page).not.toHaveURL(/\/reader\//)
  })

  test('names a network loss plainly and recovers on Retry', async ({ page, installation }) => {
    await subscribe(page, installation)

    await page.context().setOffline(true)
    await page.getByRole('link', { name: 'Digest', exact: true }).click()
    await expect(page.getByText('The digest can’t be reached.')).toBeVisible()

    await page.context().setOffline(false)
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByRole('heading', { name: TODAY_ONE })).toBeVisible()
  })
})

test.describe('the Digest from a day', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('starts from a day in the address, and goes back to today', async ({ page, installation }) => {
    await openDigest(page, installation)
    await expect(page.getByRole('heading', { name: TODAY_ONE })).toBeVisible()

    await page.goto(`${installation.url}/digest?from=${daysAgo(1)}`)
    await expect(page.getByText('Nothing on or before this day.')).toBeVisible()

    await page.getByRole('button', { name: 'Back to today' }).click()
    await expect(page.getByRole('heading', { name: TODAY_ONE })).toBeVisible()
    await expect(page).toHaveURL(/\/digest$/)
  })
})

async function sharedTitle(row: Locator) {
  return row.evaluate((item) => {
    const title = item.querySelector('.feed-day-title')
    const link = title?.querySelector('a')
    if (!title || !link) return null
    const box = title.getBoundingClientRect()
    const visible = [...link.getClientRects()].filter((rect) => {
      const overlap = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top)
      return overlap > rect.height / 2
    })
    const rows = [...new Map(visible.map((rect) => [Math.round(rect.top), rect])).values()]
    return {
      lines: rows.length,
      fits: rows.every((rect) => rect.width <= box.width + 1),
      titleClamped: title.scrollHeight > title.clientHeight + 1,
    }
  })
}

test.describe('a Feed\u2019s day', () => {
  test('folds from where it unfolded, moving no title, with the control in reach down the list', async ({
    page,
    installation,
  }) => {
    await page.route(
      (url) => url.pathname === '/api/digest',
      async (route) => {
        const response = await route.fetch()
        const digest = await response.json()
        const [group] = digest.groups
        if (group) {
          const [item] = group.items
          group.items = Array.from({ length: 40 }, (_, index) => ({
            ...item,
            feedItemId: item.feedItemId + index,
            title: `Ledger entry ${index + 1}`,
          }))
        }
        await route.fulfill({ response, json: digest })
      },
    )
    await openDigest(page, installation)

    const title = page.getByRole('heading', { name: 'Ledger entry 1', exact: true })
    const more = page.getByRole('button', { name: 'Show all' })
    const unfoldedFrom = await more.boundingBox()
    const titleAt = await title.boundingBox()
    const titleLooks = await title.screenshot()
    await more.click()

    const less = page.getByRole('button', { name: 'Show less' })
    expect(await less.boundingBox()).toEqual(unfoldedFrom)
    expect(await title.boundingBox()).toEqual(titleAt)
    expect((await title.screenshot()).equals(titleLooks)).toBe(true)

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
    await expect(less).toBeInViewport()
    await less.click()

    await expect(title).toBeInViewport()
    await expect(page.getByRole('heading', { name: 'Ledger entry 4', exact: true })).toHaveCount(0)
  })

  test('opens the Reader from anywhere in a lone box', async ({ page, installation }) => {
    await openDigest(page, installation)

    const box = page.locator('.feed-day')
    const { width } = (await box.boundingBox()) ?? { width: 0 }
    await box.click({ position: { x: width - 40, y: 12 } })

    await expect(page).toHaveURL(/\/reader\//)
  })
})

test.describe('the Digest at phone width', () => {
  test.use({ viewport: { width: 390, height: 760 } })

  test('keeps the counted structure without overflowing the screen', async ({ page, installation }) => {
    await openDigest(page, installation)

    await expect(page.getByRole('heading', { name: TODAY_ONE })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('leaves saving to the Reader, so the title has the box', async ({ page, installation }) => {
    await openDigest(page, installation)

    await expect(page.getByRole('heading', { name: 'First light' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save First light' })).toBeHidden()
  })

  test('wraps a shared title and names it saved after a save from the Reader', async ({ page, installation }) => {
    await claimAndSubscribe(page, installation, installation.ledgerFeedUrl, 'Valley Ledger')
    await page.getByRole('link', { name: 'Digest', exact: true }).click()

    await expect(page.getByText('2 items')).toBeVisible()

    const row = page.locator('.feed-day-item', { hasText: LEDGER_LONG_TITLE })
    const short = page.locator('.feed-day-item', { hasText: 'Dry again' })
    expect(await sharedTitle(row)).toEqual({ lines: 3, fits: true, titleClamped: true })
    expect(await sharedTitle(short)).toEqual({ lines: 1, fits: true, titleClamped: false })

    await page.getByRole('link', { name: LEDGER_LONG_TITLE }).click()
    await page.getByRole('button', { name: `Save ${LEDGER_LONG_TITLE}` }).click()
    await expect(page.getByRole('button', { name: `Saved ${LEDGER_LONG_TITLE}` })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.goBack()

    await expect(row.getByRole('heading', { name: `Saved: ${LEDGER_LONG_TITLE}` })).toBeVisible()
    expect(await sharedTitle(row)).toMatchObject({ lines: 3, fits: true })
  })

  // iOS zooms the page into a focused field set under 16px.
  test('focuses search at a size iOS does not zoom', async ({ page, installation }) => {
    await openDigest(page, installation)

    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const search = page.getByRole('searchbox', { name: 'Search your reading' })
    await expect(search).toBeFocused()
    expect(
      await search.evaluate((input) => Number.parseFloat(getComputedStyle(input).fontSize)),
    ).toBeGreaterThanOrEqual(16)
  })

  test('reads from a picked date without overflowing the screen', async ({ page, installation }) => {
    await subscribe(page, installation)
    await addFeed(page, installation.longFeedUrl)
    await expect(page.getByRole('heading', { name: 'Long Meadow' })).toBeVisible()
    await page.getByRole('link', { name: 'Digest', exact: true }).click()

    await expect(page.getByRole('heading', { name: /^Today .+ 2$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Long Meadow 1' })).toBeVisible()
    await expect(page.locator('.digest-calendar')).toBeHidden()
    await expectNoHorizontalOverflow(page)

    await page.getByLabel('Start from a day').fill(daysAgo(1))
    await expect(page).toHaveURL(new RegExp(`\\?from=${daysAgo(1)}$`))
    await expect(page.getByRole('button', { name: 'Back to today' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('an unbroken title on a phone', () => {
  test.use({ viewport: { width: 320, height: 700 } })

  test('wraps inside the screen on the Digest and the Feed', async ({ page, installation }) => {
    await claimAndSubscribe(page, installation, installation.addressFeedUrl, 'Address Ledger')
    await page.getByRole('link', { name: 'Digest', exact: true }).click()

    await expect(page.locator('.feed-day-title').getByRole('link', { name: UNBROKEN_TITLE })).toBeVisible()
    await expectNoBoxPastTheSideEdge(page)

    await page.getByRole('link', { name: 'Address Ledger' }).click()
    await expect(page.getByRole('heading', { name: 'Address Ledger' })).toBeVisible()
    await expect(page.locator('.item-title').getByRole('link', { name: UNBROKEN_TITLE })).toBeVisible()
    await expectNoBoxPastTheSideEdge(page)
  })
})
