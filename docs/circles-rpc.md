# Circles RPC & data — reference

Reference for the Circles APIs chaichat depends on. Primary source of truth is
the official docs; everything below the "Official sources" section is **verified
against the live RPC** (`https://rpc.aboutcircles.com`) during chaichat
development and records the exact methods, table schemas, and query shapes we
actually use, since the official Swagger index does not spell all of them out.

> Last verified: 2026-06-13, against `https://rpc.aboutcircles.com`.

## Official sources

| Resource | URL |
|---|---|
| **Docs index** (all API families, Swagger links) | https://rpc.aboutcircles.com/docs |
| JSON-RPC endpoint (40+ methods: balances, avatars, profiles, trust, events, groups, invitations, paths) | `POST https://rpc.aboutcircles.com/` |
| Query Builder (interactive) | https://rpc.aboutcircles.com/docs (see `circlesV2_findPath` example) |
| Pathfinder API (transitive transfer paths: max-flow, quantized, simulated balances) | under `/docs` |
| Authentication Service (SIWE, passkeys, JWT issuance, JWKS) | under `/docs` |
| Referrals API (invitation links, referral distribution, at-scale onboarding) | under `/docs` |
| **Profile Pinning Service** (IPFS profile storage, full-text search, CID resolution) | `https://rpc.aboutcircles.com/profiles/...` |
| Marketplace API (catalogs, carts, checkout, orders) | under `/docs` |
| Score Groups API (reputation-scored permissionless groups) | under `/docs` |
| Analytics API (bot detection, trust-score computation) | under `/docs` |

Each family has interactive Swagger UI + machine-readable OpenAPI/JSON schemas
linked from the docs index. **If anything below conflicts with the official
docs, trust the docs** — this file lags the source.

Circles SDK / skill references used while building chaichat:
- Garage skill: https://garage.aboutcircles.com/SKILL.md
- Invitations & referrals: https://docs.aboutcircles.com/circles-sdk/invitations-and-referrals
- `@aboutcircles/sdk`, `@aboutcircles/miniapp-sdk` (npm)

---

## JSON-RPC methods chaichat uses

All are `POST https://rpc.aboutcircles.com/` with a JSON-RPC 2.0 envelope:
`{ "jsonrpc": "2.0", "id": 1, "method": "<method>", "params": [ ... ] }`.

### `circles_getAvatarInfo`
`params: ["0x<address>"]` → info about a registered avatar.

```jsonc
// result for a human
{ "version": 2, "type": "CrcV2_RegisterHuman", "avatar": "0x..",
  "tokenId": "0x..", "isHuman": true, "name": null, "symbol": null, ... }
// result for a group
{ "type": "CrcV2_RegisterGroup", "name": "Circles Backers", "symbol": "CBG", "isHuman": false, ... }
// result for an organization
{ "type": "CrcV2_RegisterOrganization", "name": null, "symbol": "" }
```

`type` is one of `CrcV2_RegisterHuman` | `CrcV2_RegisterGroup` |
`CrcV2_RegisterOrganization`. Returns an error / no result for an address that
isn't a registered Circles avatar (e.g. a plain Safe).

### `circles_query`
The generic table query. `params`:

```jsonc
[{
  "Namespace": "V_CrcV2",            // see "Namespaces & tables" below
  "Table": "TrustRelations",
  "Columns": ["truster", "trustee", "expiryTime"],   // [] = all columns
  "Filter": [ <predicate>, ... ],
  "Limit": 50,
  "SortOrder": "Desc"                // optional
}]
```

**Predicates.** A simple equality:
```jsonc
{ "Type": "FilterPredicate", "FilterType": "Equals", "Column": "truster", "Value": "0x..." }
```
Combine with a conjunction (AND/OR):
```jsonc
{ "Type": "Conjunction", "ConjunctionType": "And", "Predicates": [ <p1>, <p2> ] }
```
Result shape: `{ "result": { "columns": [...], "rows": [[...], ...] } }`. Zip
`columns` with each row. **All address values must be lowercased.**

### `circles_tables`
`params: []` → every queryable namespace + table + column schema. Use this to
discover schemas instead of guessing column names.

### Other (documented, not yet used by chaichat)
`circlesV2_findPath` (pathfinder), balance methods, invitation methods. See the
Swagger pages.

---

## Profile Pinning Service (REST)

Base: `https://rpc.aboutcircles.com/profiles`

### `GET /search?address=0x<addr>`
→ array of profile records for that address.
```jsonc
[{
  "name": "Circles Backers",
  "description": "The group for people who have become a Circles backer.",
  "address": "0x1aca...f026",
  "CID": "Qm...",
  "registeredName": null,            // on-chain short name (ENS-like); usually null
  "avatarType": "group",             // "human" | "group" | "org"
  "groupType": "closed",             // groups only
  "membershipFee": 0,
  "additionalCriteria": ["Complete the backing flow"],
  "externalWebsite": "https://...", "contactEmail": "...", ...
}]
```
Also supports `GET /search?name=<text>` (full-text).

