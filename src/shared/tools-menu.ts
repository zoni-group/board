export function applyButtonIcon(button: Element | null, icon: string): void {
  const iconSlot = button?.querySelector('.btn-icon');
  if (!iconSlot) return;
  iconSlot.innerHTML = icon || '';
}

interface ToolsMenuOptions {
  button?: HTMLElement | null;
  list?: HTMLElement | null;
}

interface ToolsMenuController {
  close(): void;
  setOpen(isOpen: boolean): void;
}

export function initToolsMenu(options: ToolsMenuOptions = {}): ToolsMenuController {
  const button = options.button;
  const list = options.list;

  if (!button || !list) {
    return {
      close: function () {},
      setOpen: function () {},
    };
  }

  const setOpen = (isOpen: boolean): void => {
    list.hidden = !isOpen;
    button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  };

  function close() {
    setOpen(false);
  }

  button.addEventListener('click', function (event) {
    event.stopPropagation();
    setOpen(Boolean(list.hidden));
  });

  document.addEventListener('click', function (event) {
    if (list.hidden) return;
    if (!(event.target instanceof Node)) return;
    if (button.contains(event.target) || list.contains(event.target)) return;
    close();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') close();
  });

  return {
    close: close,
    setOpen: setOpen,
  };
}
