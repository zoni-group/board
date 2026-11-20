import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageNav } from '../../src/board/page-nav.ts';
import { setLang } from '../../src/i18n.ts';

function markup() {
  document.body.innerHTML = `<nav id="pageNav" hidden>
    <button id="prevPage"><span class="btn-icon"></span></button>
    <span id="pageLabel"></span>
    <button id="nextPage"><span class="btn-icon"></span></button>
  </nav>`;
  return document.getElementById('pageNav');
}

describe('page control', () => {
  beforeEach(() => setLang('en'));

  it('stays hidden while a board has one page', () => {
    const nav = markup();
    createPageNav({ nav, go: () => {} }).sync(0, 1);
    expect(nav.hidden).toBe(true);
  });

  it('shows the position, disables the ends and moves by one page', () => {
    const nav = markup(),
      go = vi.fn();
    const pages = createPageNav({ nav, go });
    pages.sync(0, 3);
    expect(nav.hidden).toBe(false);
    expect(nav.querySelector('#pageLabel [aria-hidden="true"]').textContent).toBe('1 / 3');
    expect(nav.querySelector('.sr-only').textContent).toBe('Page 1 of 3');
    expect(nav.querySelector('#prevPage').disabled).toBe(true);
    expect(nav.querySelector('#nextPage').disabled).toBe(false);
    nav.querySelector('#nextPage').click();
    expect(go).toHaveBeenCalledWith(1);
    pages.sync(2, 3);
    expect(nav.querySelector('#nextPage').disabled).toBe(true);
    nav.querySelector('#prevPage').click();
    expect(go).toHaveBeenLastCalledWith(1);
  });

  it('relabels for screen readers when the language changes', () => {
    const nav = markup();
    createPageNav({ nav, go: () => {} }).sync(1, 2);
    setLang('es');
    document.dispatchEvent(new CustomEvent('i18n:change'));
    expect(nav.querySelector('.sr-only').textContent).toBe('Página 2 de 2');
  });
});
