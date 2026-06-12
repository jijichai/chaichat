import { FreeqClient, generateDidKey, importDidKey } from '@freeq/sdk';
import type { Message, Member, SaslCredentials, TransportState } from '@freeq/sdk';

/**
 * IRC WebSocket URL. Defaults to a SAME-ORIGIN path proxied by the chaichat
 * Worker (`/irc` → wss://irc.wumblr.com/irc upstream). Same-origin matters:
 * the Circles iOS in-app webview drops cross-origin WSS connections (1006),
 * but allows same-origin ones. An explicit VITE_FREEQ_WS_URL overrides this
 * (e.g. to connect directly during local dev).
 */
function defaultWsUrl(): string {
  const override = import.meta.env.VITE_FREEQ_WS_URL as string | undefined;
  if (override) return override;
  if (typeof location !== 'undefined' && location.origin.startsWith('http')) {
    return `${location.origin.replace(/^http/, 'ws')}/irc`;
  }
  return 'wss://chaichat.attps.workers.dev/irc';
}

export const WS_URL: string = defaultWsUrl();
export const PDS_URL: string =
  (import.meta.env.VITE_PDS_URL as string | undefined) ?? 'https://self.surf';
export const DEFAULT_CHANNELS: string[] = (
  (import.meta.env.VITE_DEFAULT_CHANNELS as string | undefined) ?? '#chaichat'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export interface ChatHandlers {
  onState: (state: TransportState) => void;
  onRegistered: (nick: string) => void;
  onNickChanged: (nick: string) => void;
  onAuthError: (error: string) => void;
  onMessage: (channel: string, message: Message) => void;
  onHistory: (channel: string, messages: Message[]) => void;
  onMembers: (channel: string, members: Array<Partial<Member> & { nick: string }>) => void;
  onMemberJoined: (channel: string, member: Partial<Member> & { nick: string }) => void;
  onMemberLeft: (channel: string, nick: string) => void;
  onChannelJoined: (channel: string) => void;
  onChannelLeft: (channel: string) => void;
  onTopic: (channel: string, topic: string) => void;
  /** Called before each reconnect attempt — return fresh SASL creds (or null to go guest). */
  refreshSasl: () => Promise<SaslCredentials | null>;
  /** Called when SASL keeps failing — the caller should reconnect as a guest. */
  onAuthGiveUp?: () => void;
}

let client: FreeqClient | null = null;
let manualDisconnect = false;
/** Identity of the live connection, so a duplicate connectChat() with the same
 *  identity is a no-op instead of tearing down a working socket. */
let activeKey: string | null = null;
let authFailures = 0;
/** After this many consecutive SASL rejections, stop retrying the doomed
 *  credentials — the caller drops to guest instead of hammering the server.
 *  Set generously: with fresh tokens a real DID should authenticate, so only
 *  give up after several genuine failures (avoids a transient blip dropping a
 *  real identity to guest). */
const MAX_AUTH_FAILURES = 4;

export function getClient(): FreeqClient | null {
  return client;
}

export function connectChat(opts: {
  nick: string;
  sasl: SaslCredentials | null;
  channels: string[];
  handlers: ChatHandlers;
}): FreeqClient {
  // De-dupe: if a connection for this exact identity is already live (or
  // connecting), reuse it. Without this, a second connectChat() — e.g. from a
  // StrictMode remount or a re-triggered boot — would disconnect() the first,
  // just-authenticated socket (observed as code=1005 intentional=true right
  // after registration), looping forever.
  const key = `${opts.nick}:${opts.sasl?.did ?? 'guest'}:${opts.sasl?.method ?? 'none'}`;
  if (client && activeKey === key && !manualDisconnect) {
    return client; // de-dupe: reuse the live connection
  }

  disconnectChat();
  manualDisconnect = false;
  activeKey = key;

  authFailures = 0;
  const c = new FreeqClient({
    url: WS_URL,
    nick: opts.nick,
    channels: opts.channels,
    ...(opts.sasl ? { sasl: opts.sasl } : {}),
    onNickCollision: 'random-suffix',
    // Skip the auto-minted Ed25519 message-signing key. WebCrypto Ed25519 is
    // unreliable in some webviews (the Circles iOS in-app browser throws
    // InvalidAccessError), and the post-auth MSGSIG/e2ee crypto burst was
    // destabilizing the just-registered socket. Plaintext MVP chat doesn't
    // need per-message signing.
    autoMsgSig: false,
  });
  client = c;

  const h = opts.handlers;
  const authedWithSasl = !!opts.sasl;
  c.on('connectionStateChanged', (state) => {
    h.onState(state);
    if (state === 'disconnected' && !manualDisconnect) {
      // The SDK's transport auto-reconnects on close — we do NOT reconnect
      // ourselves (two reconnect loops orphan sockets that kill each other).
      // We only (a) refresh the SASL token so the SDK's next retry uses a
      // fresh one, and (b) give up to guest after repeated auth failures.
      if (authedWithSasl && authFailures >= MAX_AUTH_FAILURES) {
        manualDisconnect = true; // stop the SDK auto-reconnect loop too
        if (h.onAuthGiveUp) h.onAuthGiveUp();
        return;
      }
      void (async () => {
        try {
          const creds = await h.refreshSasl();
          if (creds && client === c) c.setSaslCredentials(creds);
        } catch {
          // keep current creds; the SDK retries regardless
        }
      })();
    }
  });
  c.on('registered', (n) => {
    authFailures = 0;
    h.onRegistered(n);
  });
  c.on('nickChanged', h.onNickChanged);
  c.on('authError', (reason) => {
    authFailures += 1;
    h.onAuthError(reason);
  });
  c.on('message', h.onMessage);
  c.on('historyBatch', h.onHistory);
  c.on('membersList', h.onMembers);
  c.on('memberJoined', h.onMemberJoined);
  c.on('memberLeft', h.onMemberLeft);
  c.on('channelJoined', (channel) => {
    h.onChannelJoined(channel);
    // Pull recent scrollback as soon as we land in a room.
    c.requestHistory({ target: channel, mode: 'latest', count: 50 });
  });
  c.on('channelLeft', h.onChannelLeft);
  c.on('topicChanged', (channel, topic) => h.onTopic(channel, topic));

  c.connect();
  return c;
}

export function disconnectChat(): void {
  manualDisconnect = true;
  activeKey = null;
  if (client) {
    try {
      client.disconnect();
    } catch {
      // already closed
    }
    client.removeAllListeners();
    client = null;
  }
}

export function makeSasl(did: string, accessJwt: string): SaslCredentials {
  return { token: accessJwt, did, pdsUrl: PDS_URL, method: 'pds-session' };
}

// ── Guest identities ────────────────────────────────────────────────────
// The freeq server requires SASL, so "guests" are ephemeral did:key
// identities authenticated via the crypto method — zero signup, no PDS.
// The seed persists in localStorage so a guest keeps their nick.

const GUEST_SEED_KEY = 'chaichat.guestkey.v1';
const GUEST_NICK_KEY = 'chaichat.guestnick.v1';

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Load-or-create the persistent guest did:key + nick. */
export async function guestSasl(): Promise<{ creds: SaslCredentials; nick: string }> {
  let key;
  const storedSeed = localStorage.getItem(GUEST_SEED_KEY);
  if (storedSeed) {
    try {
      key = await importDidKey(unb64(storedSeed));
    } catch {
      key = null;
    }
  }
  if (!key) {
    key = await generateDidKey();
    try {
      localStorage.setItem(GUEST_SEED_KEY, b64(await key.exportSeed()));
    } catch {
      // private mode — guest identity just won't persist
    }
  }

  let nick = localStorage.getItem(GUEST_NICK_KEY);
  if (!nick) {
    nick = `guest-${1000 + Math.floor(Math.random() * 9000)}`;
    try {
      localStorage.setItem(GUEST_NICK_KEY, nick);
    } catch {
      // ignore
    }
  }

  return {
    creds: { token: '', did: key.did, pdsUrl: '', method: 'crypto', signer: key.signer },
    nick,
  };
}
