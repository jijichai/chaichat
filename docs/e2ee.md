# End-to-end encryption — status

**Status as of 2026-06-12: E2EE is NOT used in chaichat. Messages are plaintext
on the wire (TLS-encrypted in transit via WSS, but not end-to-end).**

This document records exactly what's true today, why the `[e2ee] Init failed`
console warning appears, and how E2EE could be enabled later.

## What's true right now

- chaichat **never calls any encryption API**. No encrypted channels, no
  encrypted DMs. Group chat in `#chaichat` and circles is **plaintext**,
  protected only by TLS between the browser and the server.
- The `[e2ee] Init failed: InvalidAccessError ... exportKey` warning in the
  console is **harmless** and does not affect chat. It comes from the freeq
  SDK auto-initializing its DM key store on every login
  (`e2ee.initialize()`), which **chaichat does not opt out of and does not
  use**. The error is caught and ignored by the SDK.

### Why the warning fires (the webview Ed25519 problem)

`e2ee.initialize()` generates an **Ed25519** signing key for DM identity, then
calls `crypto.subtle.exportKey('pkcs8', …)` to persist it
(`vendor/freeq-sdk/src/e2ee.ts:190`). **The Circles iOS in-app webview's
WebCrypto does not support Ed25519 key export** → `InvalidAccessError`. Same
root cause as the `MSGSIG` issue we hit during connection bring-up (which is
why `autoMsgSig: false` is set in `web/src/chat/connection.ts`).

This is a **webview limitation, not a chaichat or freeq bug.** Ed25519 (and
X25519) WebCrypto works in Safari/Chrome proper but not reliably in the iOS
in-app webview.

## What the stack actually supports (for later)

The freeq SDK ships **two independent** E2EE mechanisms, and the freeq server
has the matching server-side support:

| Mechanism | Crypto | Webview-safe? | SDK API |
|---|---|---|---|
| **Channel encryption (ENC1)** | HKDF-SHA256 + **AES-256-GCM** from a shared passphrase | ✅ **Yes** — uses only HKDF + AES-GCM, both supported in the iOS webview | `client.setChannelEncryption(channel, passphrase)` / `removeChannelEncryption()` |
| **DM encryption (ENC3)** | X25519 + Ed25519 **Double Ratchet** (Signal) | ❌ **No** — needs Ed25519/X25519 WebCrypto the iOS webview lacks | auto via `initializeE2EE(did)` + prekey bundles |

Server side (already present in freeq, no changes needed to enable):
- `+E` channel mode (`encrypted_only`) — a channel can require all messages be
  encrypted (`freeq-server/src/connection/channel.rs`).
- Prekey bundle storage for DM key exchange (`prekey_bundles` table,
  `/api/v1/keys`).

**Key takeaway:** **channel** encryption (passphrase → AES-GCM) is the
webview-compatible path. The DM Double Ratchet is the part that's blocked in
the Circles iOS webview.

## How to enable channel encryption (near-term, webview-safe)

ENC1 channel encryption would work in the Circles webview today, because it
avoids Ed25519/X25519. Rough plan:

1. In `web/src/chat/connection.ts`, after a circle/channel is opened, call
   `client.setChannelEncryption(channel, passphrase)` with a passphrase shared
   among members (out-of-band, or derived from a circle secret distributed by
   the chaichat backend).
2. Send messages normally — the SDK auto-encrypts to `ENC1:` when a channel key
   is set, and auto-decrypts inbound `ENC1:` for members who have the key.
3. Optionally set the channel to `+E` (encrypted-only) so plaintext is rejected.
4. The hard part is **key distribution**: who gets the passphrase, and how it's
   delivered to trusted members only. For a Circles "mutual-trust circle", the
   backend could hand the channel passphrase only to members who pass the
   mutual-trust check — turning the existing app-level trust gate into a
   cryptographic one.

This is **not built**. It's the natural upgrade once the open/mutual-trust
circles ship.

## Trust-gated 24h stories (v2) — implications

The planned "instagram-stories on the trust graph" feature (see the main plan)
calls for **true E2EE images** gated by the Circles trust graph. Note:

- The plan's sketch assumed the SDK's X25519 key-wrapping. **That won't work in
  the Circles iOS webview** (Ed25519/X25519 unsupported).
- The webview-safe approach: do the image encryption with **AES-256-GCM** (a
  random content key per story), and wrap that content key for each recipient
  using **ECDH over P-256** (`crypto.subtle` *does* support P-256 in the
  webview) instead of X25519. Recipient public keys would be P-256 keys the
  chaichat backend mints/stores per identity, not the SDK's X25519 keys.
- Alternatively, accept that stories' E2EE only works in full browsers, not the
  in-app webview.

Decide the crypto curve (P-256 vs X25519) when building stories; it determines
webview compatibility.

## Summary

- **Today:** plaintext chat, TLS in transit. The `[e2ee] Init failed` warning is
  cosmetic noise from the SDK's unused DM init failing on webview Ed25519.
- **Webview-safe E2EE path:** channel passphrase encryption (ENC1, AES-GCM) —
  works, not yet wired up.
- **Blocked in webview:** DM Double Ratchet (X25519/Ed25519) and any feature
  built on those primitives, unless reworked to P-256/AES.
