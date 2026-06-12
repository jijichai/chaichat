# chaichat 🍵

Group chats with portable identity — a [Circles](https://aboutcircles.com) miniapp.

Open chaichat inside the Gnosis/Circles app and you get an anonymous AT Protocol DID on
[self.surf](https://self.surf) instantly (random username, no email, no signup) and land in
IRC group chats on [freeq](https://github.com/attpslabs/wumblr-freeq) at `irc.wumblr.com`.
Later, press **Back up account data** in settings, enter your email and a 6-digit code, and
your identity becomes recoverable on any device.

Create a **circle** and you get three things at once:

| Layer | What |
|---|---|
| Chat | an IRC channel (`#your-circle`) — you're the DID-bound founder |
| Identity | a community DID (`your-circle.self.surf`) |
| Economy | an on-chain [Circles Base Group](https://docs.aboutcircles.com) on Gnosis — members with a Safe get trusted automatically |

## How it works

```
Circles host (iframe)                 plain browser
  └─ Safe signMessage (ERC-1271)        └─ email + 6-digit OTP  |  guest (did:key)
        │                                     │
        ▼                                     ▼
  POST /api/auth/verify  ──────────►  Cloudflare Worker (Hono + D1)
        │                                  │ x-api-key
        │                                  ▼
        │                          ePDS /_internal/account/create  → did + tokens
        ▼
  browser ── SASL ATPROTO-CHALLENGE (pds-session) ──►  wss://irc.wumblr.com/irc
```

- The browser holds only short-lived access tokens; refresh tokens are custodied
  server-side (AES-GCM in D1) and rotated on demand.
- "Guests" are ephemeral `did:key` identities (the server requires SASL) — still
  zero-signup, persisted in localStorage.
- All operator-EOA transactions (group registration, member trust) run through a
  single `TxQueue` Durable Object: strict serialization, alarm-driven retries.

## Repo layout

- `web/` — Vite + React SPA (three tabs: Chats / Circles / You)
- `server/` — Cloudflare Worker: Hono API, D1, Email Service, TxQueue DO
- `vendor/freeq-sdk/` — vendored `@freeq/sdk` (not on npm); see `VENDORED.md`
- `tools/circles-host-sim.html` — local stand-in for the Circles host iframe

## Develop

```bash
pnpm install
pnpm --filter @freeq/sdk build
cp server/.dev.vars.example server/.dev.vars
(cd server && npx wrangler d1 migrations apply chaichat --local && npx wrangler dev --port 8787)
pnpm --filter web dev            # second terminal — Vite on :5173, /api proxied to :8787
open tools/circles-host-sim.html # simulates the Circles host (connect wallet → auto-sign)
```

`.dev.vars` defaults enable three dev fakes so the full loop runs with zero external
services: `DEV_FAKE_AUTH` (accept the simulator's `0xDEVSIG` signature),
`DEV_FAKE_EPDS` (local fake DIDs; backup OTP logged to console; restore code `000000`),
`DEV_FAKE_CHAIN` (fake group addresses). Unset any of them to hit the real service.

## Deploy

See [DEPLOY.md](DEPLOY.md).

## Encryption

Chat is plaintext today (TLS in transit only). See [docs/e2ee.md](docs/e2ee.md)
for the current E2EE status, why the `[e2ee] Init failed` console warning is
harmless, and the webview-safe path to enabling channel encryption later.
