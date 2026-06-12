/** Host environments chaichat can run inside. v2 adds 'farcaster' and 'world'. */
export type HostKind = 'circles' | 'browser';

export interface CirclesProof {
  platform: 'circles';
  address: string;
  signature: string;
  nonce: string;
}

/** Discriminated union of platform identity proofs sent to /api/auth/verify. */
export type PlatformProof = CirclesProof;
