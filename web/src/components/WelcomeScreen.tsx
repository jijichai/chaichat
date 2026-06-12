import { useApp } from '../store';

/**
 * Plain-browser landing: restore by email or guest mode.
 * The email restore form itself ships in M4 (RestoreScreen); until then the
 * button routes there once it exists.
 */
export function WelcomeScreen({ onRestore }: { onRestore: () => void }) {
  const continueAsGuest = useApp((s) => s.continueAsGuest);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-8">
      <div className="text-6xl">🍵</div>
      <div className="text-center">
        <div className="text-2xl font-semibold tracking-tight">chaichat</div>
        <div className="pt-1 text-sm text-ink-dim">group chats, portable identity</div>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-3">
        <button
          onClick={onRestore}
          className="w-full rounded-xl bg-chai px-4 py-3 font-medium text-bg active:opacity-80"
        >
          I have an account
        </button>
        <button
          onClick={continueAsGuest}
          className="w-full rounded-xl border border-border px-4 py-3 text-ink-dim active:opacity-80"
        >
          Just look around
        </button>
      </div>
      <p className="max-w-xs text-center text-xs text-ink-dim">
        tip: open chaichat inside the Circles app for instant identity ✨
      </p>
    </div>
  );
}
