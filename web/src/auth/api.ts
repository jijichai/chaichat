import type { PlatformProof } from '../host/types';

export interface VerifyResponse {
  did: string;
  handle: string;
  nick: string;
  accessJwt: string;
  accessExpiresAt: number;
  sessionJwt: string;
  isNew: boolean;
  backupEmailSet: boolean;
  platform: string;
}

export interface TokensResponse {
  did: string;
  handle: string;
  nick: string;
  accessJwt: string;
  accessExpiresAt: number;
  backupEmailSet: boolean;
}

export type CircleMode = 'open' | 'mutual-trust';

export interface CircleSummary {
  slug: string;
  name: string;
  description: string | null;
  channel: string;
  communityDid: string;
  groupAddress: string | null;
  mode: CircleMode;
  memberCount: number;
  joined?: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

async function request<T>(path: string, init: RequestInit = {}, sessionJwt?: string): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sessionJwt) headers.authorization = `Bearer ${sessionJwt}`;
  const res = await fetch(path, { ...init, headers: { ...headers, ...init.headers } });
  if (!res.ok) {
    let code = `HTTP${res.status}`;
    let message: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      code = body.error ?? code;
      message = body.message;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

export const api = {
  nonce: (platform: 'circles', address: string) =>
    request<{ nonce: string; message: string }>('/api/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({ platform, address }),
    }),

  verify: (proof: PlatformProof) =>
    request<VerifyResponse>('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify(proof),
    }),

  sessionTokens: (sessionJwt: string) =>
    request<TokensResponse>('/api/session/tokens', { method: 'POST' }, sessionJwt),

  me: (sessionJwt: string) =>
    request<{
      did: string;
      handle: string;
      platform: string;
      displayName: string | null;
      backupEmailSet: boolean;
    }>('/api/me', {}, sessionJwt),

  backupStart: (sessionJwt: string, email: string) =>
    request<{ ok: true }>(
      '/api/backup/start',
      { method: 'POST', body: JSON.stringify({ email }) },
      sessionJwt,
    ),

  backupConfirm: (sessionJwt: string, email: string, otp: string) =>
    request<{ ok: true }>(
      '/api/backup/confirm',
      { method: 'POST', body: JSON.stringify({ email, otp }) },
      sessionJwt,
    ),

  restoreStart: (email: string) =>
    request<{ ok: true }>('/api/restore/start', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  restoreConfirm: (email: string, otp: string) =>
    request<VerifyResponse>('/api/restore/confirm', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    }),

  listCircles: (sessionJwt?: string) =>
    request<{ circles: CircleSummary[]; createEnabled: boolean; onChainEnabled: boolean }>(
      '/api/circles',
      {},
      sessionJwt,
    ),

  createCircle: (sessionJwt: string, name: string, mode: CircleMode, description?: string) =>
    request<CircleSummary>(
      '/api/circles',
      { method: 'POST', body: JSON.stringify({ name, mode, description }) },
      sessionJwt,
    ),

  joinCircle: (sessionJwt: string, slug: string) =>
    request<{ ok: true; trusted: boolean }>(
      `/api/circles/${encodeURIComponent(slug)}/join`,
      { method: 'POST' },
      sessionJwt,
    ),

  profiles: (nicks: string[]) =>
    request<{ profiles: Record<string, { displayName: string | null; avatar: string | null }> }>(
      `/api/profiles?nicks=${encodeURIComponent(nicks.join(','))}`,
    ),
};
