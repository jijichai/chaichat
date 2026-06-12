import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { D1Storage } from './storage/d1';
import type { Storage } from './storage/types';
import { randomToken } from './crypto';
import { mintSessionJwt, verifySessionJwt, type SessionClaims } from './session';
import { allowRate, clientIp } from './ratelimit';
import { verifyCirclesProof } from './platform/circles';
import { ProofError, buildLoginMessage, type ProofBody } from './platform/types';
import {
  findOrCreateIdentity,
  mintAccessToken,
  UnrecoverableSessionError,
} from './identity';
import {
  EpdsError,
  createAccount as createEpdsAccount,
  isHandleTakenError,
  makeFakeJwt,
  otpSendLogin,
  otpVerifyLogin,
} from './epds';
import { startBackup, confirmBackup, normalizeEmail, BackupError } from './backup';
import { aesEncrypt, jwtExpiresAtMs, sha256Hex } from './crypto';
import { slugify, isValidHandlePart } from './handles';
import { handleIrcProxy } from './wsproxy';
import { fetchCirclesProfile } from './circlesProfiles';
import { isMutualTrust, isGroupMember } from './trust';
import type { CircleRow, IdentityRow } from './storage/types';

/**
 * Built-in groupchats seeded on first use and pinned to the top of the list.
 * "Circles Backers" is gated by membership of its on-chain Circles group: only
 * Safes the group (gateGroupAddress) trusts may join.
 */
const SEED_CIRCLES: ReadonlyArray<{
  slug: string;
  name: string;
  description: string;
  gateGroupAddress: string;
}> = [
  {
    slug: 'circles-backers',
    name: 'Circles Backers',
    description: 'Private groupchat for Circles backers — members of the Circles Backers group.',
    gateGroupAddress: '0x1aca75e38263c79d9d4f10df0635cc6fcfe6f026',
  },
];

const PINNED_SLUGS = new Set(SEED_CIRCLES.map((s) => s.slug));

// Per-instance Circles-profile cache (name + avatar rarely change).
const PROFILE_TTL_MS = 10 * 60 * 1000;
const profileCache = new Map<
  string,
  { value: { displayName: string | null; avatar: string | null }; expires: number }
>();

type Vars = {
  store: Storage;
  session?: SessionClaims;
};

type App = Hono<{ Bindings: Env; Variables: Vars }>;

function log(level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>) {
  console.log(JSON.stringify({ level, message, ...extra }));
}

/**
 * Circle creation is opt-in: it needs a funded operator EOA to register the
 * on-chain Base Group. Off by default so a core-loop deploy (chat + backup)
 * can ship without xDAI. Set CIRCLES_ENABLED="1" once the operator is funded.
 */
function circlesEnabled(env: Env): boolean {
  // Read defensively: the var is unset by default (not in wrangler.jsonc), so
  // it isn't in the generated Env type. Enabled only when explicitly "1".
  return (env as { CIRCLES_ENABLED?: string }).CIRCLES_ENABLED === '1';
}

/**
 * Idempotently create the built-in pinned circles (e.g. Circles Backers).
 * Runs lazily on the circles-list endpoint: the per-circle ePDS account create
 * happens only once (when the row is missing); afterwards it's a cheap slug
 * lookup. Best-effort — a transient failure just leaves it to the next call.
 */
