import { useState } from 'react';
import { useApp } from '../store';

/**
 * First-time Circles-host entry: a deliberate "Start chatting" gesture before
 * we run the Safe signature + DID provisioning. (Returning users skip this —
 * boot() connects them straight through from their saved session.)
 */
export function LandingScreen() {
  const enterChat = useApp((s) => s.enterChat);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-8">
      <div className="text-6xl">🍵</div>
      <div className="text-center">
        <div className="text-2xl font-semibold tracking-tight">chaichat</div>
        <div className="pt-1 text-sm text-ink-dim">group chats, portable identity</div>
      </div>
      <p className="max-w-xs text-center text-sm text-ink-dim">
        tap below to get your identity and start chatting — no signup, nothing to install
      </p>
      <button
        onClick={async () => {
          setBusy(true);
          try {
            await enterChat();
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="w-full max-w-xs rounded-xl bg-chai px-4 py-3 font-medium text-bg active:opacity-80 disabled:opacity-50"
      >
        {busy ? 'setting you up…' : 'Start chatting'}
      </button>
      <p className="max-w-xs text-center text-[11px] text-ink-dim/70">
        you'll sign a quick message with your Circles wallet to prove it's you
      </p>
    </div>
  );
}
