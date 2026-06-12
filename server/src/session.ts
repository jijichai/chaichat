import { sign, verify } from 'hono/jwt';

export interface SessionClaims {
  /** DID of the account. */
  sub: string;
  /** chaichat identity row id. */
  iid: string;
  /** platform of the identity row. */
  plt: string;
  exp: number;
  iat: number;
  [key: string]: unknown;
}

const SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 days

export async function mintSessionJwt(
  secret: string,
  claims: { did: string; identityId: string; platform: string },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionClaims = {
    sub: claims.did,
    iid: claims.identityId,
    plt: claims.platform,
    iat: now,
    exp: now + SESSION_TTL_S,
  };
  return sign(payload, secret, 'HS256');
}

export async function verifySessionJwt(
  secret: string,
  token: string,
): Promise<SessionClaims | null> {
  try {
    const payload = (await verify(token, secret, 'HS256')) as SessionClaims;
    if (typeof payload.sub !== 'string' || typeof payload.iid !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}
