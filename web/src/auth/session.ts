/** Persisted client session. Never contains a refreshJwt — that stays server-side. */
export interface StoredSession {
  sessionJwt: string;
  did: string;
  handle: string;
  nick: string;
  accessJwt: string;
  accessExpiresAt: number; // unix ms
  backupEmailSet: boolean;
  platform: string;
}

const KEY = 'chaichat.session.v1';

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (!s.sessionJwt || !s.did) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: StoredSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage full/blocked — session just won't persist
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** True when the access token is still comfortably valid (>5 min left). */
export function accessTokenFresh(s: StoredSession, now = Date.now()): boolean {
  return s.accessExpiresAt - now > 5 * 60 * 1000;
}
