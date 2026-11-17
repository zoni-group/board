export async function boardAction(page, id) {
  if (!(await page.locator('#boardMenu').isVisible())) await page.locator('#boards').click();
  await page.locator(`#boardMenu #${id}`).click();
}
