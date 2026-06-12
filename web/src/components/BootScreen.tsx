import { useApp } from '../store';

const PHASE_LABEL: Record<string, string> = {
  detecting: 'looking around…',
  authenticating: 'checking who you are…',
  provisioning: 'setting up your identity…',
  connecting: 'joining the chat…',
};

export function BootScreen() {
  const { phase, host, provisionPhase, bootError, retryBoot, continueAsGuest, createCirclesAccount } =
    useApp();

  const debugOn =
    import.meta.env.DEV || new URLSearchParams(location.search).has('debug');

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-8">
      <div className="text-6xl">🍵</div>
      <div className="text-2xl font-semibold tracking-tight">chaichat</div>

      {phase === 'error' ? (
        <div className="flex w-full max-w-xs flex-col items-center gap-3">
          <div className="text-center text-sm text-err">
            ⚠ couldn't sign you in{bootError ? ` — ${bootError}` : ''}
          </div>
          <button
            onClick={retryBoot}
            className="w-full rounded-xl bg-chai px-4 py-3 font-medium text-bg active:opacity-80"
          >
            Try again
          </button>
          <button
            onClick={continueAsGuest}
            className="w-full rounded-xl border border-border px-4 py-3 text-ink-dim active:opacity-80"
          >
            Continue as guest
          </button>
        </div>
      ) : phase === 'needs-wallet' ? (
        <div className="flex w-full max-w-xs flex-col items-center gap-3">
          <div className="text-center text-sm text-ink-dim">
            Create your Circles account to start chatting
            {bootError ? <span className="block pt-1 text-err">{bootError}</span> : null}
          </div>
          <button
            onClick={() => void createCirclesAccount()}
            className="w-full rounded-xl bg-chai px-4 py-3 font-medium text-bg active:opacity-80"
          >
            Create my account
          </button>
          <button
            onClick={continueAsGuest}
            className="w-full rounded-xl border border-border px-4 py-3 text-ink-dim active:opacity-80"
          >
            Just look around
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-chai" />
          </div>
          <div className="text-sm text-ink-dim">{PHASE_LABEL[phase] ?? phase}</div>
        </div>
      )}

      {debugOn ? (
        <pre className="fixed bottom-2 left-2 right-2 max-h-40 overflow-auto rounded-lg bg-surface p-2 text-[10px] leading-relaxed text-ink-dim">
          {JSON.stringify(
            {
              phase,
              host,
              provisionPhase,
              inIframe: typeof window !== 'undefined' && window.parent !== window,
              bootError,
            },
            null,
            1,
          )}
        </pre>
      ) : null}
    </div>
  );
}
