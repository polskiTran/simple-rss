import { expect, expectNoHorizontalOverflow, SETUP_SECRET, test, USER_PASSWORD } from './installation.js'

test.describe('Settings at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('the timezone select stays inside the page', async ({ page, installation }) => {
    await page.goto(installation.url)
    await page.getByLabel('Setup secret').fill(SETUP_SECRET)
    await page.getByLabel('Password', { exact: true }).fill(USER_PASSWORD)
    await page.getByLabel('Confirm password').fill(USER_PASSWORD)
    await page.getByRole('button', { name: 'Claim installation' }).click()

    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    const select = page.getByLabel('Installation timezone')
    await expect(select).toBeVisible()

    const edges = await page.evaluate(() => {
      const app = document.querySelector('.app') as HTMLElement
      const box = (document.querySelector('.select-control') as HTMLElement).getBoundingClientRect()
      const padding = Number.parseFloat(getComputedStyle(app).paddingRight)
      return { right: Math.round(box.right), contentRight: Math.round(app.clientWidth - padding) }
    })
    expect(edges.right).toBeLessThanOrEqual(edges.contentRight)

    await expectNoHorizontalOverflow(page)
  })
})
