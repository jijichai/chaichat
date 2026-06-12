const enc = new TextEncoder();
const dec = new TextDecoder();

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importAesKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64decode(keyB64);
  if (raw.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 bytes (base64)');
  return crypto.subtle.importKey('raw', raw.buffer as ArrayBuffer, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

/** AES-256-GCM encrypt; output = base64(iv || ciphertext). */
export async function aesEncrypt(plaintext: string, keyB64: string): Promise<string> {
  const key = await importAesKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64encode(out);
}

export async function aesDecrypt(payloadB64: string, keyB64: string): Promise<string> {
  const key = await importAesKey(keyB64);
  const payload = b64decode(payloadB64);
  const iv = payload.slice(0, 12);
  const ct = payload.slice(12);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ct.buffer as ArrayBuffer,
  );
  return dec.decode(pt);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Cryptographically random numeric code of `length` digits (leading zeros allowed). */
export function randomDigits(length: number): string {
  const digits = new Uint8Array(length);
  crypto.getRandomValues(digits);
  return [...digits].map((b) => (b % 10).toString()).join('');
}

/** URL-safe random token. */
export function randomToken(bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return b64encode(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a JWT's payload without verifying (for reading exp off PDS tokens). */
export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1];
  if (!part) throw new Error('not a JWT');
  const norm = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  return JSON.parse(dec.decode(b64decode(padded))) as Record<string, unknown>;
}

/** Expiry (unix ms) of a PDS access token, with a sane fallback of +90 min. */
export function jwtExpiresAtMs(jwt: string): number {
  try {
    const exp = decodeJwtPayload(jwt)['exp'];
    if (typeof exp === 'number') return exp * 1000;
  } catch {
    // fall through
  }
  return Date.now() + 90 * 60 * 1000;
}
