import { randomDigits, sha256Hex } from './crypto';
import { mintAccessToken } from './identity';
import { sendOtpEmail } from './mailer';
import { updateEmail, PdsError } from './pds';
import type { IdentityRow, Storage } from './storage/types';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export class BackupError extends Error {
  constructor(
    public code: 'InvalidCode' | 'TooManyAttempts' | 'EmailInUse' | 'BindFailed',
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Step 1: store a 6-digit code for (email, did) and mail it. */
export async function startBackup(
  env: Env,
  store: Storage,
  did: string,
  emailRaw: string,
): Promise<void> {
  const email = normalizeEmail(emailRaw);
  const code = randomDigits(6);
  await store.putEmailOtp({
    emailHash: await sha256Hex(email),
    codeHash: await sha256Hex(`${email}:${code}`),
    did,
    attempts: 0,
    expiresAt: Date.now() + OTP_TTL_MS,
  });
  await sendOtpEmail(env, email, code);
}

/** Step 2: verify the code, then bind the email to the DID on the PDS. */
export async function confirmBackup(
  env: Env,
  store: Storage,
  identity: IdentityRow,
  emailRaw: string,
  otp: string,
): Promise<void> {
  const email = normalizeEmail(emailRaw);
  const emailHash = await sha256Hex(email);
  const row = await store.getEmailOtp(emailHash);

  if (!row || row.did !== identity.did || row.expiresAt < Date.now()) {
    throw new BackupError('InvalidCode');
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await store.deleteEmailOtp(emailHash);
    throw new BackupError('TooManyAttempts');
  }

  const expected = await sha256Hex(`${email}:${otp.trim()}`);
  if (expected !== row.codeHash) {
    await store.bumpEmailOtpAttempts(emailHash);
    throw new BackupError('InvalidCode');
  }
  await store.deleteEmailOtp(emailHash);

  // Dev loop: fake accounts have no real PDS — record the binding locally so
  // a dev restore (otp 000000) can find the DID, mirroring what a real
  // restore would create.
  if (env.DEV_FAKE_EPDS === '1' && identity.did.startsWith('did:plc:dev')) {
    const existing = await store.getIdentity('email', emailHash);
    if (!existing) {
      await store.insertIdentity({
        id: crypto.randomUUID(),
        platform: 'email',
        platformUserId: emailHash,
        did: identity.did,
        handle: identity.handle,
        displayName: null,
        avatarUrl: null,
        refreshJwtEnc: identity.refreshJwtEnc,
        backupEmailSet: true,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      });
    }
    await store.setBackupEmailSet(identity.did);
    return;
  }

  const { accessJwt } = await mintAccessToken(env, store, identity);
  try {
    await updateEmail(env.PDS_URL, accessJwt, email);
  } catch (err) {
    if (err instanceof PdsError && /taken|already|in use/i.test(err.message)) {
      throw new BackupError('EmailInUse');
    }
    throw new BackupError('BindFailed', err instanceof Error ? err.message : undefined);
  }
  await store.setBackupEmailSet(identity.did);
}
