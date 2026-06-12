import type { Platform } from '../storage/types';

/** Result of verifying a host identity proof. */
export interface VerifiedIdentity {
  platform: Platform;
  platformUserId: string;
  displayName?: string;
  avatarUrl?: string;
}

export class ProofError extends Error {
  constructor(
    public code:
      | 'InvalidNonce'
      | 'InvalidSignature'
      | 'InvalidProof'
      | 'UnsupportedPlatform',
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface CirclesProofBody {
  platform: 'circles';
  address: string;
  signature: string;
  nonce: string;
}

/** Discriminated union of proof bodies; v2 adds farcaster/world variants. */
export type ProofBody = CirclesProofBody;

/** Canonical login message — must match what the client asks the Safe to sign. */
export function buildLoginMessage(appDomain: string, address: string, nonce: string): string {
  return `chaichat login\nApp: ${appDomain}\nSafe: ${address}\nNonce: ${nonce}`;
}
