export type Platform = 'farcaster' | 'world' | 'circles' | 'email';

export interface IdentityRow {
  id: string;
  platform: Platform;
  platformUserId: string;
  did: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  refreshJwtEnc: string | null;
  backupEmailSet: boolean;
  createdAt: number;
  lastSeenAt: number;
}

export type CircleMode = 'open' | 'mutual-trust' | 'circles-group';

export interface CircleRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  channel: string;
  communityDid: string;
  groupAddress: string | null;
  ownerAddress: string | null;
  creatorIdentityId: string;
  mode: CircleMode;
  /** For mode='circles-group': the external Circles group whose members may
   *  join. Membership = this group trusts the joiner's Safe. */
  gateGroupAddress: string | null;
  createdAt: number;
}

export interface CircleWithCount extends CircleRow {
  memberCount: number;
}

export interface EmailOtpRow {
  emailHash: string;
  codeHash: string;
  did: string;
  attempts: number;
  expiresAt: number;
}

export interface Storage {
  getIdentity(platform: Platform, platformUserId: string): Promise<IdentityRow | null>;
  getIdentityById(id: string): Promise<IdentityRow | null>;
  getIdentitiesByDid(did: string): Promise<IdentityRow[]>;
  /** Look up the Circles identity whose handle local-part matches `nick`
   *  (i.e. handle = `nick.<domain>`). Used to resolve a chat nick → Safe. */
  getCirclesIdentityByNick(nick: string): Promise<IdentityRow | null>;
  insertIdentity(row: IdentityRow): Promise<void>;
  updateRefreshJwt(id: string, refreshJwtEnc: string): Promise<void>;
  updateRefreshJwtForDid(did: string, refreshJwtEnc: string): Promise<void>;
  setBackupEmailSet(did: string): Promise<void>;
  touchLastSeen(id: string, now: number): Promise<void>;

  putNonce(nonce: string, platform: Platform, address: string | null, now: number): Promise<void>;
  /** Atomically consume a nonce; returns its row if it existed and was fresh. */
  consumeNonce(
    nonce: string,
    maxAgeMs: number,
    now: number,
  ): Promise<{ platform: Platform; address: string | null } | null>;

  putEmailOtp(row: EmailOtpRow): Promise<void>;
  getEmailOtp(emailHash: string): Promise<EmailOtpRow | null>;
  bumpEmailOtpAttempts(emailHash: string): Promise<void>;
  deleteEmailOtp(emailHash: string): Promise<void>;

  insertCircle(row: CircleRow): Promise<void>;
  getCircle(slug: string): Promise<CircleRow | null>;
  listCircles(): Promise<CircleWithCount[]>;
  setCircleGroupAddress(id: string, groupAddress: string): Promise<void>;
  addCircleMember(circleId: string, identityId: string, now: number): Promise<void>;
  isCircleMember(circleId: string, identityId: string): Promise<boolean>;
  setMemberTrusted(circleId: string, identityId: string, now: number): Promise<void>;
  /** Members with a Safe (platform='circles') not yet trusted into the group. */
  listUntrustedSafeMembers(
    circleId: string,
  ): Promise<Array<{ identityId: string; safeAddress: string }>>;
  /** Circle slugs an identity has joined. */
  listJoinedCircleSlugs(identityId: string): Promise<string[]>;

  /** Fixed-window rate counter: returns the count after increment. */
  bumpRate(key: string, windowStart: number): Promise<number>;
}
