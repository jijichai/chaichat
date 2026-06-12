import type { HostKind } from './types';

/**
 * Detect which host the app is running inside.
 *
 * v1 only distinguishes the Circles miniapp host (an iframe) from a plain
 * browser tab. The check is intentionally async and ordered so that v2 can
 * prepend the World App check (`window.WorldApp`) and the Farcaster check
 * (`await sdk.isInMiniApp()`) before the iframe fallthrough — both of those
 * hosts may also frame the app.
 */
export async function detectHost(): Promise<HostKind> {
  if (import.meta.env.DEV) {
    const override = new URLSearchParams(location.search).get('host');
    if (override === 'circles' || override === 'browser') return override;
  }
  if (typeof window !== 'undefined' && window.parent !== window) return 'circles';
  return 'browser';
}