async function ensureSeedCircles(store: Storage, env: Env): Promise<void> {
  for (const seed of SEED_CIRCLES) {
    try {
      if (await store.getCircle(seed.slug)) continue;

      // Community DID for the built-in groupchat (its portable identity).
      let communityDid: string;
      try {
        const created = await createEpdsAccount(
          { baseUrl: env.EPDS_BASE_URL, apiKey: env.EPDS_API_KEY, devFake: env.DEV_FAKE_EPDS },
          seed.slug,
          `circle-${seed.slug}@noreply.${env.APP_DOMAIN}`,
        );
        communityDid = created.did;
      } catch (err) {
        if (isHandleTakenError(err)) {
          // The DID handle is taken (seeded before, row since deleted, or name
          // clash) — fall back to a deterministic placeholder so the pinned row
          // can still exist. The channel works regardless of this value.
          communityDid = `did:web:${seed.slug}.${env.APP_DOMAIN}`;
        } else {
          log('warn', 'seed circle DID create failed', { slug: seed.slug });
          continue;
        }
      }

      const row: CircleRow = {
        id: crypto.randomUUID(),
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        channel: `#${seed.slug}`,
        communityDid,
        groupAddress: null,
        ownerAddress: null,
        creatorIdentityId: 'system',
        mode: 'circles-group',
        gateGroupAddress: seed.gateGroupAddress,
        createdAt: Date.now(),
      };
      try {
        await store.insertCircle(row);
        log('info', 'seeded pinned circle', { slug: seed.slug });
      } catch {
        // UNIQUE(slug) race with a concurrent request — already seeded.
      }
    } catch (err) {
      log('warn', 'ensureSeedCircles error', { slug: seed.slug, err: String(err) });
    }
  }
}

async function requireSession(c: Context<{ Bindings: Env; Variables: Vars }>, next: Next) {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  const claims = await verifySessionJwt(c.env.SESSION_SECRET, token);
  if (!claims) return c.json({ error: 'Unauthorized' }, 401);
  c.set('session', claims);
  await next();
}

