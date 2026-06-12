import { useEffect, useRef } from 'react';
import type { Message } from '@freeq/sdk';
import { fmtTime, nickColor } from '../chat/format';
import { useApp } from '../store';
import { Avatar, useDisplayName } from './Avatar';

function MessageRow({ m, sameAuthor }: { m: Message; sameAuthor: boolean }) {
  const name = useDisplayName(m.from);
  return (
    <div className={`${sameAuthor ? 'mt-0.5' : 'mt-3'} flex gap-2`}>
      <div className="w-9 shrink-0">{!sameAuthor ? <Avatar nick={m.from} size={32} /> : null}</div>
      <div className="min-w-0 flex-1">
        {!sameAuthor ? (
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold" style={{ color: nickColor(m.from) }}>
              {name}
            </span>
            <span className="shrink-0 text-[10px] text-ink-dim/70">{fmtTime(m.timestamp)}</span>
          </div>
        ) : null}
        <div
          className={`whitespace-pre-wrap break-words text-sm ${m.isAction ? 'italic text-ink-dim' : ''}`}
        >
          {m.deleted ? <i className="text-ink-dim">message deleted</i> : m.text}
        </div>
      </div>
    </div>
  );
}

export function MessageList({ channel, messages }: { channel: string; messages: Message[] }) {
  const loadOlder = useApp((s) => s.loadOlder);
  const nick = useApp((s) => s.nick);
  const guest = useApp((s) => s.guest);
  const firstRunChipSeen = useApp((s) => s.firstRunChipSeen);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 200;
    if (nearBottom) endRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [messages.length]);

  return (
    <div ref={boxRef} className="flex-1 overflow-y-auto px-3 py-2">
      {messages.length >= 50 ? (
        <button
          onClick={() => loadOlder(channel)}
          className="mx-auto mb-2 block rounded-full border border-border px-3 py-1 text-xs text-ink-dim active:bg-surface"
        >
          ▲ load earlier
        </button>
      ) : null}

      {!guest && !firstRunChipSeen && nick ? (
        <div className="mx-auto my-3 max-w-[85%] rounded-xl border border-chai/40 bg-chai/10 px-3 py-2 text-center text-xs text-chai-soft">
          ✓ you're chatting as <b>{nick}</b> — no signup needed
        </div>
      ) : null}

      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const sameAuthor = prev && prev.from === m.from && !m.isSystem;
        if (m.isSystem) {
          return (
            <div key={m.id} className="my-1 text-center text-[11px] text-ink-dim/70">
              {m.text}
            </div>
          );
        }
        return <MessageRow key={m.id} m={m} sameAuthor={!!sameAuthor} />;
      })}
      <div ref={endRef} />
    </div>
  );
}
