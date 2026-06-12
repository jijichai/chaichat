import type {
  CircleRow,
  CircleWithCount,
  EmailOtpRow,
  IdentityRow,
  Platform,
  Storage,
} from './types';

interface IdentityDbRow {
  id: string;
  platform: Platform;
  platform_user_id: string;
  did: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  refresh_jwt_enc: string | null;
  backup_email_set: number;
  created_at: number;
  last_seen_at: number;
}

interface CircleDbRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  channel: string;
  community_did: string;
  group_address: string | null;
  owner_address: string | null;
  creator_identity_id: string;
  mode: string;
  gate_group_address: string | null;
  created_at: number;
  member_count?: number;
}

function identityFromDb(r: IdentityDbRow): IdentityRow {
  return {
    id: r.id,
    platform: r.platform,
    platformUserId: r.platform_user_id,
    did: r.did,
    handle: r.handle,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    refreshJwtEnc: r.refresh_jwt_enc,
    backupEmailSet: r.backup_email_set === 1,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  };
}

function circleFromDb(r: CircleDbRow): CircleRow {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    channel: r.channel,
    communityDid: r.community_did,
    groupAddress: r.group_address,
    ownerAddress: r.owner_address,
    creatorIdentityId: r.creator_identity_id,
    mode:
      r.mode === 'mutual-trust'
        ? 'mutual-trust'
        : r.mode === 'circles-group'
          ? 'circles-group'
          : 'open',
    gateGroupAddress: r.gate_group_address,
    createdAt: r.created_at,
  };
}

export class D1Storage implements Storage {
  constructor(private db: D1Database) {}

  async getIdentity(platform: Platform, platformUserId: string): Promise<IdentityRow | null> {
    const r = await this.db
      .prepare('SELECT * FROM identities WHERE platform = ? AND platform_user_id = ?')
      .bind(platform, platformUserId)
      .first<IdentityDbRow>();
    return r ? identityFromDb(r) : null;
  }

  async getIdentityById(id: string): Promise<IdentityRow | null> {
    const r = await this.db
      .prepare('SELECT * FROM identities WHERE id = ?')
      .bind(id)
      .first<IdentityDbRow>();
    return r ? identityFromDb(r) : null;
  }

  async getIdentitiesByDid(did: string): Promise<IdentityRow[]> {
    const rs = await this.db
      .prepare('SELECT * FROM identities WHERE did = ?')
      .bind(did)
      .all<IdentityDbRow>();
    return rs.results.map(identityFromDb);
  }

  async getCirclesIdentityByNick(nick: string): Promise<IdentityRow | null> {
    // handle is `<nick>.<domain>`; match the local part exactly to avoid
    // prefix collisions (e.g. "ab" matching "abc.self.surf").
    const r = await this.db
      .prepare(
        "SELECT * FROM identities WHERE platform = 'circles' AND handle LIKE ? || '.%' LIMIT 1",
      )
      .bind(nick)
      .first<IdentityDbRow>();
    return r ? identityFromDb(r) : null;
  }

  async insertIdentity(row: IdentityRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO identities
         (id, platform, platform_user_id, did, handle, display_name, avatar_url,
          refresh_jwt_enc, backup_email_set, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (platform, platform_user_id) DO NOTHING`,
      )
      .bind(
        row.id,
        row.platform,
        row.platformUserId,
        row.did,
        row.handle,
        row.displayName,
        row.avatarUrl,
        row.refreshJwtEnc,
        row.backupEmailSet ? 1 : 0,
        row.createdAt,
        row.lastSeenAt,
      )
      .run();
  }

  async updateRefreshJwt(id: string, refreshJwtEnc: string): Promise<void> {
    await this.db
      .prepare('UPDATE identities SET refresh_jwt_enc = ? WHERE id = ?')
      .bind(refreshJwtEnc, id)
      .run();
  }

  async updateRefreshJwtForDid(did: string, refreshJwtEnc: string): Promise<void> {
    await this.db
      .prepare('UPDATE identities SET refresh_jwt_enc = ? WHERE did = ?')
      .bind(refreshJwtEnc, did)
      .run();
  }

  async setBackupEmailSet(did: string): Promise<void> {
    await this.db
      .prepare('UPDATE identities SET backup_email_set = 1 WHERE did = ?')
      .bind(did)
      .run();
  }

  async touchLastSeen(id: string, now: number): Promise<void> {
    await this.db
      .prepare('UPDATE identities SET last_seen_at = ? WHERE id = ?')
      .bind(now, id)
      .run();
  }

  async putNonce(
    nonce: string,
    platform: Platform,
    address: string | null,
    now: number,
  ): Promise<void> {
    await this.db
      .prepare('INSERT INTO nonces (nonce, platform, address, created_at) VALUES (?, ?, ?, ?)')
      .bind(nonce, platform, address, now)
      .run();
  }

  async consumeNonce(
    nonce: string,
    maxAgeMs: number,
    now: number,
  ): Promise<{ platform: Platform; address: string | null } | null> {
    // DELETE ... RETURNING makes consumption atomic — a nonce can never verify twice.
    const r = await this.db
      .prepare('DELETE FROM nonces WHERE nonce = ? AND created_at > ? RETURNING platform, address')
      .bind(nonce, now - maxAgeMs)
      .first<{ platform: Platform; address: string | null }>();
    return r ?? null;
  }

  async putEmailOtp(row: EmailOtpRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO email_otps (email_hash, code_hash, did, attempts, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (email_hash) DO UPDATE SET
           code_hash = excluded.code_hash, did = excluded.did,
           attempts = 0, expires_at = excluded.expires_at`,
      )
      .bind(row.emailHash, row.codeHash, row.did, row.attempts, row.expiresAt)
      .run();
  }

