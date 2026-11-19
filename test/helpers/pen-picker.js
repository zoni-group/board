/** Selects the Pen tool without opening its type menu (tapping the active Pen opens it). */
export async function selectPen(page, touch = false) {
  const pen = page.locator('#pen');
  if ((await pen.getAttribute('aria-pressed')) === 'true') return;
  if (touch) await pen.tap();
  else await pen.click();
}

/** Chooses a pen type ('pen', 'highlighter' or 'laser') from the Pen button's menu. */
export async function choosePen(page, kind, touch = false) {
  await selectPen(page, touch);
  const pen = page.locator('#pen');
  const item = page.locator(`#penPicker [data-kind="${kind}"]`);
  if (touch) {
    await pen.tap();
    await item.tap();
  } else {
    await pen.click();
    await item.click();
  }
}
