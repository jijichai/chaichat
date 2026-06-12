import { useState } from 'react';
import { useApp } from '../store';
import { MessageList } from './MessageList';
import { Avatar, useDisplayName } from './Avatar';

function MemberRow({ nick, isOp }: { nick: string; isOp: boolean }) {
  const name = useDisplayName(nick);
  return (
    <div className="flex items-center gap-2 py-1">
      <Avatar nick={nick} size={22} />
      <span className="truncate">{name}</span>
      {isOp ? (
        <span title="founder/op" className="text-[10px]">
          ⭐
        </span>
      ) : null}
    </div>
  );
}

export function RoomView({ channel }: { channel: string }) {
  const ch = useApp((s) => s.channels[channel]);
  const setActive = useApp((s) => s.setActive);
  const sendMessage = useApp((s) => s.sendMessage);
  const conn = useApp((s) => s.conn);
  const registered = useApp((s) => s.registered);
  const sentFirstMessage = useApp((s) => s.sentFirstMessage);
  const session = useApp((s) => s.session);
  const guest = useApp((s) => s.guest);
  const setBackupOpen = useApp((s) => s.setBackupOpen);
  const [text, setText] = useState('');
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  const memberCount = Object.keys(ch?.members ?? {}).length;
  const canSend = conn === 'connected' && registered;
  const showBackupBanner =
    !guest && session && !session.backupEmailSet && sentFirstMessage && !bannerDismissed;

  const submit = () => {
    if (!text.trim()) return;
    sendMessage(text);
    setText('');
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border px-2 py-2">
        <button onClick={() => setActive(null)} className="px-2 py-1 text-ink-dim active:opacity-60">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{channel}</div>
          {ch?.topic ? <div className="truncate text-[11px] text-ink-dim">{ch.topic}</div> : null}
        </div>
        <button
          onClick={() => setMembersOpen(!membersOpen)}
          className="flex items-center gap-1.5 px-2 text-xs text-ink-dim active:opacity-60"
        >
          <span className="relative flex h-2 w-2">
            {canSend ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-75" />
            ) : null}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${canSend ? 'bg-ok' : 'bg-warn'}`}
            />
          </span>
          {memberCount || '…'}
        </button>
      </header>

      {membersOpen ? (
        <div className="max-h-44 overflow-y-auto border-b border-border bg-surface px-4 py-2 text-xs">
          {Object.values(ch?.members ?? {})
            .sort((a, b) => Number(b.isOp) - Number(a.isOp) || a.nick.localeCompare(b.nick))
            .map((m) => (
              <MemberRow key={m.nick} nick={m.nick} isOp={m.isOp} />
            ))}
        </div>
      ) : null}

      <MessageList channel={channel} messages={ch?.messages ?? []} />

      {showBackupBanner ? (
        <div className="flex items-center gap-2 border-t border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          <button onClick={() => setBackupOpen(true)} className="flex-1 text-left">
            💾 your identity lives only on this device — back it up
          </button>
          <button onClick={() => setBannerDismissed(true)} className="px-1">
            ✕
          </button>
        </div>
      ) : null}

      <div
        className="flex items-end gap-2 border-t border-border bg-surface py-2 pl-3"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom), 8px)',
          // The Circles host overlays a circular zoom/fullscreen button in the
          // bottom-right corner that we can't move. Reserve space so our send
          // button sits to the LEFT of it and stays tappable.
          paddingRight: 'calc(64px + env(safe-area-inset-right))',
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={canSend ? `message ${channel}…` : 'connecting…'}
          disabled={!canSend}
          rows={1}
          className="max-h-28 flex-1 resize-none rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none placeholder:text-ink-dim/60 focus:border-chai/60 disabled:opacity-50"
        />
        <button
          onClick={submit}
          disabled={!canSend || !text.trim()}
          className="rounded-xl bg-chai px-3 py-2 font-bold text-bg disabled:opacity-40"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
