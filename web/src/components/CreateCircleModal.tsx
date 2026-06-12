import { useState } from 'react';
import { useApp } from '../store';
import { api, ApiError, type CircleSummary } from '../auth/api';

type Step = 'form' | 'creating' | 'done';

export function CreateCircleModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (circle: CircleSummary) => void;
}) {
  const session = useApp((s) => s.session);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CircleSummary | null>(null);

  if (!session) return null;

  const valid = name.trim().length >= 3 && name.trim().length <= 32;

  const create = async () => {
    setStep('creating');
    setError(null);
    try {
      const circle = await api.createCircle(session.sessionJwt, name.trim(), description.trim() || undefined);
      setCreated(circle);
      setStep('done');
    } catch (err) {
      setStep('form');
      setError(
        err instanceof ApiError
          ? err.code === 'CircleExists'
            ? 'a circle with that name already exists'
            : err.code === 'RateLimitExceeded'
              ? 'circle creation limit reached — try again tomorrow'
              : err.message || 'could not create the circle'
          : 'could not create the circle',
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
      <div className="w-full max-w-sm rounded-t-2xl bg-surface p-5 sm:rounded-2xl">
        <div className="flex items-center justify-between pb-3">
          <div className="font-semibold">Create a circle</div>
          <button onClick={onClose} className="px-2 text-ink-dim">
            ✕
          </button>
        </div>

        {step === 'form' ? (
          <>
            <input
              placeholder="circle name (e.g. berlin-builders)"
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
            {error ? <div className="pt-2 text-xs text-err">{error}</div> : null}
            <button
              onClick={() => void create()}
              disabled={!valid}
              className="mt-3 w-full rounded-xl bg-chai px-4 py-3 font-medium text-bg disabled:opacity-40"
            >
              Create
            </button>
            <p className="pt-2 text-center text-[10px] text-ink-dim">
              a circle = chatroom + its own identity + an on-chain Circles group
            </p>
          </>
        ) : (
          <div className="flex flex-col gap-2 py-2">
            <Row label="identity" state={step === 'done' ? 'done' : 'busy'} />
            <Row label="chatroom" state={step === 'done' ? 'done' : 'pending'} />
            <Row
              label="on-chain group"
              state={step === 'done' ? 'async' : 'pending'}
            />
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

function Row({ label, state }: { label: string; state: 'pending' | 'busy' | 'done' | 'async' }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-bg px-3 py-2 text-sm">
      <span>{label}</span>
      <span className={state === 'done' ? 'text-ok' : 'text-ink-dim'}>
        {state === 'done' ? '✓' : state === 'busy' ? '◉' : state === 'async' ? 'confirming on-chain…' : '·'}
      </span>
    </div>
  );
}
