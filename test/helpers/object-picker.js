export async function chooseObject(page, kind, touch = false) {
  const trigger = page.locator('#text');
  const item = page.locator(`#objectPicker [data-object="${kind}"]`);
  if (touch) {
    await trigger.tap();
    await item.tap();
  } else {
    await trigger.click();
    await item.click();
  }
}
