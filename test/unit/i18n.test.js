import { beforeEach, describe, expect, it, vi } from "vitest";

describe("shared i18n", () => {
  let i18n;

  beforeEach(async () => {
    localStorage.clear();
    window.__lang = "en";
    document.body.innerHTML = `
      <button data-i18n="pen"></button>
      <button data-i18n-aria="changeLanguage"></button>
      <button data-i18n-title="tagline"></button>
      <input data-i18n-placeholder="hex" />
    `;
    vi.resetModules();
    i18n = await import("../../src/i18n.js");
  });

  it("applies shared translations to text, aria, title, and placeholder nodes", () => {
    i18n.applyTranslations();

    expect(document.querySelector('[data-i18n="pen"]').textContent).toBe("Pen");
    expect(document.querySelector("[data-i18n-aria]").getAttribute("aria-label")).toBe("Change language");
    expect(document.querySelector("[data-i18n-title]").getAttribute("title")).toContain("ZONI");
    expect(document.querySelector("[data-i18n-placeholder]").getAttribute("placeholder")).toBe("Hex");
  });

  it("translates board keys to Spanish and returns the key name for unknown keys", () => {
    i18n.setLang("es");

    expect(i18n.t("pen")).toBe("Lápiz");
    expect(i18n.t("eraser")).toBe("Borrador");
    expect(i18n.t("unknownKey")).toBe("unknownKey");
  });

  it("toggles language and persists the shared language key", () => {
    expect(i18n.getLang()).toBe("en");

    const next = i18n.toggleLang();

    expect(next).toBe("es");
    expect(localStorage.getItem("vatio_board_lang")).toBe("es");
    expect(document.documentElement.lang).toBe("es");
  });
});
