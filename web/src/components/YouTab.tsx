import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { Avatar } from './Avatar';

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
  const [claiming, setClaiming] = useState(false);

  // Resolve our own Circles profile so the identity card shows the real
  // username + avatar.
  useEffect(() => {
    if (session) resolveProfiles([session.nick]);
  }, [session, resolveProfiles]);

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