export function buildApp(env: Env) {
  const app: App = new Hono();

  app.use('*', async (c, next) => {
    c.set('store', new D1Storage(c.env.DB));
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true, service: 'chaichat' }));

  // Same-origin WebSocket proxy to the freeq IRC server (webview-safe).
  app.get('/irc', (c) => handleIrcProxy(c.req.raw));

  // ——— auth ———

  app.post('/api/auth/nonce', async (c) => {
    const store = c.get('store');
    if (!(await allowRate(store, 'nonce', clientIp(c.req.raw), 30))) {
      return c.json({ error: 'RateLimitExceeded' }, 429);
    }
    const body = (await c.req.json().catch(() => null)) as {
      platform?: string;
      address?: string;
    } | null;
    if (body?.platform !== 'circles' || typeof body.address !== 'string') {
      return c.json({ error: 'InvalidRequest' }, 400);
    }
    const nonce = randomToken(24);
    await store.putNonce(nonce, 'circles', body.address.toLowerCase(), Date.now());
    const message = buildLoginMessage(c.env.APP_DOMAIN, body.address, nonce);
    return c.json({ nonce, message });
  });

  app.post('/api/auth/verify', async (c) => {
    const store = c.get('store');
    if (!(await allowRate(store, 'verify', clientIp(c.req.raw), 20))) {
      return c.json({ error: 'RateLimitExceeded' }, 429);
    }
    const body = (await c.req.json().catch(() => null)) as ProofBody | null;
    if (!body || body.platform !== 'circles') {
      return c.json({ error: 'UnsupportedPlatform' }, 400);
    }

    try {
      const verified = await verifyCirclesProof(c.env, store, body);
      const { identity, tokens, isNew } = await findOrCreateIdentity(c.env, store, verified);
      const sessionJwt = await mintSessionJwt(c.env.SESSION_SECRET, {
        did: identity.did,
        identityId: identity.id,
        platform: identity.platform,
      });
      log('info', isNew ? 'identity created' : 'identity verified', {
        platform: identity.platform,
        did: identity.did,
        isNew,
      });
      return c.json(
        {
          did: identity.did,
          handle: identity.handle,
          nick: identity.handle.split('.')[0],
          accessJwt: tokens.accessJwt,
          accessExpiresAt: tokens.accessExpiresAt,
          sessionJwt,
          isNew,
          backupEmailSet: identity.backupEmailSet,
          platform: identity.platform,
        },
        isNew ? 201 : 200,
      );
    } catch (err) {
      if (err instanceof ProofError) {
        return c.json({ error: err.code, message: err.message }, 401);
      }
      if (err instanceof UnrecoverableSessionError) {
        return c.json(
          { error: 'SessionUnrecoverable', backupEmailSet: err.backupEmailSet },
          409,
        );
      }
      if (err instanceof EpdsError) {
        log('error', 'epds error on verify', { code: err.code, status: err.status });
        return c.json({ error: 'AccountServiceUnavailable' }, 502);
      }
      throw err;
    }
  });

  app.post('/api/session/tokens', requireSession, async (c) => {
    const store = c.get('store');
    const claims = c.get('session')!;
    if (!(await allowRate(store, 'tokens', claims.iid, 60))) {
      return c.json({ error: 'RateLimitExceeded' }, 429);
    }
    const identity = await store.getIdentityById(claims.iid);
    if (!identity) return c.json({ error: 'Unauthorized' }, 401);
    try {
      const tokens = await mintAccessToken(c.env, store, identity);
      await store.touchLastSeen(identity.id, Date.now());
      return c.json({
        did: identity.did,
        handle: identity.handle,
        nick: identity.handle.split('.')[0],
        accessJwt: tokens.accessJwt,
        accessExpiresAt: tokens.accessExpiresAt,
        backupEmailSet: identity.backupEmailSet,
      });
    } catch (err) {
      if (err instanceof UnrecoverableSessionError) {
        return c.json(
          { error: 'SessionUnrecoverable', backupEmailSet: err.backupEmailSet },
          409,
        );
      }
      throw err;
    }
  });

  // ——— backup (bind email to the current DID) ———

  app.post('/api/backup/start', requireSession, async (c) => {
    const store = c.get('store');
    const claims = c.get('session')!;
    if (!(await allowRate(store, 'backup', claims.iid, 5))) {
      return c.json({ error: 'RateLimitExceeded' }, 429);
    }
    const body = (await c.req.json().catch(() => null)) as { email?: string } | null;
    if (typeof body?.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email.trim())) {
      return c.json({ error: 'InvalidRequest' }, 400);
    }
    const identity = await store.getIdentityById(claims.iid);
    if (!identity) return c.json({ error: 'Unauthorized' }, 401);
    await startBackup(c.env, store, identity.did, body.email);
    return c.json({ ok: true });
  });

  app.post('/api/backup/confirm', requireSession, async (c) => {
    const store = c.get('store');
    const claims = c.get('session')!;
    const body = (await c.req.json().catch(() => null)) as {
      email?: string;
      otp?: string;
    } | null;
    if (typeof body?.email !== 'string' || typeof body.otp !== 'string') {
      return c.json({ error: 'InvalidRequest' }, 400);
    }
    const identity = await store.getIdentityById(claims.iid);
    if (!identity) return c.json({ error: 'Unauthorized' }, 401);
    try {
      await confirmBackup(c.env, store, identity, body.email, body.otp);
      log('info', 'backup email bound', { did: identity.did });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof BackupError) {
        const status = err.code === 'EmailInUse' ? 409 : err.code === 'BindFailed' ? 502 : 400;
        return c.json({ error: err.code }, status);
      }
      if (err instanceof UnrecoverableSessionError) {
        return c.json({ error: 'SessionUnrecoverable', backupEmailSet: false }, 409);
      }
      throw err;
    }
  });

  // ——— restore (email OTP login via ePDS) ———

  app.post('/api/restore/start', async (c) => {
    const store = c.get('store');
    const ip = clientIp(c.req.raw);
    const body = (await c.req.json().catch(() => null)) as { email?: string } | null;
    if (typeof body?.email !== 'string') return c.json({ error: 'InvalidRequest' }, 400);
    const email = normalizeEmail(body.email);
    const okIp = await allowRate(store, 'restore-ip', ip, 5);
    const okEmail = await allowRate(store, 'restore-email', await sha256Hex(email), 3);
    if (!okIp || !okEmail) return c.json({ error: 'RateLimitExceeded' }, 429);
    try {
      await otpSendLogin(
        { baseUrl: c.env.EPDS_BASE_URL, apiKey: c.env.EPDS_API_KEY, devFake: c.env.DEV_FAKE_EPDS },
        email,
      );
    } catch (err) {
      // Anti-enumeration: never reveal whether the email exists or the
      // upstream call failed — log it and answer ok.
      log('warn', 'restore otp send failed', {
        code: err instanceof EpdsError ? err.code : 'unknown',
      });
    }
    return c.json({ ok: true });
  });

  app.post('/api/restore/confirm', async (c) => {
    const store = c.get('store');
    if (!(await allowRate(store, 'restore-confirm', clientIp(c.req.raw), 10))) {
      return c.json({ error: 'RateLimitExceeded' }, 429);
    }
    const body = (await c.req.json().catch(() => null)) as {
      email?: string;
      otp?: string;
    } | null;
    if (typeof body?.email !== 'string' || typeof body.otp !== 'string') {
      return c.json({ error: 'InvalidRequest' }, 400);
    }
    const email = normalizeEmail(body.email);

    let tokens;
    if (c.env.DEV_FAKE_EPDS === '1') {
      // Dev loop: code 000000 restores whatever DID was dev-bound to this email.
      const devRow = await store.getIdentity('email', await sha256Hex(email));
      if (body.otp.trim() !== '000000' || !devRow) {
        return c.json({ error: 'InvalidCode' }, 400);
      }
      tokens = {
        did: devRow.did,
        handle: devRow.handle,
        accessJwt: makeFakeJwt(devRow.did, 90 * 60, 'access'),
        refreshJwt: makeFakeJwt(devRow.did, 90 * 24 * 60 * 60, 'refresh'),
      };
    } else {
      try {
        tokens = await otpVerifyLogin(
          { baseUrl: c.env.EPDS_BASE_URL, apiKey: c.env.EPDS_API_KEY },
          email,
          body.otp,
        );
      } catch (err) {
        // Wrong code and unknown email collapse into the same answer.
        log('info', 'restore verify failed', {
          code: err instanceof EpdsError ? err.code : 'unknown',
        });
        return c.json({ error: 'InvalidCode' }, 400);
      }
    }

    const puid = await sha256Hex(email);
    const now = Date.now();
    let identity = await store.getIdentity('email', puid);
    if (!identity) {
      const row: IdentityRow = {
        id: crypto.randomUUID(),
        platform: 'email',
        platformUserId: puid,
        did: tokens.did,
        handle: tokens.handle,
        displayName: null,
        avatarUrl: null,
        refreshJwtEnc: await aesEncrypt(tokens.refreshJwt, c.env.TOKEN_ENC_KEY),
        backupEmailSet: true,
        createdAt: now,
        lastSeenAt: now,
      };
      await store.insertIdentity(row);
      identity = (await store.getIdentity('email', puid)) ?? row;
    }

    // ePDS login revoked every other refresh token for this DID (admin
    // password-reset side effect) — re-custody the fresh one on ALL rows.
    const enc = await aesEncrypt(tokens.refreshJwt, c.env.TOKEN_ENC_KEY);
    await store.updateRefreshJwtForDid(tokens.did, enc);
    await store.setBackupEmailSet(tokens.did);
    await store.touchLastSeen(identity.id, now);

    const sessionJwt = await mintSessionJwt(c.env.SESSION_SECRET, {
      did: identity.did,
      identityId: identity.id,
      platform: identity.platform,
    });
    log('info', 'identity restored via email', { did: tokens.did });
    return c.json({
      did: tokens.did,
      handle: tokens.handle,
      nick: tokens.handle.split('.')[0],
      accessJwt: tokens.accessJwt,
      accessExpiresAt: jwtExpiresAtMs(tokens.accessJwt),
      sessionJwt,
      isNew: false,
      backupEmailSet: true,
      platform: 'email',
    });
  });

  app.get('/api/me', requireSession, async (c) => {
    const store = c.get('store');
    const claims = c.get('session')!;
    const identity = await store.getIdentityById(claims.iid);
    if (!identity) return c.json({ error: 'Unauthorized' }, 401);

    // For Circles accounts, surface the Safe address + the live Circles profile
    // (bio, on-chain registered name) so the You tab can show native details.
    const safeAddress = identity.platform === 'circles' ? identity.platformUserId : null;
    let circlesProfile: {
      name: string | null;
      description: string | null;
      registeredName: string | null;
    } | null = null;
    if (safeAddress && c.env.DEV_FAKE_EPDS !== '1') {
      const p = await fetchCirclesProfile(safeAddress);
      if (p) circlesProfile = { name: p.name, description: p.description, registeredName: p.registeredName };
    }

    return c.json({
      did: identity.did,
      handle: identity.handle,
      platform: identity.platform,
      displayName: identity.displayName,
      backupEmailSet: identity.backupEmailSet,
      circlesEnabled: circlesEnabled(c.env),
      safeAddress,
      circlesProfile,
    });
  });

  // ——— Circles profile resolution (nick → Safe → username + avatar) ———

  app.get('/api/profiles', async (c) => {
    const store = c.get('store');
    const raw = c.req.query('nicks') ?? '';
    const nicks = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 50);
    const out: Record<string, { displayName: string | null; avatar: string | null }> = {};

    await Promise.all(
      nicks.map(async (nick) => {
        const cached = profileCache.get(nick);
        if (cached && cached.expires > Date.now()) {
          out[nick] = cached.value;
          return;
        }
        // nick → Circles identity → Safe address → Circles profile.
        const identity = await store.getCirclesIdentityByNick(nick);
        let value: { displayName: string | null; avatar: string | null } = {
          displayName: null,
          avatar: null,
        };
        if (identity) {
          const profile = await fetchCirclesProfile(identity.platformUserId);
          if (profile) value = { displayName: profile.name, avatar: profile.avatar };
        }
        profileCache.set(nick, { value, expires: Date.now() + PROFILE_TTL_MS });
        out[nick] = value;
      }),
    );

    return c.json({ profiles: out });
  });

  // ——— circles (community DID + IRC channel + on-chain Base Group) ———

  app.get('/api/circles', async (c) => {
    const store = c.get('store');
    await ensureSeedCircles(store, c.env);
    const circles = await store.listCircles();
    let joined = new Set<string>();
    const auth = c.req.header('authorization') ?? '';
    if (auth.startsWith('Bearer ')) {
      const claims = await verifySessionJwt(c.env.SESSION_SECRET, auth.slice(7).trim());
      if (claims) joined = new Set(await store.listJoinedCircleSlugs(claims.iid));
    }
    // Pinned (built-in) circles always sort to the top.
    const sorted = [...circles].sort((a, b) => {
      const pa = PINNED_SLUGS.has(a.slug) ? 0 : 1;
      const pb = PINNED_SLUGS.has(b.slug) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return b.createdAt - a.createdAt;
    });
    return c.json({
      // Groupchat creation is always available now (lightweight: DID + channel
      // + access mode, no on-chain group). The on-chain Base Group is the only
      // thing gated by circlesEnabled.
      createEnabled: true,
      onChainEnabled: circlesEnabled(c.env),
      circles: sorted.map((x) => ({
        slug: x.slug,
        name: x.name,
        description: x.description,
        channel: x.channel,
        communityDid: x.communityDid,
        groupAddress: x.groupAddress,
        mode: x.mode,
        gateGroupAddress: x.gateGroupAddress,
        pinned: PINNED_SLUGS.has(x.slug),
        memberCount: x.memberCount,
        joined: joined.has(x.slug),
      })),
    });
  });

  app.post('/api/circles', requireSession, async (c) => {
    const store = c.get('store');
    const claims = c.get('session')!;
    if (!(await allowRate(store, 'circle-create', claims.iid, 3, 24 * 60 * 60 * 1000))) {
      return c.json({ error: 'RateLimitExceeded' }, 429);
    }
    const body = (await c.req.json().catch(() => null)) as {
      name?: string;
      description?: string;
      mode?: string;
    } | null;
    const name = body?.name?.trim();
    if (!name || name.length < 3 || name.length > 32) {
      return c.json({ error: 'InvalidRequest', message: 'name must be 3-32 chars' }, 400);
    }
    const mode: 'open' | 'mutual-trust' = body?.mode === 'mutual-trust' ? 'mutual-trust' : 'open';
    const description = body?.description?.trim().slice(0, 280) || null;

    const identity = await store.getIdentityById(claims.iid);
    if (!identity) return c.json({ error: 'Unauthorized' }, 401);

    // Mutual-trust groupchats only make sense for a creator who HAS a Circles
    // Safe (the thing others trust). Guests/email users can only make open ones.
    if (mode === 'mutual-trust' && identity.platform !== 'circles') {
      return c.json(
        { error: 'CirclesAccountRequired', message: 'connect a Circles account to make a mutual-trust groupchat' },
        400,
      );
    }

    let slug = slugify(name);
    if (slug.length < 5) slug = `${slug}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4) || 'chai'}`.slice(0, 20);
    if (!isValidHandlePart(slug)) {
      return c.json({ error: 'InvalidRequest', message: 'name produces an invalid slug' }, 400);
    }
    if (await store.getCircle(slug)) return c.json({ error: 'CircleExists' }, 409);

    // ① Community DID for the groupchat (its portable identity).
    let communityDid: string;
    try {
      const created = await createEpdsAccount(
        { baseUrl: c.env.EPDS_BASE_URL, apiKey: c.env.EPDS_API_KEY, devFake: c.env.DEV_FAKE_EPDS },
        slug,
        `circle-${slug}@noreply.${c.env.APP_DOMAIN}`,
      );
      communityDid = created.did;
    } catch (err) {
      if (isHandleTakenError(err)) return c.json({ error: 'CircleExists' }, 409);
      log('error', 'community DID creation failed', {
        code: err instanceof EpdsError ? err.code : 'unknown',
      });
      return c.json({ error: 'AccountServiceUnavailable' }, 502);
    }

    // ② Record the groupchat. The creator's Safe is the trust anchor for a
    // mutual-trust groupchat (others must mutually trust them to join).
    const owner = identity.platform === 'circles' ? identity.platformUserId : null;
    const now = Date.now();
    const row = {
      id: crypto.randomUUID(),
      slug,
      name,
      description,
      channel: `#${slug}`,
      communityDid,
      groupAddress: null,
      ownerAddress: owner,
      creatorIdentityId: identity.id,
      mode,
      gateGroupAddress: null,
      createdAt: now,
    };
    await store.insertCircle(row);
    await store.addCircleMember(row.id, identity.id, now);

    // ③ Optional on-chain Circles Base Group — only when enabled (needs a
    // funded operator EOA). The groupchat works without it.
    if (circlesEnabled(c.env) && owner) {
      const symbol = slug.replace(/[^a-z0-9]/g, '').toUpperCase().slice(0, 8) || 'CHAI';
      const queue = c.env.TXQUEUE.getByName('operator');
      await queue.enqueueRegisterGroup({
        circleId: row.id,
        owner,
        name: name.slice(0, 19),
        symbol,
        description,
      });
    }

    log('info', 'groupchat created', { slug, communityDid, mode });
    return c.json(
      {
        slug,
        name,
        description,
        channel: row.channel,
        communityDid,
        groupAddress: null,
        mode,
        memberCount: 1,
        joined: true,
      },
      201,
    );
  });

  app.post('/api/circles/:slug/join', requireSession, async (c) => {
    const store = c.get('store');
    const claims = c.get('session')!;
    const slugParam = c.req.param('slug');
    if (!slugParam) return c.json({ error: 'NotFound' }, 404);
    const circle = await store.getCircle(slugParam);
    if (!circle) return c.json({ error: 'NotFound' }, 404);
    const identity = await store.getIdentityById(claims.iid);
    if (!identity) return c.json({ error: 'Unauthorized' }, 401);

    // ——— Mutual-trust access control ———
    if (circle.mode === 'mutual-trust') {
      // Joiner must have a Circles Safe.
      if (identity.platform !== 'circles') {
        return c.json(
          { error: 'TrustRequired', message: 'connect a Circles account to join this groupchat' },
          403,
        );
      }
      const creator = await store.getIdentityById(circle.creatorIdentityId);
      const creatorSafe = circle.ownerAddress ?? creator?.platformUserId ?? null;
      if (!creatorSafe) {
        return c.json({ error: 'TrustRequired', message: 'groupchat has no trust anchor' }, 403);
      }
      // Self-join (creator) always allowed; otherwise require mutual trust.
      if (creatorSafe.toLowerCase() !== identity.platformUserId.toLowerCase()) {
        let mutual = false;
        try {
          // Dev loop: fake Safe addresses aren't on the real graph. Treat
          // addresses ending in matching last hex char as "mutual" so the
          // gate can be exercised locally; otherwise block.
          mutual =
            c.env.DEV_FAKE_EPDS === '1'
              ? creatorSafe.slice(-1) === identity.platformUserId.slice(-1)
              : await isMutualTrust(creatorSafe, identity.platformUserId);
        } catch (err) {
          log('warn', 'trust check failed', { err: String(err) });
          return c.json({ error: 'TrustCheckUnavailable' }, 503);
        }
        if (!mutual) {
          return c.json(
            {
              error: 'TrustRequired',
              message: 'you and the creator must trust each other on Circles to join',
              creatorSafe,
            },
            403,
          );
        }
      }
    }

    // ——— Circles-group membership access control ———
    // Only members of the gating Circles group (the group trusts their Safe)
    // may join. Used by built-in pinned circles like "Circles Backers".
    if (circle.mode === 'circles-group') {
      const group = circle.gateGroupAddress;
      if (!group) {
        return c.json({ error: 'GroupMembershipRequired', message: 'groupchat has no group anchor' }, 403);
      }
      if (identity.platform !== 'circles') {
        return c.json(
          {
            error: 'GroupMembershipRequired',
            message: 'connect a Circles account to join this groupchat',
            gateGroupAddress: group,
          },
          403,
        );
      }
      let member = false;
      try {
        member =
          c.env.DEV_FAKE_EPDS === '1'
            ? group.slice(-1) === identity.platformUserId.slice(-1)
            : await isGroupMember(group, identity.platformUserId);
      } catch (err) {
        log('warn', 'group membership check failed', { err: String(err) });
        return c.json({ error: 'TrustCheckUnavailable' }, 503);
      }
      if (!member) {
        return c.json(
          {
            error: 'GroupMembershipRequired',
            message: 'only members of this Circles group can join',
            gateGroupAddress: group,
          },
          403,
        );
      }
    }

    await store.addCircleMember(circle.id, identity.id, Date.now());

    // On-chain trust (if the group was registered) — queue trust.add for the
    // joiner's Safe so they become an on-chain group member too.
    let trusted = false;
    if (identity.platform === 'circles' && circle.groupAddress) {
      const queue = c.env.TXQUEUE.getByName('operator');
      await queue.enqueueTrust({
        circleId: circle.id,
        identityId: identity.id,
        groupAddress: circle.groupAddress,
        memberAddress: identity.platformUserId,
      });
      trusted = true;
    }
    return c.json({ ok: true, trusted });
  });

  app.notFound((c) => c.json({ error: 'NotFound' }, 404));

  app.onError((err, c) => {
    log('error', err.message, { path: c.req.path, stack: err.stack?.slice(0, 600) });
    return c.json({ error: 'Internal' }, 500);
  });

  // env is accepted for future construction-time wiring; routes read c.env.
  void env;
  return app;
}
