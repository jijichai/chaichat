import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { api, type CircleSummary } from '../auth/api';
import { fmtPreview, nickColor, initials } from '../chat/format';
import { CreateCircleModal } from './CreateCircleModal';

/**
 * Combined "Chats" view: your joined rooms on top, a directory of circles to
 * discover below. Creating and joining circles both live here now.
 */
export function ChatsTab() {
  const channels = useApp((s) => s.channels);
  const setActive = useApp((s) => s.setActive);
  const session = useApp((s) => s.session);
  const guest = useApp((s) => s.guest);
  const joinChannel = useApp((s) => s.joinChannel);

  const [circles, setCircles] = useState<CircleSummary[] | null>(null);
  const [circlesEnabled, setCirclesEnabled] = useState(false);
  const [selected, setSelected] = useState<CircleSummary | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joining, setJoining] = useState(false);

  const refresh = () => {
    api
      .listCircles(session?.sessionJwt)
      .then((r) => {
        setCircles(r.circles);
        setCirclesEnabled(r.circlesEnabled);
      })
      .catch(() => setCircles([]));
  };
  useEffect(refresh, [session?.sessionJwt]);

  const rooms = Object.values(channels)
    .filter((ch) => ch.joined || ch.messages.length > 0)
    .sort((a, b) => {
      const ta = a.messages[a.messages.length - 1]?.timestamp.getTime() ?? 0;
      const tb = b.messages[b.messages.length - 1]?.timestamp.getTime() ?? 0;
      return tb - ta;
    });

  // Circles whose room you're not already in — the rest are redundant with the
  // rooms list above.
  const joinedChannelNames = new Set(rooms.map((r) => r.name));
  const discover = (circles ?? []).filter((c) => !joinedChannelNames.has(c.channel));

  const join = async (circle: CircleSummary) => {
    if (guest || !session) {
      joinChannel(circle.channel);
      setSelected(null);
      return;
    }
    setJoining(true);
    try {
      await api.joinCircle(session.sessionJwt, circle.slug);
    } catch {
      // membership record failed — still let them into the room
    } finally {
      setJoining(false);
    }
    joinChannel(circle.channel);
    setSelected(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-lg font-semibold">chaichat</span>
        {circlesEnabled ? (
          <button
            onClick={() => setCreateOpen(true)}
            disabled={guest || !session}
            className="rounded-xl bg-chai px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-40"
          >
            ◯ New circle
          </button>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto">
        {rooms.length === 0 && circles === null ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-ink-dim">
            <div className="text-3xl">💬</div>
            <div className="text-sm">joining rooms…</div>
          </div>
        ) : (
          <>
            {rooms.map((ch) => {
              const last = ch.messages[ch.messages.length - 1];
              return (
                <button
                  key={ch.name}
                  onClick={() => setActive(ch.name)}
                  className="flex w-full items-center gap-3 border-b border-border/50 px-4 py-3 text-left active:bg-surface"
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-bg"
                    style={{ background: nickColor(ch.name) }}
                  >
                    {ch.name.startsWith('#') ? '#' : initials(ch.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{ch.name}</span>
                      {ch.unread > 0 ? (
                        <span className="rounded-full bg-chai px-1.5 text-[11px] font-bold text-bg">
                          {ch.unread}
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-ink-dim">
                      {last ? `${last.from}: ${fmtPreview(last.text)}` : ch.topic || 'no messages yet'}
                    </div>
                  </div>
                </button>
              );
            })}

            {discover.length > 0 ? (
              <div className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-ink-dim">
                Discover circles
              </div>
            ) : null}
            {discover.map((c) => (
              <button
                key={c.slug}
                onClick={() => setSelected(c)}
                className="flex w-full items-center gap-3 border-b border-border/50 px-4 py-3 text-left active:bg-surface"
              >
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-bg"
                  style={{ background: nickColor(c.slug) }}
                >
                  {initials(c.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="truncate text-xs text-ink-dim">
                    {c.groupAddress ? 'on-chain ✓' : 'registering…'} · {c.memberCount}{' '}
                    {c.memberCount === 1 ? 'member' : 'members'}
                    {c.description ? ` · ${c.description}` : ''}
                  </div>
                </div>
              </button>
            ))}

            {rooms.length === 0 && discover.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-10 py-12 text-center">
                <div className="text-3xl">◯</div>
                <p className="text-sm text-ink-dim">
                  {circlesEnabled
                    ? 'no circles yet — start the first one: a chatroom with its own identity and on-chain Circles group'
                    : "you're all set — say hi in the rooms above"}
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>

      {selected ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/60"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl bg-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 pb-2">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full text-base font-bold text-bg"
                style={{ background: nickColor(selected.slug) }}
              >
                {initials(selected.name)}
              </div>
              <div>
                <div className="font-semibold">{selected.name}</div>
                <div className="text-xs text-ink-dim">
                  {selected.memberCount} {selected.memberCount === 1 ? 'member' : 'members'} ·{' '}
                  {selected.groupAddress ? 'on-chain ✓' : 'registering…'}
                </div>
              </div>
            </div>
            {selected.description ? (
              <p className="pb-2 text-sm text-ink-dim">"{selected.description}"</p>
            ) : null}
            <div className="pb-3 text-[10px] text-ink-dim">
              {selected.communityDid}
              {selected.groupAddress ? (
                <>
                  <br />
                  group: {selected.groupAddress}
                </>
              ) : null}
            </div>
            <button
              onClick={() => void join(selected)}
              disabled={joining}
              className="w-full rounded-xl bg-chai px-4 py-3 font-medium text-bg disabled:opacity-50"
            >
              {joining ? 'joining…' : selected.joined ? 'Open room' : 'Join'}
            </button>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <CreateCircleModal
          onClose={() => setCreateOpen(false)}
          onCreated={(c) => {
            setCreateOpen(false);
            refresh();
            joinChannel(c.channel);
          }}
        />
      ) : null}
    </div>
  );
}