### `GET /get?cid=<CID>`
→ the full profile blob for a CID. The avatar image is in **`previewImageUrl`**
(and sometimes `imageUrl`) as a **base64 `data:` URI** — no external host, so
it's CSP/webview-safe. chaichat only relays values starting with `data:`.

> chaichat code: `server/src/circlesProfiles.ts` (`fetchCirclesProfile`) does
> `search?address=` → `get?cid=` and returns `{ name, avatar, description,
> registeredName }`.

---

## Namespaces & tables (the ones that matter for chaichat)

Discover the full list with `circles_tables`. Highlights:

| Namespace | Table | Key columns | Used for |
|---|---|---|---|
| `V_CrcV2` | `TrustRelations` | `truster`, `trustee`, `expiryTime` | trust edges (mutual-trust + group/org membership gates) |
| `V_CrcV2` | `GroupMemberships` | `group`, `member`, `expiryTime`, `memberType` | **authoritative** group membership roster |
| `V_CrcV2` | `Groups`, `Avatars` | — | group/avatar listings |
| `CrcV2` | `RegisterGroup` | `group`, `mint`, `treasury`, `name`, `symbol` | group registration events (**no owner column**) |
| `CrcV2` | `RegisterOrganization` | `organization`, ... | org registration |
| `CrcV2` | `RegisterHuman` | `avatar`, `inviter` | human registration |
| `CrcV2` | `BaseGroupCreated` | `group`, **`owner`**, `mintHandler`, `treasury` | who created/owns a Base Group |
| `CrcV2` | `BaseGroupOwnerUpdated` | `emitter` (group), `owner` | group ownership transfers |
| `V_Safe` | `Owners` | `safeAddress`, `owner` | Safe signer/ownership graph |
| `Safe` | `ProxyCreation`, `SafeSetup`, `AddedOwner`, `RemovedOwner` | — | raw Safe events |

Other namespaces seen via `circles_tables`: `CrcV1`, `CrcV2_InvitationEscrow`,
`CrcV2_InvitationsAtScale`, `CrcV2_PaymentGateway`, `CrcV2_ScoreGroup`,
`CrcV2_TokenOffers`, `CrcV2_OIC`, `V_CrcV1`, `V_Crc`, `V_TrustScores`.

---

## Verified query recipes

These are the exact patterns chaichat relies on; all confirmed against the live
graph.

### Trust in one direction — "does A trust B (unexpired)?"
`V_CrcV2.TrustRelations`, Conjunction(truster=A, trustee=B), then check at least
one row has `expiryTime > now` (seconds). Group→member trust uses
`expiryTime = 79228162514264337593543950335` (max uint, never expires).

> code: `server/src/trust.ts` — `trusts()`, `isMutualTrust()`, `isGroupMember()`.

### Group membership — "is X a member of group G?"
Preferred: `V_CrcV2.GroupMemberships`, filter `group = G`, check `member = X`
(and `expiryTime > now`). Fallback used today: `trusts(G, X)` (group trusts
member). chaichat's `circles-group` join gate uses this.

### Group avatar / icon
`circles_getAvatarInfo(G)` for type+name+symbol; profile `search?address=G` →
`get?cid=` for the `previewImageUrl` data-URI used as the chat icon.

### Avatars a Safe owns/controls (groups + orgs)
Used for the "create a groupchat for a group you own" feature:
1. `CrcV2.BaseGroupCreated` filter `owner = safe` → Base Groups created by it.
2. `CrcV2.BaseGroupOwnerUpdated` filter `owner = safe` → groups transferred to it
   (note: the group address is in the `emitter` column here).
3. `V_Safe.Owners` filter `owner = safe` → sub-Safes the user controls; run
   `getAvatarInfo` on each and keep `RegisterGroup` / `RegisterOrganization`.

> Note: `RegisterGroup` has **no owner column** — ownership comes from
> `BaseGroupCreated` / `BaseGroupOwnerUpdated`, not the registration event.

---

## Gotchas

- **Lowercase all addresses** in filters and comparisons; the API stores/returns
  lowercase.
- **`RegisterGroup` ≠ ownership.** Use the `BaseGroup*` tables for owner.
- **Organizations have no membership roster** — only a trust list. A "members of
  this org" gate can only mean "the org trusts you" (directional, weaker than
  group `GroupMemberships`).
- **`/docs` is a SPA.** Plain `fetch`/curl of the index returns the app shell,
  not method detail — open the Swagger sub-pages in a browser, or use
  `circles_tables` for live schemas.
- Avatar images are large base64 data-URIs (tens of KB); cache server-side
  (chaichat: 10-min positive / 20-sec negative cache in `server/src/app.ts`).
