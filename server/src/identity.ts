import { aesDecrypt, aesEncrypt, jwtExpiresAtMs, sha256Hex } from './crypto';
import { createAccount, isHandleTakenError, makeFakeJwt, type EpdsTokens } from './epds';
import { randomHandle } from './handles';
import { refreshSession } from './pds';
import type { IdentityRow, Storage } from './storage/types';
import type { VerifiedIdentity } from './platform/types';

export interface AccessTokenResult {
  accessJwt: string;
  accessExpiresAt: number;
}

export class UnrecoverableSessionError extends Error {
  constructor(public backupEmailSet: boolean) {
    super('No working refresh token for this DID');
  }
}

function epdsConfig(env: Env) {
  return { baseUrl: env.EPDS_BASE_URL, apiKey: env.EPDS_API_KEY, devFake: env.DEV_FAKE_EPDS };
}

/**
 * Find or create the identity row (and underlying DID account) for a verified
 * platform identity. Concurrency-safe: the UNIQUE(platform, platform_user_id)
 * constraint plus insert-or-ignore-then-reread means a double-tap can't mint
 * two DIDs.
 */
export async function findOrCreateIdentity(
  env: Env,
  store: Storage,
  verified: VerifiedIdentity,
): Promise<{ identity: IdentityRow; tokens: AccessTokenResult; isNew: boolean }> {
  const existing = await store.getIdentity(verified.platform, verified.platformUserId);
  if (existing) {
    const tokens = await mintAccessToken(env, store, existing);
    await store.touchLastSeen(existing.id, Date.now());
    return { identity: existing, tokens, isNew: false };
  }

  const created = await createDidAccount(env, verified);
  const now = Date.now();
  const row: IdentityRow = {
    id: crypto.randomUUID(),
    platform: verified.platform,
    platformUserId: verified.platformUserId,
    did: created.did,
    handle: created.handle,
    displayName: verified.displayName ?? null,
    avatarUrl: verified.avatarUrl ?? null,
    refreshJwtEnc: await aesEncrypt(created.refreshJwt, env.TOKEN_ENC_KEY),
    backupEmailSet: false,
    createdAt: now,
    lastSeenAt: now,
  };
  await store.insertIdentity(row);

  // Re-read: if a concurrent request won the unique-constraint race, use its
  // row (our freshly created DID account is then orphaned — harmless).
  const canonical = await store.getIdentity(verified.platform, verified.platformUserId);
  if (canonical && canonical.id !== row.id) {
    const tokens = await mintAccessToken(env, store, canonical);
    return { identity: canonical, tokens, isNew: false };
  }

  return {
    identity: row,
    tokens: { accessJwt: created.accessJwt, accessExpiresAt: jwtExpiresAtMs(created.accessJwt) },
    isNew: true,
  };
}

async function createDidAccount(env: Env, verified: VerifiedIdentity): Promise<EpdsTokens> {
  const puidHash = await sha256Hex(`${verified.platform}:${verified.platformUserId}`);
  const opaqueEmail = `${verified.platform}-${puidHash.slice(0, 12)}@noreply.${env.APP_DOMAIN}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const handle = randomHandle();
    try {
      return await createAccount(epdsConfig(env), handle, opaqueEmail);
    } catch (err) {
      lastErr = err;
      if (!isHandleTakenError(err)) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not create account');
}

/**
 * Mint a fresh PDS access token for an identity from server-side custody.
 *
 * Single-writer custody rule: the refreshJwt lives only in the DB. Rotation =
 * overwrite the column. On failure, fall back to any sibling row of the same
 * DID that still has a working token (covers ePDS's revoke-all-on-login
 * cascade, where the restore path re-custodies a fresh token on every row).
 */
export async function mintAccessToken(
  env: Env,
  store: Storage,
  identity: IdentityRow,
): Promise<AccessTokenResult> {
  const candidates: IdentityRow[] = [identity];
  for (const sibling of await store.getIdentitiesByDid(identity.did)) {
    if (sibling.id !== identity.id) candidates.push(sibling);
  }

  for (const row of candidates) {
    if (!row.refreshJwtEnc) continue;
    try {
      const refreshJwt = await aesDecrypt(row.refreshJwtEnc, env.TOKEN_ENC_KEY);
      // Dev loop: fake-ePDS refresh tokens rotate locally, no PDS round-trip.
      const session =
        env.DEV_FAKE_EPDS === '1' && refreshJwt.startsWith('dev.')
          ? {
              did: identity.did,
              handle: identity.handle,
              accessJwt: makeFakeJwt(identity.did, 90 * 60, 'access'),
              refreshJwt: makeFakeJwt(identity.did, 90 * 24 * 60 * 60, 'refresh'),
            }
          : await refreshSession(env.PDS_URL, refreshJwt);
      // Re-custody the rotated token on EVERY row of this DID so all
      // platform identities stay recoverable.
      const enc = await aesEncrypt(session.refreshJwt, env.TOKEN_ENC_KEY);
      await store.updateRefreshJwtForDid(identity.did, enc);
      return { accessJwt: session.accessJwt, accessExpiresAt: jwtExpiresAtMs(session.accessJwt) };
    } catch {
      continue;
    }
  }

  throw new UnrecoverableSessionError(identity.backupEmailSet);
}
