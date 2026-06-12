import { useApp } from '../store';
import { TabBar } from './TabBar';
import { ChatsTab } from './ChatsTab';
import { RoomView } from './RoomView';
import { YouTab } from './YouTab';
import { BackupModal } from './BackupModal';

export function ChatShell() {
  const tab = useApp((s) => s.tab);
  const active = useApp((s) => s.active);
  const conn = useApp((s) => s.conn);
  const guest = useApp((s) => s.guest);
  const nick = useApp((s) => s.nick);
  const authFailed = useApp((s) => s.authFailed);
  const authErrorReason = useApp((s) => s.authErrorReason);
  const signOut = useApp((s) => s.signOut);
  const backupOpen = useApp((s) => s.backupOpen);

  const showRoom = tab === 'chats' && active;

  return (
    <div className="flex h-full flex-col">
      {conn !== 'connected' ? (
        <div className="flex items-center justify-center gap-2 bg-warn/15 px-3 py-1 text-[11px] text-warn">
          ↻ {conn === 'connecting' ? 'connecting to chat…' : 'reconnecting…'}
        </div>
      ) : null}
      {/* Only an actual SASL rejection means "couldn't verify identity". A WS
          that simply won't open shows the neutral "connecting…" above. */}
      {authFailed ? (
        <div className="bg-err/15 px-3 py-1 text-center text-[11px] text-err">
          couldn't verify your identity — chatting as a guest
          {authErrorReason ? (
            <span className="mt-0.5 block text-[10px] text-err/70">({authErrorReason})</span>
          ) : null}
        </div>
      ) : null}
      {guest && conn === 'connected' ? (
        <button
          onClick={signOut}
          className="bg-surface-2 px-3 py-1 text-center text-[11px] text-ink-dim"
        >
          👤 chatting as {nick ?? 'guest'} — claim your identity ▸
        </button>
      ) : null}

      <main className="flex min-h-0 flex-1 flex-col">
        {showRoom ? (
          <RoomView channel={active} />
        ) : tab === 'chats' ? (
          <ChatsTab />
        ) : (
          <YouTab />
        )}
      </main>

      {!showRoom ? <TabBar /> : null}
      {backupOpen ? <BackupModal /> : null}
    </div>
  );
}
