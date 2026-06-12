import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { api } from '../auth/api';
import { Avatar } from './Avatar';

type Me = Awaited<ReturnType<typeof api.me>>;

export function YouTab() {
  const session = useApp((s) => s.session);
  const guest = useApp((s) => s.guest);
  const nick = useApp((s) => s.nick);
  const conn = useApp((s) => s.conn);
  const host = useApp((s) => s.host);
  const signOut = useApp((s) => s.signOut);
  const claimIdentity = useApp((s) => s.claimIdentity);
  const setBackupOpen = useApp((s) => s.setBackupOpen);
  const resolveProfiles = useApp((s) => s.resolveProfiles);
  const myProfile = useApp((s) => (session ? s.profiles[session.nick] : null));
  const [copied, setCopied] = useState(false);
  const [copiedSafe, setCopiedSafe] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  // Resolve our own Circles profile so the identity card shows the real
  // username + avatar.
  useEffect(() => {
    if (session) resolveProfiles([session.nick]);
  }, [session, resolveProfiles]);

  // Pull the Safe address + on-chain Circles details for the identity card.
  useEffect(() => {
    if (!session) {
      setMe(null);
      return;
    }
    let alive = true;
    api
      .me(session.sessionJwt)
      .then((r) => alive && setMe(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [session]);

  const youName = (session && myProfile?.displayName) || session?.nick || '';

  if (guest || !session) {
    const inCircles = host === 'circles';
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8">
        <div className="text-4xl">👤</div>
        <div className="text-center text-sm text-ink-dim">
          you're browsing as a guest{nick ? ` (${nick})` : ''}
        </div>
        {inCircles ? (
          <p className="max-w-xs text-center text-xs text-ink-dim">
            connect your Circles wallet to get a portable identity you can chat and create
            circles with
          </p>
        ) : null}
        <button
          onClick={async () => {
            setClaiming(true);
            try {
              await claimIdentity();
            } finally {
              setClaiming(false);
            }
          }}
          disabled={claiming}
          className="w-full max-w-xs rounded-xl bg-chai px-4 py-3 font-medium text-bg active:opacity-80 disabled:opacity-50"
        >
          {claiming
            ? 'connecting…'
            : inCircles
              ? 'Connect Circles account'
              : 'Claim your identity'}
        </button>
        <div className="text-[10px] text-ink-dim/60">host: {host ?? 'detecting…'}</div>
      </div>
    );
  }

  const copyDid = () => {
    void navigator.clipboard?.writeText(session.did).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const safe = me?.safeAddress ?? null;
  const copySafe = () => {
    if (!safe) return;
    void navigator.clipboard?.writeText(safe).then(() => {
      setCopiedSafe(true);
      setTimeout(() => setCopiedSafe(false), 1500);
    });
  };
  const shortSafe = safe ? `${safe.slice(0, 6)}…${safe.slice(-4)}` : '';
  const regName = me?.circlesProfile?.registeredName || null;
  const bio = me?.circlesProfile?.description || null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col items-center gap-2 px-6 pb-4 pt-8">
        <Avatar nick={session.nick} size={64} />
        <div className="text-lg font-semibold">{youName}</div>
        <div className="text-xs text-ink-dim">{session.handle}</div>
        <button onClick={copyDid} className="max-w-full truncate rounded bg-surface px-2 py-1 text-[10px] text-ink-dim active:opacity-70">
          {copied ? 'copied ✓' : `${session.did} 📋`}
        </button>
        <div className="flex items-center gap-1 text-xs text-ink-dim">
          via {session.platform === 'circles' ? 'Circles' : session.platform}
          <span className={conn === 'connected' ? 'text-ok' : 'text-warn'}>●</span>
          {conn}
        </div>
      </div>

      {safe ? (
        <div className="mx-4 mb-3 rounded-2xl border border-border bg-surface p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-dim">
            Circles identity
          </div>
          <div className="mt-2 flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-dim">Address</span>
              <button
                onClick={copySafe}
                className="rounded bg-bg px-2 py-1 font-mono text-xs active:opacity-70"
                title={safe}
              >
                {copiedSafe ? 'copied ✓' : `${shortSafe} 📋`}
              </button>
            </div>
            {regName ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-dim">Name</span>
                <span className="truncate font-medium">{regName}</span>
              </div>
            ) : null}
            {bio ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-ink-dim">Bio</span>
                <span className="text-ink">{bio}</span>
              </div>
            ) : null}
          </div>
          <p className="mt-2 text-[10px] text-ink-dim/70">
            your Circles wallet on Gnosis — this is the address other members trust
          </p>
        </div>
      ) : null}

      <div className="mx-4 mb-3 rounded-2xl border border-border bg-surface p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-dim">
          Chat security
        </div>
        <div className="mt-2 flex flex-col gap-2.5">
          <SecurityRow
            state="on"
            title="Encrypted transport"
            desc="all chat traffic runs over TLS (wss://) to the server"
          />
          <SecurityRow
            state="on"
            title="Verified identity"
            desc="every message is signed by your DID — nobody can post as you"
          />
          <SecurityRow
            state="soon"
            title="End-to-end encryption"
            desc="message contents are not yet E2E encrypted — the server can read them. trust-gated E2EE for groupchats is coming soon."
          />
        </div>
        <p className="mt-3 border-t border-border/50 pt-2 text-[10px] text-ink-dim/70">
          chat is powered by IRC (Internet Relay Chat) — the open, decades-old
          real-time messaging protocol.
        </p>
      </div>

      <div className="mx-4 rounded-2xl border border-border bg-surface p-4">
        {session.backupEmailSet ? (
          <>
            <div className="flex items-center gap-2 font-medium text-ok">✓ Backed up</div>
            <p className="pt-1 text-xs text-ink-dim">
              you can sign in with your email on any device to recover this identity
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 font-medium text-warn">⚠ Not backed up</div>
            <p className="py-1 text-xs text-ink-dim">
              your identity exists only on this device — bind an email so you can recover it
              anywhere
            </p>
            <button
              onClick={() => setBackupOpen(true)}
              className="mt-2 w-full rounded-xl bg-chai px-4 py-3 font-medium text-bg active:opacity-80"
            >
              💾 Back up account data
            </button>
          </>
        )}
      </div>

      <div className="mx-4 mt-4 flex flex-col rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3 text-sm text-ink-dim">
          change username <span className="text-[10px]">coming soon</span>
        </div>
        <button
          onClick={() => {
            if (
              session.backupEmailSet ||
              confirm('This identity is NOT backed up — signing out will lose it forever. Sign out anyway?')
            ) {
              signOut();
            }
          }}
          className="px-4 py-3 text-left text-sm text-err active:bg-surface-2"
        >
          sign out
        </button>
      </div>
    </div>
  );
}

function SecurityRow({
  state,
  title,
  desc,
}: {
  state: 'on' | 'soon';
  title: string;
  desc: string;
}) {
  const on = state === 'on';
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
          on ? 'bg-ok/15 text-ok' : 'bg-surface-2 text-ink-dim'
        }`}
      >
        {on ? '✓' : '◌'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {title}
          {on ? null : (
            <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-ink-dim">
              soon
            </span>
          )}
        </span>
        <span className="block text-[11px] text-ink-dim">{desc}</span>
      </span>
    </div>
  );
}
