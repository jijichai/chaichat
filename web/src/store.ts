import { create } from 'zustand';
import type { Message, Member, TransportState } from '@freeq/sdk';
import type { HostKind } from './host/types';
import type { StoredSession } from './auth/session';
import { clearSession, accessTokenFresh, loadSession } from './auth/session';
import { detectHost } from './host/detect';
import {
  provision,
  refreshTokens,
  NeedsWalletError,
  NeedsManualAuthError,
  type ProvisionPhase,
} from './auth/provision';
import { requestCreateAccount } from './host/circles';
import { api } from './auth/api';
import {
  connectChat,
  disconnectChat,
  getClient,
  makeSasl,
  guestSasl,
  DEFAULT_CHANNELS,
} from './chat/connection';
import type { SaslCredentials } from '@freeq/sdk';

export type BootPhase =
  | 'detecting'
  | 'landing' // Circles host, no cached session: show "Start chatting" gate
  | 'authenticating'
  | 'provisioning'
  | 'connecting'
  | 'ready'
  | 'welcome'
  | 'needs-wallet'
  | 'error';

export type Tab = 'chats' | 'you';

/** A member's Circles identity, resolved from their Safe via the backend. */
export interface CirclesIdentity {
  displayName: string | null;
  avatar: string | null; // data: URI
}

export interface ChannelState {
  name: string;
  topic: string;
  messages: Message[];
  members: Record<string, Member>;
  unread: number;
  joined: boolean;
}

function emptyChannel(name: string): ChannelState {
  return { name, topic: '', messages: [], members: {}, unread: 0, joined: false };
}

