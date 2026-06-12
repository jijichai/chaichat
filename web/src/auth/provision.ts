import { api, type VerifyResponse } from './api';
import {
  loadSession,
  saveSession,
  clearSession,
  accessTokenFresh,
  type StoredSession,
} from './session';
import { getCirclesProof, waitForWalletAddress } from '../host/circles';
import type { HostKind } from '../host/types';

export type ProvisionPhase =
  | 'cached'
  | 'refreshing'
  | 'waiting-wallet'
  | 'signing'
  | 'verifying';

export class NeedsWalletError extends Error {
  constructor() {
    super('No wallet connected in the Circles host');
  }
}

export class NeedsManualAuthError extends Error {
  constructor() {
    super('Plain browser: user must restore by email or continue as guest');
  }
}

function sessionFromVerify(v: VerifyResponse): StoredSession {
  return {
    sessionJwt: v.sessionJwt,
    did: v.did,
    handle: v.handle,
    nick: v.nick,
    accessJwt: v.accessJwt,
    accessExpiresAt: v.accessExpiresAt,
    backupEmailSet: v.backupEmailSet,
    platform: v.platform,
  };
}

/** Persist a fresh verify/restore response and return the stored session. */
export function adoptVerifiedSession(v: VerifyResponse): StoredSession {
  const s = sessionFromVerify(v);
  saveSession(s);
  return s;
}

/** Refresh the access token of an existing session via the backend custody. */
export async function refreshTokens(session: StoredSession): Promise<StoredSession> {
  const t = await api.sessionTokens(session.sessionJwt);
  const next: StoredSession = {
    ...session,
    did: t.did,
    handle: t.handle,
    nick: t.nick,
    accessJwt: t.accessJwt,
    accessExpiresAt: t.accessExpiresAt,
    backupEmailSet: t.backupEmailSet,
  };
  saveSession(next);
  return next;
}

/**
 * Get a usable session for the current host, creating the DID account on the
 * fly for first-time Circles-host users.
 *
 * Throws NeedsWalletError when the Circles host has no connected wallet
 * (caller shows the requestCreateAccount CTA) and NeedsManualAuthError in a
 * plain browser (caller shows the welcome screen).
 */
export async function provision(
  host: HostKind,
  onPhase: (phase: ProvisionPhase) => void = () => {},
): Promise<StoredSession> {
  const cached = loadSession();
  if (cached) {
    if (accessTokenFresh(cached)) {
      onPhase('cached');
      return cached;
    }
    onPhase('refreshing');
    try {
      return await refreshTokens(cached);
    } catch {
      // Custodied refresh failed (revoked/expired) or session JWT invalid.
      // Fall through to a full host auth; keep nothing stale around.
      clearSession();
    }
  }

  if (host === 'circles') {
    onPhase('waiting-wallet');
    const address = await waitForWalletAddress();
    if (!address) throw new NeedsWalletError();
    onPhase('signing');
    const proof = await getCirclesProof(address, async (addr) => api.nonce('circles', addr));
    onPhase('verifying');
    const verified = await api.verify(proof);
    return adoptVerifiedSession(verified);
  }

  throw new NeedsManualAuthError();
}
