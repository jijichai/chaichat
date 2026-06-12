/** Client for the ePDS headless internal API (auth.self.surf). API key is server-side only. */

export interface EpdsTokens {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
  created?: boolean;
}

export class EpdsError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

interface EpdsConfig {
  baseUrl: string;
  apiKey: string;
  /** '1' = fake the ePDS locally (dev loop without a production API key). */
  devFake?: string;
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodable-but-unsigned JWT for the local dev loop. */
export function makeFakeJwt(did: string, ttlS: number, kind: 'access' | 'refresh'): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: did, iat: now, exp: now + ttlS, scope: kind }));
  return `dev.${header}.${payload}`;
}

async function fakeTokens(handle: string, seed: string): Promise<EpdsTokens> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const did = `did:plc:dev${hex.slice(0, 21)}`;
  return {
    did,
    handle: `${handle}.self.surf`,
    accessJwt: makeFakeJwt(did, 90 * 60, 'access'),
    refreshJwt: makeFakeJwt(did, 90 * 24 * 60 * 60, 'refresh'),
    created: true,
  };
}

async function epdsFetch<T>(cfg: EpdsConfig, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let code = `HTTP${res.status}`;
    let message: string | undefined;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      code = data.error ?? code;
      message = data.message;
    } catch {
      // non-JSON error
    }
    throw new EpdsError(res.status, code, message);
  }
  return (await res.json()) as T;
}

/** Direct server-to-server account creation (requires can_create_directly). */
export function createAccount(
  cfg: EpdsConfig,
  handle: string,
  email: string,
): Promise<EpdsTokens> {
  if (cfg.devFake === '1') return fakeTokens(handle, email);
  return epdsFetch<EpdsTokens>(cfg, '/_internal/account/create', { handle, email });
}

/** Send a login OTP to an email (always succeeds — anti-enumeration). */
export function otpSendLogin(cfg: EpdsConfig, email: string, clientId?: string): Promise<unknown> {
  if (cfg.devFake === '1') return Promise.resolve({ success: true });
  return epdsFetch(cfg, '/_internal/otp/send', {
    email,
    purpose: 'login',
    ...(clientId ? { clientId } : {}),
  });
}

/** Verify a login OTP — returns tokens for the account whose current email matches. */
export function otpVerifyLogin(cfg: EpdsConfig, email: string, otp: string): Promise<EpdsTokens> {
  return epdsFetch<EpdsTokens>(cfg, '/_internal/otp/verify', {
    email,
    otp: otp.toUpperCase(),
    purpose: 'login',
  });
}

/** True when the ePDS error indicates the handle is taken (currently a 500 + prose). */
export function isHandleTakenError(err: unknown): boolean {
  return (
    err instanceof EpdsError &&
    (err.code === 'HandleNotAvailable' ||
      /handle.*(taken|already|unavailable)/i.test(err.message))
  );
}