/** Merge messages, dedupe by id, keep chronological order. */
function mergeMessages(existing: Message[], incoming: Message[], prepend: boolean): Message[] {
  const seen = new Set(existing.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return existing;
  return prepend ? [...fresh, ...existing] : [...existing, ...fresh];
}

interface AppState {
  // boot
  phase: BootPhase;
  host: HostKind | null;
  session: StoredSession | null;
  guest: boolean;
  bootError: string | null;
  provisionPhase: ProvisionPhase | null;

  // chat
  conn: TransportState;
  registered: boolean;
  nick: string | null;
  channels: Record<string, ChannelState>;
  active: string | null;
  authFailed: boolean;
  authErrorReason: string | null;
  firstRunChipSeen: boolean;
  sentFirstMessage: boolean;

  // Circles profiles resolved by nick (username + avatar data URI). null value
  // = either in-flight, or resolved with no profile (fall back to initials).
  // A "miss" (resolved-absent) is recorded in profileMisses so it can be
  // retried later — a profile may not be indexed yet when first looked up
  // (notably a user's OWN freshly-created identity), and we must not cache the
  // absence forever or that user never sees their own avatar until reload.
  profiles: Record<string, CirclesIdentity | null>;
  /** nick → epoch ms of last resolved-absent result; gates re-fetch. */
  profileMisses: Record<string, number>;
  /** nicks with an in-flight profile fetch (de-dup; not for rendering). */
  profilesInFlight: Set<string>;

  // ui
  tab: Tab;
  backupOpen: boolean;

  // actions
  boot: () => Promise<void>;
  enterChat: () => Promise<void>;
  retryBoot: () => void;
  continueAsGuest: () => void;
  createCirclesAccount: () => Promise<void>;
  claimIdentity: () => Promise<void>;
  adoptSession: (session: StoredSession) => void;
  signOut: () => void;
  startChat: () => void;
  setActive: (channel: string | null) => void;
  setTab: (tab: Tab) => void;
  setBackupOpen: (open: boolean) => void;
  sendMessage: (text: string) => void;
  loadOlder: (channel: string) => void;
  joinChannel: (channel: string) => void;
  markBackupDone: () => void;
  resolveProfiles: (nicks: string[]) => void;
}

// Guards against concurrent boot()/connect — React StrictMode double-invokes
// the mount effect, which would otherwise spawn two competing chat connections
// (each tearing down the other's just-authenticated socket).
let booting = false;

export const useApp = create<AppState>((set, get) => {
  function channelUpdate(name: string, fn: (ch: ChannelState) => ChannelState) {
    set((s) => {
      const ch = s.channels[name] ?? emptyChannel(name);
      return { channels: { ...s.channels, [name]: fn(ch) } };
    });
  }

  function beginChat(nick: string, sasl: SaslCredentials | null) {
    set({ conn: 'connecting', registered: false, authFailed: false, authErrorReason: null, nick });
    // When we authenticate with did:key (guest, or a dev DID standing in for a
    // real account), those credentials don't expire and must be reused verbatim
    // on every reconnect — not swapped for pds-session creds.
    const fixedCreds = sasl?.method === 'crypto' ? sasl : null;
    connectChat({
      nick,
      sasl,
      channels: DEFAULT_CHANNELS,
      handlers: {
        onState: (state) => set({ conn: state, ...(state !== 'connected' ? { registered: false } : {}) }),
        onRegistered: (n) => set({ registered: true, nick: n, phase: 'ready' }),
        onNickChanged: (n) => set({ nick: n }),
        onAuthError: (reason) => set({ authFailed: true, authErrorReason: reason }),
        onMessage: (channel, message) => {
          const { active, sentFirstMessage } = get();
          channelUpdate(channel, (ch) => ({
            ...ch,
            messages: mergeMessages(ch.messages, [message], false),
            unread: channel === active || message.isSelf ? ch.unread : ch.unread + 1,
          }));
          if (message.isSelf && !sentFirstMessage) set({ sentFirstMessage: true });
          get().resolveProfiles([message.from]);
        },
        onHistory: (channel, messages) => {
          channelUpdate(channel, (ch) => ({
            ...ch,
            messages: mergeMessages(ch.messages, messages, true),
          }));
          get().resolveProfiles(messages.map((m) => m.from));
        },
        onMembers: (channel, members) => {
          channelUpdate(channel, (ch) => ({
            ...ch,
            members: Object.fromEntries(
              members.map((m) => [
                m.nick,
                {
                  ...m,
                  nick: m.nick,
                  isOp: m.isOp ?? false,
                  isHalfop: m.isHalfop ?? false,
                  isVoiced: m.isVoiced ?? false,
                } as Member,
              ]),
            ),
          }));
          get().resolveProfiles(members.map((m) => m.nick));
        },
        onMemberJoined: (channel, member) => {
          get().resolveProfiles([member.nick]);
          channelUpdate(channel, (ch) => ({
            ...ch,
            members: {
              ...ch.members,
              [member.nick]: {
                ...member,
                nick: member.nick,
                isOp: member.isOp ?? false,
                isHalfop: member.isHalfop ?? false,
                isVoiced: member.isVoiced ?? false,
              } as Member,
            },
          }));
        },
        onMemberLeft: (channel, nick) =>
          channelUpdate(channel, (ch) => {
            const members = { ...ch.members };
            delete members[nick];
            return { ...ch, members };
          }),
        onChannelJoined: (channel) => {
          channelUpdate(channel, (ch) => ({ ...ch, joined: true }));
          if (!get().active) set({ active: channel });
        },
        onChannelLeft: (channel) => channelUpdate(channel, (ch) => ({ ...ch, joined: false })),
        onTopic: (channel, topic) => channelUpdate(channel, (ch) => ({ ...ch, topic })),
        refreshSasl: async () => {
          // did:key sessions (guests, dev DIDs) keep their original creds.
          if (fixedCreds) return fixedCreds;
          const { session, guest } = get();
          if (guest || !session) return null;
          if (session.accessExpiresAt - Date.now() < 10 * 60 * 1000) {
            const next = await refreshTokens(session);
            set({ session: next });
            return makeSasl(next.did, next.accessJwt);
          }
          return makeSasl(session.did, session.accessJwt);
        },
        onAuthGiveUp: () => {
          // SASL repeatedly rejected our real DID (e.g. the server can't yet
          // accept this credential) — keep the session so the You tab still
          // shows the real identity + backup, but chat under a did:key guest
          // so the user can still talk instead of looping forever.
          set({ authFailed: true });
          void guestSasl().then(({ creds, nick }) => {
            const s = get().session;
            beginChat(s ? s.nick : nick, creds);
          });
        },
      },
    });
  }

  return {
    phase: 'detecting',
    host: null,
    session: null,
    guest: false,
    bootError: null,
    provisionPhase: null,

    conn: 'disconnected',
    registered: false,
    nick: null,
    channels: {},
    active: null,
    authFailed: false,
    authErrorReason: null,
    firstRunChipSeen: false,
    sentFirstMessage: false,
    profiles: {},
    profileMisses: {},
    profilesInFlight: new Set<string>(),

    tab: 'chats',
    backupOpen: false,

    boot: async () => {
      // Re-entrancy guard: a second concurrent boot (StrictMode remount, double
      // tap) must not start a competing connection.
      if (booting) return;
      set({ phase: 'detecting', bootError: null });
      const host = await detectHost();
      set({ host });
      // Returning user with a saved session → connect straight through (fast
      // re-entry, no gesture needed). First-time Circles-host user → show the
      // "Start chatting" landing gate (the Safe signature needs a user gesture
      // anyway). Plain browser → welcome (restore / guest).
      if (loadSession()) {
        await get().enterChat();
      } else if (host === 'circles') {
        set({ phase: 'landing' });
      } else {
        set({ phase: 'welcome' });
      }
    },

    enterChat: async () => {
      if (booting) return;
      booting = true;
      set({ phase: 'authenticating', bootError: null });
      try {
        const host = get().host ?? (await detectHost());
        const session = await provision(host, (p) => {
          set({
            provisionPhase: p,
            phase: p === 'verifying' || p === 'refreshing' ? 'provisioning' : 'authenticating',
          });
        });
        set({ session, guest: false, phase: 'connecting' });
        get().startChat();
      } catch (err) {
        if (err instanceof NeedsManualAuthError) {
          set({ phase: 'welcome' });
        } else if (err instanceof NeedsWalletError) {
          set({ phase: 'needs-wallet' });
        } else {
          set({
            phase: 'error',
            bootError: err instanceof Error ? err.message : 'Could not sign you in',
          });
        }
      } finally {
        booting = false;
      }
    },

    retryBoot: () => {
      disconnectChat();
      void get().boot();
    },

    continueAsGuest: () => {
      set({ guest: true, session: null, phase: 'connecting' });
      get().startChat();
    },

    createCirclesAccount: async () => {
      set({ phase: 'authenticating', bootError: null });
      try {
        await requestCreateAccount();
        await get().boot();
      } catch (err) {
        set({
          phase: 'needs-wallet',
          bootError: err instanceof Error ? err.message : 'Account creation was cancelled',
        });
      }
    },

    claimIdentity: async () => {
      const { host } = get();
      // In a browser there's no host wallet — send them to restore/welcome.
      if (host !== 'circles') {
        get().signOut();
        return;
      }
      // In the Circles host: drop the guest chat, then run the host's
      // account flow from this user gesture. requestCreateAccount() resolves
      // immediately if a wallet is already connected, or opens the host's
      // passkey/connect UI if not — either way boot() then provisions a real
      // DID. (Per Circles docs, the host may only surface the wallet after an
      // explicit gesture, so we can't rely on a passive wait alone.)
      disconnectChat();
      set({ guest: false, session: null, channels: {}, active: null, nick: null });
      await get().createCirclesAccount();
    },

    adoptSession: (session) => {
      set({ session, guest: false, phase: 'connecting', bootError: null, channels: {}, active: null });
      get().startChat();
    },

    signOut: () => {
      disconnectChat();
      clearSession();
      set({
        session: null,
        guest: false,
        phase: 'welcome',
        channels: {},
        active: null,
        registered: false,
        conn: 'disconnected',
        nick: null,
      });
    },

    startChat: () => {
      const { session, guest } = get();
      // Fake-ePDS DIDs (dev loop) have no real DID document, so they can't pass
      // pds-session SASL — chat via a did:key identity instead while keeping the
      // session for API flows. The prefix is the signal, not the build flag:
      // these DIDs are fake however the bundle was built (Vite dev or wrangler).
      const devDid = !!session && session.did.startsWith('did:plc:dev');
      if (session && !guest && !devDid) {
        // self.surf access tokens are short-lived (~minutes). A cached token
        // may be stale by the time SASL runs, so mint a guaranteed-fresh one
        // right before connecting — freeq's getSession rejects stale tokens.
        void (async () => {
          let s = session;
          if (!accessTokenFresh(s, Date.now() + 60 * 1000)) {
            try {
              s = await refreshTokens(s);
              set({ session: s });
            } catch {
              // Refresh failed; try the cached token anyway, then fall back.
            }
          }
          beginChat(s.nick, makeSasl(s.did, s.accessJwt));
        })();
        return;
      }
      void guestSasl()
        .then(({ creds, nick }) => beginChat(devDid && session ? session.nick : nick, creds))
        .catch((err) => {
          // Ed25519 WebCrypto missing (old webview) — guest mode unavailable.
          set({
            phase: 'error',
            bootError:
              err instanceof Error && /Ed25519|generateKey/i.test(err.message)
                ? 'this browser cannot do guest mode — sign in with email instead'
                : 'could not start guest mode',
          });
        });
    },

    setActive: (channel) => {
      set({ active: channel });
      if (channel) channelUpdate(channel, (ch) => ({ ...ch, unread: 0 }));
    },

    setTab: (tab) => set({ tab }),
    setBackupOpen: (open) => set({ backupOpen: open }),

    sendMessage: (text) => {
      const { active } = get();
      const client = getClient();
      if (!active || !client || !text.trim()) return;
      client.sendMessage(active, text.trim());
    },

    loadOlder: (channel) => {
      const client = getClient();
      const ch = get().channels[channel];
      const oldest = ch?.messages[0];
      if (!client || !oldest) return;
      client.requestHistory({ target: channel, mode: 'before', msgid: oldest.id, count: 50 });
    },

    joinChannel: (channel) => {
      const client = getClient();
      if (!client) return;
      client.join(channel);
      set({ tab: 'chats' });
      get().setActive(channel);
    },

    markBackupDone: () => {
      const { session } = get();
      if (session) set({ session: { ...session, backupEmailSet: true } });
    },

    resolveProfiles: (nicks) => {
      // Re-fetch a missed profile at most this often. A profile can be absent
      // on first lookup (not indexed yet) and appear shortly after — retrying
      // lets the avatar fill in without a reload. Short enough to feel live.
      const MISS_RETRY_MS = 30_000;
      // Fetch Circles profiles for nicks we haven't resolved yet. Guests
      // (nick starting "guest-"/"chai-guest-") have no Circles identity — skip.
      const { profiles: known, profileMisses: misses, profilesInFlight } = get();
      const now = Date.now();
      const want = [...new Set(nicks)].filter((n) => {
        if (!n || /^(chai-)?guest-/.test(n)) return false;
        if (profilesInFlight.has(n)) return false; // already fetching
        if (known[n]) return false; // have a real profile
        const missedAt = misses[n];
        if (missedAt !== undefined && now - missedAt < MISS_RETRY_MS) return false;
        return true;
      });
      if (want.length === 0) return;
      // Track in-flight separately from the rendered map so a pending fetch
      // doesn't read as "resolved-absent".
      want.forEach((n) => profilesInFlight.add(n));
      void api
        .profiles(want)
        .then((r) => {
          set((s) => {
            const nextProfiles = { ...s.profiles };
            const nextMisses = { ...s.profileMisses };
            for (const nick of want) {
              const p = r.profiles[nick];
              if (p && (p.displayName || p.avatar)) {
                nextProfiles[nick] = p;
                delete nextMisses[nick];
              } else {
                nextProfiles[nick] = null; // render falls back to initials
                nextMisses[nick] = Date.now(); // but allow a later retry
              }
            }
            return { profiles: nextProfiles, profileMisses: nextMisses };
          });
        })
        .catch(() => {
          // Network error — record a miss so we retry later, don't wedge.
          set((s) => ({
            profileMisses: { ...s.profileMisses, ...Object.fromEntries(want.map((n) => [n, Date.now()])) },
          }));
        })
        .finally(() => {
          want.forEach((n) => profilesInFlight.delete(n));
        });
    },
  };
});
