import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageNav } from '../../src/board/page-nav.ts';
import { setLang } from '../../src/i18n.ts';

function setup() {
  document.body.innerHTML = `<nav id="pageNav" hidden>
    <button id="prevPage"><span class="btn-icon"></span></button>
    <button id="pageMenuButton" aria-expanded="false"></button>
    <span id="pageLive" class="sr-only"></span>
    <button id="nextPage"><span class="btn-icon"></span></button>
  </nav>`;
  const nav = document.getElementById('pageNav');
  const calls = {
    go: vi.fn(),
    add: vi.fn(),
    duplicate: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
  };
  return { nav, calls, pages: createPageNav({ nav, ...calls }) };
}
const $ = (selector) => document.querySelector(selector);
const key = (pages, name, options = {}) =>
  pages.handleKey(new KeyboardEvent('keydown', { key: name, cancelable: true, ...options }));

describe('page control', () => {
  beforeEach(() => setLang('en'));

  it('stays hidden while a board has one page', () => {
    const { nav, pages } = setup();
    pages.sync(0, 1);
    expect(nav.hidden).toBe(true);
  });

  it('shows the position, disables the ends and moves by one page', () => {
    const { nav, calls, pages } = setup();
    pages.sync(0, 3);
    expect(nav.hidden).toBe(false);
    expect($('#pageMenuButton').textContent).toBe('1 / 3');
    expect($('#pageMenuButton').getAttribute('aria-label')).toBe('Page 1 of 3 · Page actions');
    expect($('#pageLive').textContent).toBe('Page 1 of 3');
    expect($('#prevPage').disabled).toBe(true);
    $('#nextPage').click();
    expect(calls.go).toHaveBeenCalledWith(1);
    pages.sync(2, 3);
    expect($('#nextPage').disabled).toBe(true);
    $('#prevPage').click();
    expect(calls.go).toHaveBeenLastCalledWith(1);
  });

  it('opens the Page menu from the page number and runs each action', () => {
    const { calls, pages } = setup();
    pages.sync(1, 3);
    $('#pageMenuButton').click();
    expect($('#pageMenuButton').getAttribute('aria-expanded')).toBe('true');
    expect(
      [...$('#pageMenu').querySelectorAll('.menu-item')].map((b) => b.textContent.trim())
    ).toEqual(['Add page', 'Duplicate page', 'Move earlier', 'Move later', 'Delete page']);
    expect(document.activeElement.id).toBe('addPageAfter');
    $('#movePageLater').click();
    expect(calls.move).toHaveBeenCalledWith(1);
    expect(pages.isOpen()).toBe(false);
    expect(document.activeElement.id).toBe('pageMenuButton');
    for (const [id, call] of [
      ['addPageAfter', calls.add],
      ['duplicatePage', calls.duplicate],
      ['deletePage', calls.remove],
    ]) {
      pages.open();
      $(`#${id}`).click();
      expect(call).toHaveBeenCalledTimes(1);
    }
    pages.open();
    $('#movePageEarlier').click();
    expect(calls.move).toHaveBeenLastCalledWith(-1);
  });

  it('disables moves past the ends', () => {
    const { pages } = setup();
    pages.sync(0, 2);
    expect($('#movePageEarlier').disabled).toBe(true);
    expect($('#movePageLater').disabled).toBe(false);
    pages.sync(1, 2);
    expect($('#movePageEarlier').disabled).toBe(false);
    expect($('#movePageLater').disabled).toBe(true);
  });

  it('moves focus with arrows, Home and End, and Escape returns to the page number', () => {
    const { pages } = setup();
    pages.sync(0, 2);
    expect(key(pages, 'ArrowDown')).toBe(false);
    pages.open();
    expect(document.activeElement.id).toBe('addPageAfter');
    key(pages, 'ArrowDown');
    expect(document.activeElement.id).toBe('duplicatePage');
    // Move earlier is disabled on page 1, so it is skipped.
    key(pages, 'ArrowDown');
    expect(document.activeElement.id).toBe('movePageLater');
    key(pages, 'End');
    expect(document.activeElement.id).toBe('deletePage');
    key(pages, 'ArrowDown');
    expect(document.activeElement.id).toBe('addPageAfter');
    key(pages, 'Home');
    key(pages, 'ArrowUp');
    expect(document.activeElement.id).toBe('deletePage');
    expect(key(pages, 'v')).toBe(true);
    key(pages, 'Escape');
    expect(pages.isOpen()).toBe(false);
    expect(document.activeElement.id).toBe('pageMenuButton');
  });

  it('relabels for screen readers when the language changes', () => {
    const { pages } = setup();
    pages.sync(1, 2);
    setLang('es');
    document.dispatchEvent(new CustomEvent('i18n:change'));
    expect($('#pageLive').textContent).toBe('Página 2 de 2');
    expect($('#duplicatePage').textContent.trim()).toBe('Duplicar página');
    expect($('#pageMenu').getAttribute('aria-label')).toBe('Acciones de página');
  });
});
