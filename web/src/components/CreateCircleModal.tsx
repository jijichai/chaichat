import { useState } from 'react';
import { useApp } from '../store';
import { api, ApiError, type CircleSummary, type CircleMode } from '../auth/api';

type Step = 'form' | 'creating' | 'done';

export function CreateCircleModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (circle: CircleSummary) => void;
}) {
  const session = useApp((s) => s.session);
  const guest = useApp((s) => s.guest);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<CircleMode>('open');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CircleSummary | null>(null);

  if (!session) return null;

  // Mutual-trust groupchats need a Circles account (the trust anchor).
  const hasCircles = !guest && session.platform === 'circles';
  const valid = name.trim().length >= 3 && name.trim().length <= 32;

  const create = async () => {
    setStep('creating');
    setError(null);
    try {
      const circle = await api.createCircle(
        session.sessionJwt,
        name.trim(),
        mode,
        description.trim() || undefined,
      );
      setCreated(circle);
      setStep('done');
    } catch (err) {
      setStep('form');
      setError(
        err instanceof ApiError
          ? err.code === 'CircleExists'
            ? 'a groupchat with that name already exists'
            : err.code === 'RateLimitExceeded'
              ? 'creation limit reached — try again tomorrow'
              : err.code === 'CirclesAccountRequired'
                ? 'connect a Circles account to make a mutual-trust groupchat'
                : err.message || 'could not create the groupchat'
          : 'could not create the groupchat',
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
      <div className="w-full max-w-sm rounded-t-2xl bg-surface p-5 sm:rounded-2xl">
        <div className="flex items-center justify-between pb-3">
          <div className="font-semibold">New groupchat</div>
          <button onClick={onClose} className="px-2 text-ink-dim">
            ✕
          </button>
        </div>

        {step === 'form' ? (
          <>
            <input
              placeholder="name (e.g. berlin-builders)"
              value={name}
              maxLength={32}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-border bg-bg px-3 py-3 text-sm outline-none focus:border-chai/60"
            />
            <textarea
              placeholder="what's it about? (optional)"
              value={description}
              maxLength={280}
              rows={2}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-2 w-full resize-none rounded-xl border border-border bg-bg px-3 py-3 text-sm outline-none focus:border-chai/60"
            />

            <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-dim">
              Who can join
            </div>
            <div className="mt-1.5 flex flex-col gap-1.5">
              <ModeOption
                selected={mode === 'mutual-trust'}
                disabled={!hasCircles}
                onClick={() => setMode('mutual-trust')}
                title="Mutual trust"
                desc={
                  hasCircles
                    ? 'only people you and they mutually trust on Circles'
                    : 'needs a Circles account'
                }
                icon="🤝"
              />
              <ModeOption
                selected={mode === 'open'}
                onClick={() => setMode('open')}
                title="Open to everyone"
                desc="anyone can join"
                icon="🌐"
              />
              <ModeOption
                selected={false}
                disabled
                onClick={() => {}}
                title="Other"
                desc="more access controls coming soon"
                icon="✨"
              />
            </div>

            {error ? <div className="pt-2 text-xs text-err">{error}</div> : null}
            <button
              onClick={() => void create()}
              disabled={!valid}
              className="mt-3 w-full rounded-xl bg-chai px-4 py-3 font-medium text-bg disabled:opacity-40"
            >
              Create
            </button>
            <p className="pt-2 text-center text-[10px] text-ink-dim">
              a groupchat gets its own identity + chatroom
            </p>
          </>
        ) : (
          <div className="flex flex-col gap-2 py-2">
            <Row label="identity" state={step === 'done' ? 'done' : 'busy'} />
            <Row label="chatroom" state={step === 'done' ? 'done' : 'pending'} />
            {step === 'done' && created ? (
              <button
                onClick={() => onCreated(created)}
                className="mt-2 w-full rounded-xl bg-chai px-4 py-3 font-medium text-bg"
              >
                Open {created.channel}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function ModeOption({
  selected,
  disabled,
  onClick,
  title,
  desc,
  icon,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  icon: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
        selected ? 'border-chai bg-chai/10' : 'border-border bg-bg'
      } ${disabled ? 'opacity-40' : 'active:opacity-80'}`}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-[11px] text-ink-dim">{desc}</span>
      </span>
      {selected ? <span className="text-chai">✓</span> : null}
    </button>
  );
}

function Row({ label, state }: { label: string; state: 'pending' | 'busy' | 'done' }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-bg px-3 py-2 text-sm">
      <span>{label}</span>
      <span className={state === 'done' ? 'text-ok' : 'text-ink-dim'}>
        {state === 'done' ? '✓' : state === 'busy' ? '◉' : '·'}
      </span>
    </div>
  );
}
