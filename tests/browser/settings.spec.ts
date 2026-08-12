import { expect, expectNoHorizontalOverflow, SETUP_SECRET, test, USER_PASSWORD } from './installation.js'

// The timezone select is the one control sized by its content — every zone the
// runtime knows. Only a real browser lays that out, hence the assertion here, not jsdom.
test.describe('Settings at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('the timezone select stays inside the paper', async ({ page, installation }) => {
    await page.goto(installation.url)
    await page.getByLabel('setup secret').fill(SETUP_SECRET)
    await page.getByLabel('password', { exact: true }).fill(USER_PASSWORD)
    await page.getByLabel('confirm password').fill(USER_PASSWORD)
    await page.getByRole('button', { name: 'claim' }).click()

    await page.getByRole('link', { name: 'settings' }).click()
    const select = page.getByLabel('installation timezone')
    await expect(select).toBeVisible()

    // The select ends where the paper's content does, and nothing has forced
    // the page wider than the phone: settings needs no panning.
    const edges = await page.evaluate(() => {
      const paper = document.querySelector('.paper') as HTMLElement
      const box = (document.querySelector('.sheet-select') as HTMLElement).getBoundingClientRect()
      const padding = Number.parseFloat(getComputedStyle(paper).paddingRight)
      return { right: Math.round(box.right), contentRight: Math.round(paper.clientWidth - padding) }
    })
    expect(edges.right).toBeLessThanOrEqual(edges.contentRight)

    await expectNoHorizontalOverflow(page)
  })
})
