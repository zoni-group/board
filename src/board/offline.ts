/**
 * Registers the build-generated service worker so the board opens and every tool
 * works without a connection after one online visit. Updates install in the
 * background and apply on the next launch; the page is never reloaded for them.
 */
export function registerOfflineSupport(enabled: boolean = import.meta.env.PROD): void {
  if (!enabled || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  const register = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((error: unknown) => console.warn('Offline support unavailable', error));
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