  async getEmailOtp(emailHash: string): Promise<EmailOtpRow | null> {
    const r = await this.db
      .prepare('SELECT * FROM email_otps WHERE email_hash = ?')
      .bind(emailHash)
      .first<{
        email_hash: string;
        code_hash: string;
        did: string;
        attempts: number;
        expires_at: number;
      }>();
    return r
      ? {
          emailHash: r.email_hash,
          codeHash: r.code_hash,
          did: r.did,
          attempts: r.attempts,
          expiresAt: r.expires_at,
        }
      : null;
  }

  async bumpEmailOtpAttempts(emailHash: string): Promise<void> {
    await this.db
      .prepare('UPDATE email_otps SET attempts = attempts + 1 WHERE email_hash = ?')
      .bind(emailHash)
      .run();
  }

  async deleteEmailOtp(emailHash: string): Promise<void> {
    await this.db.prepare('DELETE FROM email_otps WHERE email_hash = ?').bind(emailHash).run();
  }

  async insertCircle(row: CircleRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO circles
         (id, slug, name, description, channel, community_did, group_address,
          owner_address, creator_identity_id, mode, gate_group_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.id,
        row.slug,
        row.name,
        row.description,
        row.channel,
        row.communityDid,
        row.groupAddress,
        row.ownerAddress,
        row.creatorIdentityId,
        row.mode,
        row.gateGroupAddress,
        row.createdAt,
      )
      .run();
  }

  async getCircle(slug: string): Promise<CircleRow | null> {
    const r = await this.db
      .prepare('SELECT * FROM circles WHERE slug = ?')
      .bind(slug)
      .first<CircleDbRow>();
    return r ? circleFromDb(r) : null;
  }

  async listCircles(): Promise<CircleWithCount[]> {
    const rs = await this.db
      .prepare(
        `SELECT c.*, COUNT(m.identity_id) AS member_count
         FROM circles c LEFT JOIN circle_members m ON m.circle_id = c.id
         GROUP BY c.id ORDER BY c.created_at DESC LIMIT 200`,
      )
      .all<CircleDbRow>();
    return rs.results.map((r) => ({ ...circleFromDb(r), memberCount: r.member_count ?? 0 }));
  }

  async setCircleGroupAddress(id: string, groupAddress: string): Promise<void> {
    await this.db
      .prepare('UPDATE circles SET group_address = ? WHERE id = ?')
      .bind(groupAddress, id)
      .run();
  }

  async addCircleMember(circleId: string, identityId: string, now: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO circle_members (circle_id, identity_id, joined_at)
         VALUES (?, ?, ?) ON CONFLICT (circle_id, identity_id) DO NOTHING`,
      )
      .bind(circleId, identityId, now)
      .run();
  }

  async isCircleMember(circleId: string, identityId: string): Promise<boolean> {
    const r = await this.db
      .prepare('SELECT 1 AS x FROM circle_members WHERE circle_id = ? AND identity_id = ?')
      .bind(circleId, identityId)
      .first<{ x: number }>();
    return r !== null;
  }

  async setMemberTrusted(circleId: string, identityId: string, now: number): Promise<void> {
    await this.db
      .prepare('UPDATE circle_members SET trusted_at = ? WHERE circle_id = ? AND identity_id = ?')
      .bind(now, circleId, identityId)
      .run();
  }

  async listUntrustedSafeMembers(
    circleId: string,
  ): Promise<Array<{ identityId: string; safeAddress: string }>> {
    const rs = await this.db
      .prepare(
        `SELECT m.identity_id AS identity_id, i.platform_user_id AS safe_address
         FROM circle_members m JOIN identities i ON i.id = m.identity_id
         WHERE m.circle_id = ? AND m.trusted_at IS NULL AND i.platform = 'circles'`,
      )
      .bind(circleId)
      .all<{ identity_id: string; safe_address: string }>();
    return rs.results.map((r) => ({ identityId: r.identity_id, safeAddress: r.safe_address }));
  }

  async listJoinedCircleSlugs(identityId: string): Promise<string[]> {
    const rs = await this.db
      .prepare(
        `SELECT c.slug AS slug FROM circle_members m
         JOIN circles c ON c.id = m.circle_id WHERE m.identity_id = ?`,
      )
      .bind(identityId)
      .all<{ slug: string }>();
    return rs.results.map((r) => r.slug);
  }

  async bumpRate(key: string, windowStart: number): Promise<number> {
    const r = await this.db
      .prepare(
        `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN rate_limits.window_start = excluded.window_start
                        THEN rate_limits.count + 1 ELSE 1 END,
           window_start = excluded.window_start
         RETURNING count`,
      )
      .bind(key, windowStart)
      .first<{ count: number }>();
    return r?.count ?? 1;
  }
}
