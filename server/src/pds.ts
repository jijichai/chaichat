/** Direct XRPC calls against the self.surf PDS. */

export interface PdsSession {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
}

export class PdsError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

async function xrpc<T>(
  pdsUrl: string,
  nsid: string,
  token: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${pdsUrl}/xrpc/${nsid}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    let code = `HTTP${res.status}`;
    let message: string | undefined;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      code = data.error ?? code;
      message = data.message;
    } catch {
      // non-JSON
    }
    throw new PdsError(res.status, code, message);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** Rotate a session. The old refresh token is consumed. */
export function refreshSession(pdsUrl: string, refreshJwt: string): Promise<PdsSession> {
  return xrpc<PdsSession>(pdsUrl, 'com.atproto.server.refreshSession', refreshJwt);
}

/**
 * Set the account email. Works with just the access token while the current
 * email is unconfirmed (true for all chaichat direct-created accounts).
 * Fails with InvalidRequest/"token is required" if the email was confirmed.
 */
export function updateEmail(pdsUrl: string, accessJwt: string, email: string): Promise<unknown> {
  return xrpc(pdsUrl, 'com.atproto.server.updateEmail', accessJwt, { email });
}
