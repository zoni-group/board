import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerOfflineSupport } from '../../src/board/offline.ts';

function mockServiceWorker(register) {
  Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
}

describe('registerOfflineSupport', () => {
  afterEach(() => {
    delete navigator.serviceWorker;
    delete window.isSecureContext;
  });

  it('does nothing when disabled (development builds)', () => {
    const register = vi.fn(() => Promise.resolve());
    mockServiceWorker(register);
    registerOfflineSupport(false);
    expect(register).not.toHaveBeenCalled();
  });

  it('does nothing outside a secure context', () => {
    const register = vi.fn(() => Promise.resolve());
    mockServiceWorker(register);
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    registerOfflineSupport(true);
    expect(register).not.toHaveBeenCalled();
  });

  it('registers the root-scoped worker once the page has loaded', () => {
    const register = vi.fn(() => Promise.resolve());
    mockServiceWorker(register);
    registerOfflineSupport(true);
    if (document.readyState !== 'complete') window.dispatchEvent(new Event('load'));
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
  });

  it('only warns when registration fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockServiceWorker(vi.fn(() => Promise.reject(new Error('blocked'))));
    expect(() => registerOfflineSupport(true)).not.toThrow();
    if (document.readyState !== 'complete') window.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });
});
