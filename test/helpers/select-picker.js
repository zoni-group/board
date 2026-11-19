/** Selects the Select tool without opening its mode menu (tapping the active Select opens it). */
export async function selectSelectTool(page, touch = false) {
  const button = page.locator('#select');
  if ((await button.getAttribute('aria-pressed')) === 'true') return;
  if (touch) await button.tap();
  else await button.click();
}

/** Chooses a select mode ('one', 'box' or 'lasso') from the Select button's menu. */
export async function chooseSelectMode(page, mode, touch = false) {
  await selectSelectTool(page, touch);
  const button = page.locator('#select');
  const item = page.locator(`#selectPicker [data-kind="${mode}"]`);
  if (touch) {
    await button.tap();
    await item.tap();
  } else {
    await button.click();
    await item.click();
  }
}
