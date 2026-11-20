import { t } from '../i18n.ts';
import { IconChevronLeft, IconChevronRight } from '../icons.ts';
import { applyButtonIcon } from '../shared/tools-menu.ts';

export interface PageNavOptions {
  nav: HTMLElement;
  go(index: number): void;
}

/** The ‹ 2 / 5 › control. It stays hidden while a board has a single page. */
export function createPageNav({ nav, go }: PageNavOptions) {
  const prev = nav.querySelector<HTMLButtonElement>('#prevPage');
  const next = nav.querySelector<HTMLButtonElement>('#nextPage');
  const label = nav.querySelector<HTMLElement>('#pageLabel');
  const count = document.createElement('span'),
    spoken = document.createElement('span');
  count.setAttribute('aria-hidden', 'true');
  spoken.className = 'sr-only';
  label?.replaceChildren(count, spoken);
  applyButtonIcon(prev, IconChevronLeft);
  applyButtonIcon(next, IconChevronRight);
  let index = 0,
    total = 1;
  prev?.addEventListener('click', () => go(index - 1));
  next?.addEventListener('click', () => go(index + 1));

  function sync(page = index, pages = total) {
    index = page;
    total = pages;
    nav.hidden = total <= 1;
    count.textContent = `${index + 1} / ${total}`;
    spoken.textContent = t('pageOf', { page: index + 1, count: total });
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index >= total - 1;
  }
  document.addEventListener('i18n:change', () => sync());
  sync();
  return { sync };
}
