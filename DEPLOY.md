# Deploying chaichat

Target: a single Cloudflare Worker at `https://chaichat.attps.cloud` (SPA assets + API + DO).

## 1. One-time infrastructure setup

### ePDS API key (on the self.surf box)

```bash
node scripts/create-api-client.mjs --name chaichat --can-create-directly --rate-limit 2000 \
  --db /path/to/prod/epds.sqlite
```

Save the printed key — it becomes the `EPDS_API_KEY` secret. (`can_create_directly` gates
`/_internal/account/create`; signup stays enabled for the restore flow.)

### Operator EOA (Gnosis)

Generate a fresh key, fund it with a few xDAI (group registration + trust calls cost
fractions of a cent). It becomes `OPERATOR_PRIVATE_KEY` and is the `service` address on
every chaichat Base Group.

### Cloudflare Email Service

```bash
npx wrangler email sending enable attps.cloud   # then add the DNS records it prints
```

The Worker sends backup OTPs from `chaichat@attps.cloud` (`EMAIL_FROM` var).

### D1 database

```bash
cd server
npx wrangler d1 create chaichat        # paste the returned id into wrangler.jsonc (database_id)
npx wrangler d1 migrations apply chaichat --remote
```

## 2. Secrets

```bash
cd server
npx wrangler secret put EPDS_API_KEY
npx wrangler secret put SESSION_SECRET        # openssl rand -base64 32
npx wrangler secret put TOKEN_ENC_KEY         # openssl rand -base64 32  (must decode to 32 bytes)
npx wrangler secret put OPERATOR_PRIVATE_KEY  # 0x…
```

Do NOT set `DEV_FAKE_AUTH` / `DEV_FAKE_EPDS` / `DEV_FAKE_CHAIN` in production.

## 3. Ship

```bash
pnpm build              # builds vendor SDK + web + typechecks server
cd server && npx wrangler deploy
```

Attach the custom domain `chaichat.attps.cloud` to the Worker (dashboard → Workers →
Settings → Domains & Routes; the attps.cloud zone is already on Cloudflare).

## 4. Post-deploy verification

1. `curl https://chaichat.attps.cloud/api/health` → `{ok:true}`
2. Open `https://circles.gnosis.io/playground`, point it at the URL → boot → Safe
   signature → you land in `#chaichat` with a fresh `*.self.surf` DID.
3. Verify the SASL path: `getSession` is called by freeq-server against self.surf —
   watch `journalctl -u freeq-server` for the auth.
4. You tab → Back up account data → real email → 6-digit code → incognito window →
   "I have an account" → same DID restored.
5. Create a throwaway circle → watch the TxQueue logs (`wrangler tail`) for
   `group registered` → the circle shows "on-chain ✓" and the group resolves in
   Metri/Circles RPC. Join from a second account → `member trusted`.
6. Real device pass inside the Gnosis/Circles app.

## 5. Adjacent infra (separate repos, optional but recommended)

- **freeq-server CORS** (`wumblr-freeq/freeq-server/src/web.rs` ~line 236): the
  hardcoded origin allowlist gates freeq's REST endpoints (pins, e2ee keys, uploads —
  unused by chaichat v1; the `/irc` WebSocket is NOT origin-gated). Before using those
  features, add `https://chaichat.attps.cloud` — ideally as an env-configurable list —
  and redeploy freeq-server.
- **ePDS hardening (post-MVP)**: a `login-by-did` internal endpoint would close the
  orphaned-DID edge (refresh token expired + no email bound); chaichat's
  custody-copy-on-restore covers the common cases until then.

## 6. Registrations

- **Circles garage**: create a builder profile at garage.aboutcircles.com/signup, then
  register the app (name, pitch, live URL, repo, readme) at
  garage.aboutcircles.com/register before the Sunday deadline.

## Known v1 limits

- A user who never backs up, then loses webview storage AND whose custodied refresh
  token was revoked/expired (~90 days idle) gets a fresh DID (nick auto-suffixes).
- Same human on multiple platforms (v2: Farcaster/World) = multiple DIDs until
  account-merge ships; `EmailInUse` on backup-confirm is the merge signal.
- Group profile pictures / Circles avatar fetch are not wired yet (initials avatars).
