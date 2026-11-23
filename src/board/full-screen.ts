import { t } from '../i18n.ts';
import { IconExitFullScreen, IconFullScreen } from '../icons.ts';
import { applyButtonIcon } from '../shared/tools-menu.ts';

// Safari on iPad still names these with a webkit prefix.
interface WebkitDocument {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?(): Promise<void> | void;
}
interface WebkitElement {
  webkitRequestFullscreen?(): Promise<void> | void;
}

const doc = () => document as Document & WebkitDocument;
const current = () => doc().fullscreenElement ?? doc().webkitFullscreenElement ?? null;

/**
 * The full-screen button in the zoom bar. It hides itself where the browser can't put the
 * page in full screen, such as Safari on iPhone.
 */
export function createFullScreenButton(button: HTMLButtonElement) {
  const root = document.documentElement as HTMLElement & WebkitElement;
  const supported = Boolean(doc().fullscreenEnabled || doc().webkitFullscreenEnabled);
  button.hidden = !supported;

  function sync() {
    const active = Boolean(current());
    applyButtonIcon(button, active ? IconExitFullScreen : IconFullScreen);
    const label = t(active ? 'exitFullScreen' : 'fullScreen');
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', label);
    button.title = label;
  }
  async function toggle() {
    try {
      if (current()) await (doc().exitFullscreen?.() ?? doc().webkitExitFullscreen?.());
      else await (root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.());
    } catch {
      // The browser refused (e.g. not from a user gesture); the button stays as it was.
    }
  }
  button.addEventListener('click', () => void toggle());
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  document.addEventListener('i18n:change', sync);
  sync();
  return { sync, isSupported: () => supported };
}
