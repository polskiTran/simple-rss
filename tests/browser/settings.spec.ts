import type { Page } from '@playwright/test'
import { claim, expect, expectNoHorizontalOverflow, goTo, test, type Installation } from './installation.js'

async function expectTimezoneInsideThePage(page: Page, installation: Installation): Promise<void> {
  await claim(page, installation.url)
  await goTo(page, 'Settings')
  const select = page.getByLabel('Timezone')
  await expect(select).toBeVisible()

  const edges = await select.evaluate((element) => {
    const page = document.querySelector<HTMLElement>('.x-page')
    const padding = page ? Number.parseFloat(getComputedStyle(page).paddingRight) : 0
    return {
      right: Math.round(element.getBoundingClientRect().right),
      pageRight: Math.round(document.documentElement.clientWidth - padding + 10),
    }
  })
  expect(edges.right).toBeLessThanOrEqual(edges.pageRight)

  await expectNoHorizontalOverflow(page)
}

test.describe('Settings at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('the timezone select stays inside the page', async ({ page, installation }) => {
    await expectTimezoneInsideThePage(page, installation)
  })
})

test.describe('Settings on the narrowest phone', () => {
  test.use({
    viewport: { width: 320, height: 640 },
    isMobile: true,
    hasTouch: true,
    timezoneId: 'America/North_Dakota/New_Salem',
  })

  test('a long timezone stays inside the page', async ({ page, installation }) => {
    await expectTimezoneInsideThePage(page, installation)
  })
})
