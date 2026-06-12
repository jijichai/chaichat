import {
  onWalletChange,
  signMessage,
  requestCreateAccount,
  isMiniappMode,
} from '@aboutcircles/miniapp-sdk';
import type { CirclesProof } from './types';

export { requestCreateAccount, isMiniappMode };

/**
 * Wait for the Circles host to push a connected Safe address.
 *
 * The SDK posts `request_address` to the host once at module load and replays
 * the cached address to every new `onWalletChange` listener. But in some hosts
 * (e.g. the Circles playground) the host's listener may not be ready when that
 * first request fires, so we also re-poke `request_address` ourselves and wait
 * longer. Resolves with the address, or null on timeout.
 */
export function waitForWalletAddress(timeoutMs = 12000): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    // Declared before the onWalletChange subscription below — the SDK replays
    // the cached address SYNCHRONOUSLY, so finish() can run during that
    // subscription call. If these weren't already assigned (let, default
    // undefined), clearing them would hit a temporal-dead-zone error.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poke: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;

    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      if (poke !== undefined) clearInterval(poke);
      if (unsubscribe) unsubscribe();
      resolve(value);
    };

    const requestAddress = () => {
      if (typeof window !== 'undefined' && window.parent !== window) {
        window.parent.postMessage({ type: 'request_address' }, '*');
      }
    };

    // Set timers up first so finish() can clear them even if the subscription
    // fires synchronously below.
    timer = setTimeout(() => finish(null), timeoutMs);
    poke = setInterval(requestAddress, 1500);

    // Subscribe — replays the cached address immediately if we already have one.
    unsubscribe = onWalletChange((address) => {
      if (address) finish(address);
    });

    requestAddress();
  });
}

/** Subscribe to wallet changes for the lifetime of the app (UI affordances). */
export function onCirclesWallet(fn: (address: string | null) => void): () => void {
  return onWalletChange(fn);
}

/**
 * Produce the v1 identity proof: ask the backend for a nonce + canonical
 * message, have the host's Safe sign it (EIP-1271 style), and return the
 * proof body for /api/auth/verify.
 */
export async function getCirclesProof(
  address: string,
  fetchNonce: (address: string) => Promise<{ nonce: string; message: string }>,
): Promise<CirclesProof> {
  const { nonce, message } = await fetchNonce(address);
  const { signature } = await signMessage(message, 'erc1271');
  return { platform: 'circles', address, signature, nonce };
}
