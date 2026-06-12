import { useApp, type Tab } from '../store';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'chats', label: 'Chat', icon: '💬' },
  { id: 'you', label: 'You', icon: '👤' },
];

export function TabBar() {
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const channels = useApp((s) => s.channels);
  const session = useApp((s) => s.session);
  const guest = useApp((s) => s.guest);

  const totalUnread = Object.values(channels).reduce((n, ch) => n + ch.unread, 0);
  const backupDot = !guest && session && !session.backupEmailSet;

  return (
    <nav
      className="flex shrink-0 border-t border-border bg-surface"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
            tab === t.id ? 'text-chai' : 'text-ink-dim'
          }`}
        >
          <span className="relative text-lg leading-none">
            {t.icon}
            {t.id === 'chats' && totalUnread > 0 ? (
              <span className="absolute -right-3 -top-1 rounded-full bg-chai px-1.5 text-[10px] font-bold text-bg">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            ) : null}
            {t.id === 'you' && backupDot ? (
              <span className="absolute -right-1.5 -top-0.5 h-2 w-2 rounded-full bg-warn" />
            ) : null}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
